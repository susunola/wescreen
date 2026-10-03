"""Validate large model downloads before exposing the strong enhancement mode."""
import hashlib
import json
from pathlib import Path
import subprocess
import torch

root = Path(__file__).resolve().parent
runtime = root / '.runtime'
weights = {
    'seedvr2_ema_3b_fp16.safetensors': '2fd0e03a3dad24e07086750360727ca437de4ecd456f769856e960ae93e2b304',
    'ema_vae_fp16.safetensors': '20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1',
}
for name, expected in weights.items():
    with (runtime / 'seedvr-models' / name).open('rb') as file:
        actual = hashlib.file_digest(file, 'sha256').hexdigest()
    if actual != expected:
        raise SystemExit(f'Model checksum mismatch: {name}. Remove the damaged file and rerun installation.')
if not (torch.backends.mps.is_available() or torch.cuda.is_available()):
    raise SystemExit('SeedVR2 requires an available Apple Silicon MPS or CUDA GPU.')
subprocess.run([str(runtime / 'seedvr-venv/bin/python'), str(runtime / 'seedvr2/inference_cli.py'), '--help'], check=True, stdout=subprocess.DEVNULL)
files = {name: {'size': (runtime / 'seedvr-models' / name).stat().st_size, 'mtime_ns': (runtime / 'seedvr-models' / name).stat().st_mtime_ns} for name in weights}
(runtime / 'seedvr-ready.json').write_text(json.dumps({'model': 'SeedVR2 3B FP16', 'weights': weights, 'files': files}))
print('SeedVR2 model hashes and runtime validated.')
