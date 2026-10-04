"""Bounded single-frame neural inference; no frame is persisted to disk."""
import os
import hashlib
import threading
import time

_MODEL = None
_TARGET = "CPU"
_LOCK = threading.Lock()


def inference_engine(model_path, model_hash):
    global _MODEL, _TARGET
    import cv2
    if _MODEL is None:
        if hashlib.sha256(model_path.read_bytes()).hexdigest() != model_hash:
            raise RuntimeError('AI model checksum mismatch')
        cv2.setNumThreads(max(1, min(os.cpu_count() or 1, 8)))
        model=cv2.dnn_superres.DnnSuperResImpl_create()
        model.readModel(str(model_path));model.setModel('fsrcnn',2)
        try:
            if cv2.ocl.haveOpenCL():
                cv2.ocl.setUseOpenCL(True)
                if cv2.ocl.useOpenCL():
                    model.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                    model.setPreferableTarget(cv2.dnn.DNN_TARGET_OPENCL);_TARGET='OpenCL'
        except (cv2.error, AttributeError):
            _TARGET='CPU'
        _MODEL=model
    return _MODEL

def upsample(frame, model_path, model_hash):
    global _TARGET
    import cv2
    model=inference_engine(model_path,model_hash)
    try:
        return model.upsample(frame)
    except cv2.error:
        if _TARGET != 'OpenCL': raise
        model.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU);_TARGET='CPU'
        return model.upsample(frame)


def jpeg_dimensions(data):
    if not data.startswith(b'\xff\xd8'):
        raise ValueError('Realtime input must be JPEG')
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 255:
            raise ValueError('Invalid JPEG header')
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data): break
        marker = data[offset]; offset += 1
        if marker in (0xd8, 0xd9): continue
        length = int.from_bytes(data[offset:offset+2], 'big')
        if length < 2 or offset + length > len(data): break
        if marker in (0xc0, 0xc1, 0xc2):
            if length < 8: break
            height = int.from_bytes(data[offset+3:offset+5], 'big')
            width = int.from_bytes(data[offset+5:offset+7], 'big')
            if min(width, height) < 2 or max(width, height) > 960 or min(width, height) > 540:
                raise ValueError('Realtime frame supports up to 960x540 (portrait allowed)')
            return width, height
        if marker == 0xda: break
        offset += length
    raise ValueError('Invalid JPEG dimensions')


