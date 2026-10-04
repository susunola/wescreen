"""Degradation diagnostics and motion-aligned, bounded restoration (BGR uint8)."""
import cv2
import numpy as np
from realtime import clean_compression, clean_blocks, adaptive_detail, balanced_sdr_tone


def codec_grids(grey):
    """Find repeated weak seams, including shifted/scaled codec grids."""
    grids=[]
    for axis in (0,1):
        means=np.mean(np.abs(np.diff(grey.astype(np.float32),axis=axis)),axis=1-axis)
        best=None
        for step in (8,12,16,24,32):
            for phase in range(step):
                indices=np.arange(phase,len(means),step)
                if len(indices)<4:continue
                grid=means[indices];normal=np.delete(means,indices)
                baseline=float(np.median(normal)) if len(normal) else 0
                score=float(np.median(grid))-baseline
                # Isolated real edges and irregular texture are not codec grids.
                if score<=1.5 or np.mean(grid>baseline+1.5)<.7:continue
                if best is None or score>best['score']+.1:
                    best={'step':step,'offset':(phase+1)%step,'score':round(score,2)}
        grids.append(best)
    return grids


def diagnose(frame):
    grey=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    # Ignore constant bars for diagnostics only. Never crop the delivered video.
    rows=np.where((grey.std(axis=1)>1)|((grey.mean(axis=1)>8)&(grey.mean(axis=1)<247)))[0];cols=np.where((grey.std(axis=0)>1)|((grey.mean(axis=0)>8)&(grey.mean(axis=0)<247)))[0]
    crop=grey[rows[0]:rows[-1]+1,cols[0]:cols[-1]+1] if len(rows)>16 and len(cols)>16 else grey
    scale=min(1,640/max(crop.shape));small=cv2.resize(crop,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA) if scale<1 else crop
    span=cv2.dilate(small,np.ones((3,3),np.uint8)).astype(float)-cv2.erode(small,np.ones((3,3),np.uint8))
    flat=np.abs(small.astype(float)-cv2.medianBlur(small,3))[span<24]
    native_scale=min(1,320/max(crop.shape))
    noise_sample=cv2.resize(crop,None,fx=native_scale,fy=native_scale,interpolation=cv2.INTER_NEAREST) if native_scale<1 else crop
    local=cv2.dilate(noise_sample,np.ones((3,3),np.uint8)).astype(float)-cv2.erode(noise_sample,np.ones((3,3),np.uint8))
    flat=np.abs(noise_sample.astype(float)-cv2.medianBlur(noise_sample,3))[local<24]
    noise=float(np.percentile(flat,70)) if flat.size>=32 else 0
    lap=float(cv2.Laplacian(small,cv2.CV_32F).var())
    grids=codec_grids(grey)
    block=max((grid['score'] for grid in grids if grid),default=0)
    colour=cv2.cvtColor(frame,cv2.COLOR_BGR2YCrCb)
    chroma=[]
    for channel in (1,2):
        values=colour[...,channel]
        residual=np.abs(values.astype(np.float32)-cv2.medianBlur(values,3))
        candidates=residual[(cv2.dilate(grey,np.ones((3,3),np.uint8)).astype(float)-cv2.erode(grey,np.ones((3,3),np.uint8)))<24]
        chroma.append(float(np.percentile(candidates,70)) if candidates.size>=32 else 0)
    chroma_noise=max(chroma)
    # This is a softness indicator, not a claimed reconstruction of source pixels.
    soft=lap<80 and float(np.percentile(span,90))>3
    return {'noise':round(noise,2),'blocks':round(block,2),'detail':round(lap,2),
            'codecGrids':grids,'chromaNoise':round(chroma_noise,2),'soft':soft,'degraded':noise>1.5 or block>1.5 or chroma_noise>2 or soft,
            'contentWidth':int(crop.shape[1]),'contentHeight':int(crop.shape[0])}


