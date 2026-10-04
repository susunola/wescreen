"""Optional CodeFormer integration; inference stays in an isolated local process."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / '.runtime' / 'codeformer'
PYTHON = ROOT / '.runtime' / 'face-venv' / 'bin' / 'python'
WEIGHTS = ['weights/CodeFormer/codeformer.pth', 'weights/facelib/detection_Resnet50_Final.pth', 'weights/facelib/parsing_parsenet.pth']


def file_sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()


def face_ready():
    try:
        ready = json.loads((ROOT / '.runtime' / 'face-ready.json').read_text())
        return PYTHON.exists() and (ENGINE / 'basicsr/archs/codeformer_arch.py').exists() and ready.get('tested') is True and all(ready['files'][name] == {'size': (ENGINE / name).stat().st_size, 'mtime_ns': (ENGINE / name).stat().st_mtime_ns} for name in WEIGHTS)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def run_face(job, source, output, width, height, fps, limit, encode, checked_process):
    if not face_ready():
        raise ValueError('Face restoration is not installed. Run enhancement/install-face.command first.')
    if max(width, height) > 3840 or min(width, height) > 2160:
        raise ValueError('Face restoration supports up to 3840x2160 or 2160x3840 input.')
    job['stage'] = 'CodeFormer'
    command = [str(PYTHON), str(ROOT / 'face_runner.py'), '--source', str(source), '--output', str(output), '--width', str(width), '--height', str(height), '--fps', str(fps), '--duration', str(limit), '--start', str(job.get('start', 0) if job['preview'] else 0), '--fidelity', str(job.get('faceFidelity', .8)), '--blend', str(job.get('strength', .65)), '--encoding', json.dumps(encode)]
    process = checked_process(job, command, cwd=ENGINE, env={**os.environ, 'PYTORCH_ENABLE_MPS_FALLBACK': '1', 'PYTHONUNBUFFERED': '1'}, stdout=__import__('subprocess').PIPE, text=True)
    error = ''
    for line in process.stdout:
        try:
            report = json.loads(line)
            if report.get('error'): error = report['error']
            job['progress'] = min(.99, max(job['progress'], report.get('progress', 0)))
            job['faceRestoredFrames'] = report.get('restoredFrames', job.get('faceRestoredFrames', 0))
        except (ValueError, TypeError):
            job['log'].write(line.encode())
    if process.wait() != 0 or not output.exists():
        raise RuntimeError(error or 'Face restoration failed; inspect the local ffmpeg.log.')