def frame_dimensions(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=33 and data[12:16]==b'IHDR':
        width=int.from_bytes(data[16:20],'big');height=int.from_bytes(data[20:24],'big')
        if min(width,height)<2 or max(width,height)>960 or min(width,height)>540:
            raise ValueError('Realtime frame supports up to 960x540 (portrait allowed)')
        return width,height
    return jpeg_dimensions(data)


def enhance_frame(data, model_path, model_hash, lossless=False):
    global _MODEL
    width, height = frame_dimensions(data)
    import cv2
    import numpy as np
    started = time.perf_counter()
    with _LOCK:
        frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if frame is None or frame.shape[:2] != (height, width):
            raise ValueError('Invalid JPEG frame')
        # The legacy image transport uses the same degradation-aware cleanup.
        cleaned = clean_compression(frame)
        enhanced = balanced_sdr_tone(adaptive_detail(upsample(cleaned, model_path, model_hash)))
        ok, encoded = cv2.imencode('.png' if lossless else '.jpg', enhanced, [cv2.IMWRITE_PNG_COMPRESSION, 1] if lossless else [cv2.IMWRITE_JPEG_QUALITY, 94])
        if not ok: raise RuntimeError('Could not encode enhanced frame')
    return encoded.tobytes(), (time.perf_counter()-started)*1000


def balanced_sdr_tone(frame):
    """Bounded luminance detail: protect highlights, blacks and chromaticity."""
    import cv2
    import numpy as np
    pixels=frame.astype(np.float32)
    luminance=pixels[...,0]*.0722+pixels[...,1]*.7152+pixels[...,2]*.2126
    base=cv2.GaussianBlur(luminance,(0,0),3)
    weight=np.clip((luminance-16)/48,0,1)*np.clip((235-luminance)/48,0,1)
    # Separate texture from broad contrast. Threshold tiny differences so flat
    # gradients and low-amplitude codec noise are not sharpened.
    fine=luminance-cv2.GaussianBlur(luminance,(3,3),.65)
    texture=np.sign(fine)*np.maximum(np.abs(fine)-2.0,0)
    local=luminance-base
    structure=np.sign(local)*np.maximum(np.abs(local)-1.5,0)
    delta=np.clip(structure*.12+texture*.16,-4,4)*weight
    # Equal channel adjustment preserves hue; never stretch endpoints.
    return np.clip(pixels+delta[...,None],0,255).round().astype(np.uint8)


def clean_compression(frame):
    """Estimate small codec noise and clean flat regions before neural SR."""
    import cv2
    import numpy as np
    grey=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    kernel=np.ones((3,3),np.uint8)
    span=cv2.dilate(grey,kernel).astype(np.float32)-cv2.erode(grey,kernel)
    # Estimate noise on a bounded thumbnail, excluding strong edges and texture.
    # No frame history: seeking, switching parts and cuts cannot leak old pixels.
    scale=min(1,320/max(grey.shape))
    small=cv2.resize(grey,None,fx=scale,fy=scale,interpolation=cv2.INTER_NEAREST) if scale<1 else grey
    local=cv2.dilate(small,kernel).astype(np.float32)-cv2.erode(small,kernel)
    residual=np.abs(small.astype(np.float32)-cv2.medianBlur(small,3))
    flat=residual[local<24]
    noise=float(np.percentile(flat,70)) if flat.size>=32 else 0
    strength=float(np.clip((noise-1)/5,0,1))
    # Clean sources bypass preprocessing; degraded sources get more cleanup.
    if strength==0:return frame
    amount=np.clip((32-span)/24,0,1)[...,None]*(.30+.40*strength)
    filtered=cv2.bilateralFilter(frame,5 if strength>.65 else 3,8+12*strength,3)
    return np.clip(frame.astype(np.float32)+(filtered.astype(np.float32)-frame)*amount,0,255).round().astype(np.uint8)


def clean_blocks(frame):
    """Conservative deblocking of weak, isolated grid seams; preserve real edges.

    Test both common codec grids. Only soften a boundary when its jump exceeds
    neighboring gradients and remains below a real high-contrast edge.
    """
    import numpy as np
    pixels=frame.astype(np.float32)
    result=pixels.copy()
    for axis in (0,1):
        values=np.swapaxes(pixels,0,axis)
        target=np.swapaxes(result,0,axis)
        for boundary in range(8,len(values)-1,8):
            left,right=values[boundary-1],values[boundary]
            jump=np.mean(np.abs(right-left),axis=-1)
            neighbor=(np.mean(np.abs(left-values[boundary-2]),axis=-1)+
                      np.mean(np.abs(values[boundary+1]-right),axis=-1))*.5
            weight=np.clip((jump-neighbor-2)/8,0,1)*.25
            weight=np.where((jump<20)&(neighbor<6),weight,0)[...,None]
            delta=(right-left)*weight
            target[boundary-1]+=delta
            target[boundary]-=delta
    return np.clip(result,0,255).round().astype(np.uint8)


def adaptive_detail(frame):
    """Sharpen visible luma texture, rejecting tiny noise and new edge extrema."""
    import cv2
    import numpy as np
    pixels=frame.astype(np.float32)
    luma=pixels[...,0]*.0722+pixels[...,1]*.7152+pixels[...,2]*.2126
    fine=luma-cv2.GaussianBlur(luma,(3,3),.65)
    detail=np.sign(fine)*np.maximum(np.abs(fine)-3,0)
    weight=np.clip((luma-16)/32,0,1)*np.clip((240-luma)/32,0,1)
    delta=np.clip(detail*.28,-3,3)*weight
    kernel=np.ones((3,3),np.uint8)
    target=np.clip(luma+delta,cv2.erode(luma,kernel),cv2.dilate(luma,kernel))
    return np.clip(pixels+(target-luma)[...,None],0,255).round().astype(np.uint8)


def enhance_rgb(data, width, height, model_path, model_hash, protect_text=True, output_scale=1):
    """Full-resolution spatial fallback with optional genuine 2x output."""
    if min(width,height)<2 or max(width,height)>1920 or min(width,height)>1080 or len(data)!=width*height*3:
        raise ValueError('RGB frame dimensions or length are invalid (up to 1920x1080, portrait allowed)')
    if output_scale not in (1,2): raise ValueError('Output scale must be 1 or 2')
    import cv2
    import numpy as np
    started=time.perf_counter()
    with _LOCK:
        bgr=cv2.cvtColor(np.frombuffer(data,np.uint8).reshape(height,width,3),cv2.COLOR_RGB2BGR)
        size=(width*output_scale,height*output_scale)
        cleaned=clean_blocks(clean_compression(bgr))
        # Same-size restoration needs no expensive upscale/downscale round trip.
        restored=upsample(cleaned,model_path,model_hash) if output_scale==2 else cleaned
        # Content-dependent luma sharpening replaces global channel sharpening.
        restored=adaptive_detail(restored)
        if protect_text:
            edges=cv2.Canny(cv2.cvtColor(bgr,cv2.COLOR_BGR2GRAY),60,140)
            mask=cv2.dilate(edges,np.ones((3,3),np.uint8)).astype(np.float32)/255
            mask=cv2.GaussianBlur(mask,(5,5),1.0)
            weak=cv2.bilateralFilter(bgr,3,4,4)
            if output_scale==2:
                weak=cv2.resize(weak,size,interpolation=cv2.INTER_LANCZOS4)
                mask=cv2.resize(mask,size,interpolation=cv2.INTER_LINEAR)
            alpha=np.clip(mask,0,1)[...,None]
            restored=np.clip(restored.astype(np.float32)*(1-alpha)+weak.astype(np.float32)*alpha,0,255).round().astype(np.uint8)
        restored=balanced_sdr_tone(restored)
        output=cv2.cvtColor(restored,cv2.COLOR_BGR2RGB)
    return output.tobytes(),(time.perf_counter()-started)*1000