class TemporalRepair:
    """One previous raw frame. Bidirectional flow rejects occlusion and scene cuts."""
    def __init__(self):self.previous=None;self.previous_time=None
    def reset(self):self.previous=None;self.previous_time=None
    def apply(self,frame,timestamp):
        previous=self.previous;last=self.previous_time
        self.previous=frame.copy();self.previous_time=timestamp
        if previous is None or previous.shape!=frame.shape or last is None or not 0<timestamp-last<=.25:return frame
        h,w=frame.shape[:2];scale=min(1,480/max(w,h));size=(max(16,round(w*scale)),max(16,round(h*scale)))
        now=cv2.resize(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),size,interpolation=cv2.INTER_AREA)
        old=cv2.resize(cv2.cvtColor(previous,cv2.COLOR_BGR2GRAY),size,interpolation=cv2.INTER_AREA)
        # Histogram and coarse differences prevent previous shots bleeding into cuts.
        if abs(float(now.mean()-old.mean()))>25 or float(np.mean(np.abs(now.astype(float)-old)))>35:return frame
        forward=cv2.calcOpticalFlowFarneback(now,old,None,.5,3,15,3,5,1.2,0)
        backward=cv2.calcOpticalFlowFarneback(old,now,None,.5,3,15,3,5,1.2,0)
        yy,xx=np.mgrid[:size[1],:size[0]].astype(np.float32)
        mx,my=xx+forward[...,0],yy+forward[...,1]
        reverse=cv2.remap(backward,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        consistency=np.linalg.norm(forward+reverse,axis=2)
        confidence=(consistency<.75)&(mx>=0)&(my>=0)&(mx<size[0]-1)&(my<size[1]-1)
        flow=cv2.resize(forward,(w,h),interpolation=cv2.INTER_LINEAR);flow[...,0]*=w/size[0];flow[...,1]*=h/size[1]
        yy,xx=np.mgrid[:h,:w].astype(np.float32)
        aligned=cv2.remap(previous,xx+flow[...,0],yy+flow[...,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
        error=np.max(np.abs(aligned.astype(float)-frame),axis=2)
        weight=cv2.resize(confidence.astype(np.float32),(w,h),interpolation=cv2.INTER_NEAREST)*np.clip((12-error)/8,0,1)*.3
        # Reject strong edges: one-pixel motion errors must not soften letters/faces.
        grey=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        edge=cv2.dilate(grey,np.ones((3,3),np.uint8)).astype(float)-cv2.erode(grey,np.ones((3,3),np.uint8))
        weight*=np.clip((32-edge)/24,0,1)
        return np.clip(frame.astype(float)+(aligned.astype(float)-frame)*weight[...,None],0,255).round().astype(np.uint8)


def text_protection(frame):
    grey=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    edges=cv2.Canny(grey,80,160)
    grouped=cv2.morphologyEx(edges,cv2.MORPH_CLOSE,np.ones((3,9),np.uint8))
    _,_,stats,_=cv2.connectedComponentsWithStats(grouped,8)
    mask=np.zeros(grey.shape,np.float32)
    for x,y,w,h,area in stats[1:]:
        if 4<=h<=min(40,grey.shape[0]*.15) and w>=max(20,h*2) and w<grey.shape[1]*.95 and area>=12:
            mask[max(0,y-2):min(grey.shape[0],y+h+2),max(0,x-2):min(grey.shape[1],x+w+2)]=1
    return cv2.GaussianBlur(mask,(5,5),1)


def clean_chroma(frame,profile):
    """Suppress coloured codec speckles without blurring luminance detail."""
    strength=float(np.clip((profile.get('chromaNoise',0)-1.5)/6,0,1))
    if strength==0:return frame
    colour=cv2.cvtColor(frame,cv2.COLOR_BGR2YCrCb)
    for channel in (1,2):
        raw=colour[...,channel]
        filtered=cv2.bilateralFilter(raw,5,12+12*strength,3)
        colour[...,channel]=np.clip(raw.astype(float)+(filtered.astype(float)-raw)*(.35+.4*strength),0,255).round().astype(np.uint8)
    return cv2.cvtColor(colour,cv2.COLOR_YCrCb2BGR)


def recover_soft_detail(frame,profile):
    """Bounded two-scale luma recovery for soft sources, after denoising/SR."""
    if not profile or not profile.get('soft'):return frame
    pixels=frame.astype(np.float32)
    luma=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY).astype(np.float32)
    fine=luma-cv2.GaussianBlur(luma,(0,0),.8)
    broad=luma-cv2.GaussianBlur(luma,(0,0),1.6)
    # Soft-threshold small residuals: flat-region noise must not become detail.
    threshold=2+min(4,float(profile.get('noise',0))*.6)
    detail=np.sign(fine)*np.maximum(np.abs(fine)-threshold,0)*.22
    detail+=np.sign(broad)*np.maximum(np.abs(broad)-threshold*1.5,0)*.32
    weight=np.clip((luma-12)/28,0,1)*np.clip((245-luma)/28,0,1)
    weight*=1-text_protection(frame)
    delta=np.clip(detail,-5,5)*weight
    kernel=np.ones((5,5),np.uint8)
    target=np.clip(luma+delta,cv2.erode(luma,kernel),cv2.dilate(luma,kernel))
    return np.clip(pixels+(target-luma)[...,None],0,255).round().astype(np.uint8)


def restore(frame,temporal,timestamp,neural=None,profile=None,text=False,output_scale=1):
    if text:
        # No temporal or generative pixels in explicitly recorded desktop text.
        repaired=adaptive_detail(frame)
    else:
        repaired=clean_chroma(clean_blocks(clean_compression(temporal.apply(frame,timestamp)),(profile or {}).get('codecGrids')),profile or {})
        if neural and profile and profile['degraded']:
            prediction=neural(repaired,output_scale)
            base=cv2.resize(repaired,(prediction.shape[1],prediction.shape[0]),interpolation=cv2.INTER_LANCZOS4)
            # Keep source identity/color; no separate face synthesis.
            mask=text_protection(frame)
            mask=cv2.resize(mask,(prediction.shape[1],prediction.shape[0]),interpolation=cv2.INTER_LINEAR)[...,None]
            # More model contribution for diagnosed soft/blocked sources; keep
            # clean sources unchanged and retain subtitle protection.
            amount=.68 if profile.get('soft') else (.62 if profile.get('blocks',0)>1.5 else .55)
            blend=(1-mask)*amount
            repaired=np.clip(base.astype(float)+(prediction.astype(float)-base)*blend,0,255).round().astype(np.uint8)
        elif output_scale==2:
            repaired=cv2.resize(repaired,None,fx=2,fy=2,interpolation=cv2.INTER_LANCZOS4)
        repaired=balanced_sdr_tone(recover_soft_detail(adaptive_detail(repaired),profile))
    return repaired
