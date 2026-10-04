"""Optional Real-ESRGAN compact backend, Metal via PyTorch MPS.
Architecture adapted from xinntao/Real-ESRGAN SRVGGNetCompact (BSD-3-Clause).
See models/LICENSE-Real-ESRGAN.txt. No face reconstruction model is used.
"""
from pathlib import Path
import hashlib
import json
import os

ROOT=Path(__file__).resolve().parent
DIRECTORY=ROOT/'.runtime'/'smart-models'
# Filled with verified official release file digests by installer.
HASHES={'realesr-general-x4v3.pth':'8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292','realesr-general-wdn-x4v3.pth':'1641f8c4464b9f097c9fdda5589273713f67cf59f3d909e0bd688f0cee269dca'}


def model_files_valid():
    if not HASHES:return False
    return all((DIRECTORY/name).is_file() and hashlib.sha256((DIRECTORY/name).read_bytes()).hexdigest()==digest for name,digest in HASHES.items())


def smart_ready():
    try:
        ready=json.loads((ROOT/'.runtime'/'smart-ready.json').read_text())
        return ready.get('tested') is True and Path(ready['python']).is_file() and all(ready['files'][name]=={'size':(DIRECTORY/name).stat().st_size,'mtime_ns':(DIRECTORY/name).stat().st_mtime_ns} for name in HASHES) and bool(HASHES)
    except (OSError,ValueError,KeyError,TypeError):return False


class NeuralRepair:
    def __init__(self,denoise=.35,guide_long_side=640):
        self.guide_long_side=max(640,min(960,int(guide_long_side)))
        import torch
        from torch import nn
        if not model_files_valid():raise ValueError('Smart model checksum mismatch')
        class Compact(nn.Module):
            def __init__(self):
                super().__init__();self.body=nn.ModuleList([nn.Conv2d(3,64,3,1,1),nn.PReLU(64)])
                for _ in range(32):self.body.extend([nn.Conv2d(64,64,3,1,1),nn.PReLU(64)])
                self.body.append(nn.Conv2d(64,48,3,1,1));self.upsampler=nn.PixelShuffle(4)
            def forward(self,x):
                y=x
                for layer in self.body:y=layer(y)
                return self.upsampler(y)+torch.nn.functional.interpolate(x,scale_factor=4,mode='nearest')
        self.torch=torch;self.device='mps' if torch.backends.mps.is_available() else 'cuda' if torch.cuda.is_available() else 'cpu'
        torch.set_num_threads(max(1,min(os.cpu_count() or 1,8)))
        self.model=Compact()
        strong=torch.load(DIRECTORY/'realesr-general-x4v3.pth',map_location='cpu',weights_only=True)['params']
        weak=torch.load(DIRECTORY/'realesr-general-wdn-x4v3.pth',map_location='cpu',weights_only=True)['params']
        self.model.load_state_dict({key:strong[key]*denoise+weak[key]*(1-denoise) for key in strong})
        self.model.eval().to(self.device)
        self.dtype=torch.float16 if self.device in ('mps','cuda') else torch.float32
        self.model.to(dtype=self.dtype)
    def __call__(self,frame,scale=1):
        import cv2
        import numpy as np
        h,w=frame.shape[:2]
        if max(h,w)<=960:return self.infer_tiles(frame,scale)
        # Large recordings often contain enlarged low-quality content. Infer a
        # bounded guide, then add its low-frequency residual to native pixels.
        # Never replace the full frame with a downscaled/upscaled image.
        ratio=getattr(self,'guide_long_side',640)/max(h,w);size=(max(2,round(w*ratio)),max(2,round(h*ratio)))
        guide=cv2.resize(frame,size,interpolation=cv2.INTER_AREA)
        prediction=self.infer_tiles(guide,1)
        residual=prediction.astype(np.float32)-guide.astype(np.float32)
        residual=cv2.resize(residual,(w,h),interpolation=cv2.INTER_LINEAR)
        grey=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        span=cv2.dilate(grey,np.ones((3,3),np.uint8)).astype(float)-cv2.erode(grey,np.ones((3,3),np.uint8))
        weight=np.clip((48-span)/32,0,1)[...,None]
        result=np.clip(frame.astype(np.float32)+np.clip(residual,-12,12)*weight,0,255).round().astype(np.uint8)
        return cv2.resize(result,(w*scale,h*scale),interpolation=cv2.INTER_LANCZOS4) if scale!=1 else result

    def infer_tiles(self,frame,scale=1):
        import cv2
        import numpy as np
        torch=self.torch;h,w=frame.shape[:2]
        result=np.empty((h*scale,w*scale,3),np.uint8)
        # Tiles bound activation memory; 48-pixel halo covers the 35-layer receptive field.
        tile_size=512 if self.device=='mps' else 256
        with torch.inference_mode():
            for y in range(0,h,tile_size):
                for x in range(0,w,tile_size):
                    y1,x1=max(0,y-48),max(0,x-48);y2,x2=min(h,y+tile_size+48),min(w,x+tile_size+48)
                    tile=frame[y1:y2,x1:x2,::-1].copy()
                    tensor=torch.from_numpy(tile).permute(2,0,1).float().unsqueeze(0).to(device=self.device,dtype=self.dtype)/255
                    prediction=self.model(tensor).clamp(0,1).squeeze(0).permute(1,2,0).cpu().numpy()
                    prediction=(prediction[...,::-1]*255).round().astype(np.uint8)
                    if scale!=4:prediction=cv2.resize(prediction,((x2-x1)*scale,(y2-y1)*scale),interpolation=cv2.INTER_AREA)
                    endy,endx=min(h,y+tile_size),min(w,x+tile_size)
                    result[y*scale:endy*scale,x*scale:endx*scale]=prediction[(y-y1)*scale:(endy-y1)*scale,(x-x1)*scale:(endx-x1)*scale]
        return result
