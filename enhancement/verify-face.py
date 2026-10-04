"""Validate the optional engine before advertising face restoration."""
import hashlib
import json
import os
import sys
from pathlib import Path
from face import ROOT, ENGINE, WEIGHTS, file_sha256

os.chdir(ENGINE); sys.path.insert(0, str(ENGINE))
import torch
from basicsr.archs.codeformer_arch import CodeFormer
from facelib.utils.face_restoration_helper import FaceRestoreHelper
from basicsr.utils.misc import get_device

expected_sizes = [376637898, 109497761, 85331193]
expected_hashes = ['1009e537e0c2a07d4cabce6355f53cb66767cd4b4297ec7a4a64ca4b8a5684b7','6d1de9c2944f2ccddca5f5e010ea5ae64a39845a86311af6fdf30841b0a5a16d','3d558d8d0e42c20224f13cf5a29c79eba2d59913419f945545d8cf7b72920de2']
for name, size, checksum in zip(WEIGHTS, expected_sizes, expected_hashes):
    path=ENGINE/name
    if path.stat().st_size != size: raise SystemExit('Incomplete face model: '+name)
    if file_sha256(path)!=checksum: raise SystemExit('Face model checksum mismatch: '+name)
    # Restricted deserialization accepts tensors only, never executable pickle globals.
    torch.load(str(path), map_location='cpu', weights_only=True)
net=CodeFormer(dim_embd=512, codebook_size=1024, n_head=8, n_layers=9, connect_list=['32','64','128','256'])
net.load_state_dict(torch.load(str(ENGINE/WEIGHTS[0]),map_location='cpu',weights_only=True)['params_ema']);net.eval()
device=get_device();net.to(device)
with torch.inference_mode():
    output=net(torch.zeros(1,3,512,512,device=device),w=.8,adain=True)[0]
    if output.shape != (1,3,512,512) or not torch.isfinite(output).all(): raise SystemExit('Face engine smoke test failed')
helper=FaceRestoreHelper(1,face_size=512,crop_ratio=(1,1),det_model='retinaface_resnet50',save_ext='png',use_parse=True,device=device)
ready={'tested':True,'device':str(device),'revision':'b33cc7d639d6545bfcccc7e0bc6ae51f24e79c2b','files':{name:{'size':(ENGINE/name).stat().st_size,'mtime_ns':(ENGINE/name).stat().st_mtime_ns} for name in WEIGHTS},'sha256':{name:file_sha256(ENGINE/name) for name in WEIGHTS}}
(ROOT/'.runtime/face-ready.json').write_text(json.dumps(ready))
print('CodeFormer inference verified on '+str(device))
