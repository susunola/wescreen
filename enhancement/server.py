"""Local video enhancement. No cloud requests; bind only to IPv4 loopback."""
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from realtime import enhance_frame
from pairing import connect_origin
from tail import trim_static_tail
from merge import handle_media_post

for ffmpeg_bin in ('/opt/homebrew/opt/ffmpeg-full/bin','/usr/local/opt/ffmpeg-full/bin'):
    if Path(ffmpeg_bin,'ffmpeg').is_file():
        os.environ['PATH']=ffmpeg_bin+os.pathsep+os.environ.get('PATH','');break

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / 'models' / 'FSRCNN_x2.pb'
MODEL_HASH = '366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c'
FILTERS = {
    'natural': 'deblock=filter=weak:block=8,hqdn3d=1:1:2:2,unsharp=5:5:0.2:5:5:0',
    'basic': 'hqdn3d=1.2:1.2:3:3,eq=contrast=1.03:brightness=0.01:saturation=1.02,unsharp=5:5:0.35:5:5:0',
    'light': 'hqdn3d=1:1:2:2,eq=contrast=1.06:brightness=0.025:gamma=1.08:saturation=1.04,unsharp=5:5:0.25:5:5:0',
}
def enhancement_filter(mode, strength=1, content='auto'):
    if strength == 0: return 'null'
    if strength == 1 and content == 'auto': return FILTERS[mode]
    filters=[]
    if content != 'detail':
        denoise=(1.2 if mode == 'basic' else 1)*strength
        temporal=(3 if mode == 'basic' else 2)*strength*(.25 if content == 'motion' else 1)
        filters.append(f'hqdn3d={denoise}:{denoise}:{temporal}:{temporal}')
        if mode == 'natural': filters.insert(0,'deblock=filter=weak:block=8')
    if mode == 'basic': filters.append(f'eq=contrast={1+.03*strength}:brightness={.01*strength}:saturation={1+.02*strength}')
    if mode == 'light': filters.append(f'eq=contrast={1+.06*strength}:brightness={.025*strength}:gamma={1+.08*strength}:saturation={1+.04*strength}')
    sharpen=(.15 if content == 'detail' else {'natural':.2,'basic':.35,'light':.25}[mode])*strength
    radius=3 if content == 'detail' else 5
    filters.append(f'unsharp={radius}:{radius}:{sharpen}:5:5:0')
    return ','.join(filters)

TOKEN_FILE = ROOT / '.runtime' / 'token.txt'
TOKEN = os.environ.get('WESCREEN_ENHANCE_TOKEN') or (TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else secrets.token_urlsafe(32))
JOBS = {}
GUARD = threading.Lock()
SLOT = threading.Lock()
WORK = Path(os.environ.get('WESCREEN_WORK_DIR') or ROOT / '.runtime' / 'jobs')
WORK.mkdir(parents=True, exist_ok=True, mode=0o700)
WORK.chmod(0o700)
PAIR_FILE = WORK / 'extension-origin.txt'
PAIR_GUARD = threading.Lock()
SEED_ROOT = ROOT / '.runtime' / 'seedvr2'
SEED_PYTHON = ROOT / '.runtime' / 'seedvr-venv' / 'bin' / 'python'
SEED_MODELS = ROOT / '.runtime' / 'seedvr-models'
SEED_WEIGHTS = {
    'seedvr2_ema_3b_fp16.safetensors': '2fd0e03a3dad24e07086750360727ca437de4ecd456f769856e960ae93e2b304',
    'ema_vae_fp16.safetensors': '20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1',
}

PUBLIC_KEYS = ('id', 'state', 'progress', 'stage', 'detail', 'duration', 'width', 'height', 'size', 'error', 'mode', 'preview', 'previewSeconds', 'start', 'end', 'sourceId', 'name', 'createdAt', 'crop', 'rotation', 'batchRef', 'landscape', 'strength','audioPreset','compatible','watermark','requireSilence','tailRemoved','tailReason','smartTail','toneMap','captureContent','frameRate','encoding')

def persist_job(job):
    path = job['output'].parent / 'job.json'
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps({key: job[key] for key in PUBLIC_KEYS if key in job}))
    os.replace(temp, path)


def load_jobs():
    for path in WORK.glob('*/job.json'):
        try:
            job = json.loads(path.read_text())
            if path.parent.name != job['id'] or not re.fullmatch('[a-f0-9]{32}', job['id']):
                continue
            job.update(source=path.parent/'input', output=path.parent/'enhanced.mp4', cancel=threading.Event(), processes=[])
            if job['state'] in ('queued', 'processing'):
                job.update(state='error', error='Local helper restarted before processing finished. Retry from the original video.')
                job['output'].unlink(missing_ok=True)
            elif job['state'] == 'done' and not job['output'].exists():
                job.update(state='error', error='Output file is missing')
            JOBS[job['id']] = job
            persist_job(job)
        except (OSError, ValueError, KeyError, TypeError):
            continue

load_jobs()

def seed_ready():
    if not SEED_PYTHON.exists() or not (SEED_ROOT / 'inference_cli.py').exists():
        return False
    try:
        ready = json.loads((ROOT / '.runtime' / 'seedvr-ready.json').read_text())
        if not isinstance(ready, dict) or ready.get('weights') != SEED_WEIGHTS:
            return False
        return all(ready['files'][name] == {'size': (SEED_MODELS / name).stat().st_size, 'mtime_ns': (SEED_MODELS / name).stat().st_mtime_ns} for name in SEED_WEIGHTS)
    except (OSError, ValueError, KeyError, TypeError):
        return False

def run_seed(job, source, output, width, height, trim, encode):
    if not seed_ready():
        raise ValueError('SeedVR2 is not installed. Run enhancement/install-seedvr.sh first.')
    if max(width, height) > 1920 or min(width, height) > 1080:
        raise ValueError('SeedVR2 currently supports up to 1920x1080 input (1080x1920 portrait). Use Natural restoration to preserve larger sources.')
    # Normalize rotation/timestamps and trim BEFORE inference, keeping previews bounded.
    prepared = source.parent / 'seed-input.mp4'
    process = checked_process(job, ['ffmpeg', '-nostdin', '-y', '-v', 'error', *INPUT_OPTIONS, *job.get('seek', []), '-i', str(source), *trim, '-map', '0:v:0', '-an', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-crf', '0', str(prepared)])
    if process.wait() != 0:
        raise RuntimeError('Could not prepare SeedVR2 input')
    restored = source.parent / 'seed-output.mp4'
    resolution = min(1080, min(width, height) * 2)
    job['stage'] = 'SeedVR2'
    env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'PYTORCH_ENABLE_MPS_FALLBACK': '1', 'PYTHONUNBUFFERED': '1', 'PYTORCH_MPS_HIGH_WATERMARK_RATIO': '1.0', 'PYTORCH_MPS_LOW_WATERMARK_RATIO': '0.8'}
    process = checked_process(job, [str(SEED_PYTHON), str(SEED_ROOT / 'inference_cli.py'), str(prepared), '--output', str(restored), '--model_dir', str(SEED_MODELS), '--dit_model', 'seedvr2_ema_3b_fp16.safetensors', '--resolution', str(resolution), '--max_resolution', '1920', '--batch_size', '5', '--uniform_batch_size', '--cache_dit', '--cache_vae', '--chunk_size', '25', '--temporal_overlap', '1', '--seed', '42', '--video_backend', 'ffmpeg', '--vae_encode_tiled', '--vae_decode_tiled', '--vae_encode_tile_size', '512', '--vae_decode_tile_size', '512'], cwd=SEED_ROOT, env=env, stdout=subprocess.PIPE, text=True, errors='replace')
    for line in process.stdout:
        job['log'].write(line.encode('utf-8'))
        match = re.search(r'(Encoding|Upscaling|Decoding) batch (\d+)/(\d+)', line)
        if match:
            job['detail'] = {'phase': match[1], 'batch': int(match[2]), 'batches': int(match[3])}
    if process.wait() != 0 or not restored.exists():
        raise RuntimeError('SeedVR2 processing failed; see the local ffmpeg.log')
    job.update(progress=0.95, stage='encoding')
    process = checked_process(job, ['ffmpeg', '-nostdin', '-y', '-v', 'error', *INPUT_OPTIONS, '-i', str(restored), *INPUT_OPTIONS, *job.get('seek', []), '-i', str(source), *trim, '-map', '0:v:0', '-map', '1:a:0?', '-shortest', *encode, str(output)])
    if process.wait() != 0:
        raise RuntimeError('SeedVR2 audio muxing failed')
    prepared.unlink(missing_ok=True); restored.unlink(missing_ok=True)
INPUT_OPTIONS = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm']


def probe(path, allow_hdr=False):
    result = subprocess.run(['ffprobe', '-v', 'error', *INPUT_OPTIONS, '-show_streams', '-show_format', '-of', 'json', str(path)], capture_output=True, text=True, timeout=30, check=True)
    info = json.loads(result.stdout)
    video = next((stream for stream in info['streams'] if stream['codec_type'] == 'video'), None)
    if not video:
        raise ValueError('No decodable video track')
    if video.get('color_transfer') in ('smpte2084', 'arib-std-b67') and not allow_hdr:
        raise ValueError('HDR input requires a separate tone-mapping workflow; this enhancer accepts SDR video')
    width, height = int(video['width']), int(video['height'])
    rotation = next((data.get('rotation', 0) for data in video.get('side_data_list', []) if 'rotation' in data), 0)
    if abs(int(rotation)) % 180 == 90:
        width, height = height, width
    numerator, denominator = map(int, video.get('avg_frame_rate', '30/1').split('/'))
    if not denominator or not numerator:
        numerator, denominator = map(int, video.get('r_frame_rate', '30/1').split('/'))
    fps = numerator / denominator if denominator else 30
    if width <= 0 or height <= 0 or width * height > 3840 * 2160 or not 1 <= fps <= 120:
        raise ValueError('Supported input: up to 4K and 120 fps')
    duration = float(info.get('format', {}).get('duration') or video.get('duration') or 0)
    return width, height, fps, duration


def source_encoding(path):
    result = subprocess.run(['ffprobe', '-v', 'error', *INPUT_OPTIONS, '-show_streams', '-of', 'json', str(path)], capture_output=True, text=True, timeout=30, check=True)
    streams = json.loads(result.stdout)['streams']
    audio = next((item for item in streams if item['codec_type'] == 'audio'), {})
    video = next(item for item in streams if item['codec_type'] == 'video')
    audio_options = ['-c:a', 'copy'] if audio.get('codec_name') in ('aac', 'alac', 'mp3') or not audio else ['-c:a', 'aac', '-b:a', '256k']
    color_options = []
    for key, flag in [('color_space', '-colorspace'), ('color_transfer', '-color_trc'), ('color_primaries', '-color_primaries'), ('color_range', '-color_range')]:
        if video.get(key) and video[key] not in ('unknown', 'unspecified'):
            color_options.extend([flag, video[key]])
    return audio_options, color_options, video.get('color_transfer') in ('smpte2084', 'arib-std-b67')

def tone_map_ready():
    try:
        return ' zscale ' in subprocess.check_output(['ffmpeg','-hide_banner','-filters'],stderr=subprocess.DEVNULL,text=True,timeout=5)
    except (OSError,subprocess.SubprocessError):return False

HDR_TO_SDR = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=2,zscale=t=bt709:m=bt709:r=limited,format=yuv420p'

def update_ffmpeg_progress(job, line, duration):
    # FFmpeg can emit N/A before the first output timestamp is available.
    if not duration or not line.startswith('out_time_us='):
        return
    value = line.partition('=')[2].strip()
    if not re.fullmatch(r'[0-9]+', value):
        return
    job['progress'] = max(job.get('progress', 0), min(0.99, int(value) / 1e6 / duration))


def checked_process(job, command, **kwargs):
    if job['cancel'].is_set():
        raise InterruptedError('Cancelled')
    stderr = kwargs.pop('stderr', job['log'])
    process = subprocess.Popen(command, stderr=stderr, start_new_session=os.name == 'posix', **kwargs)
    job['processes'].append(process)
    if job['cancel'].is_set(): stop_process(process)
    return process

def stop_process(process, force=False):
    try:
        if process.poll() is not None: return
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
        elif process.poll() is None:
            process.kill() if force else process.terminate()
    except ProcessLookupError:
        pass


def run_job(job):
    source, output = job['source'], job['output']
    monitor_done = threading.Event()
    def monitor_disk():
        while not monitor_done.wait(2):
            if shutil.disk_usage(source.parent).free < 128 * 1024 * 1024:
                job['resourceError'] = 'Disk space became insufficient; free space and retry.'
                job['cancel'].set()
                for process in list(job['processes']): stop_process(process)
                return
    monitor = threading.Thread(target=monitor_disk, daemon=True); monitor.start()
    try:
        with open(source.parent / 'ffmpeg.log', 'wb') as log:
            job['log'] = log
            audio_encode,color_encode,hdr = source_encoding(source)
            tone_map = bool(job.get('toneMap'))
            width, height, fps, duration = probe(source, allow_hdr=tone_map)
            if hdr and tone_map and not tone_map_ready():
                raise ValueError('HDR conversion requires FFmpeg with zscale. On Mac install ffmpeg-full and restart the helper.')
            if hdr and tone_map and job['mode'] not in FILTERS and job['mode'] != 'edit':
                raise ValueError('HDR to SDR supports Natural, Brightness and Edit modes; AI requires an SDR source')
            start = float(job.get('start', 0))
            end = float(job.get('end', 0))
            if duration and start >= duration:
                raise ValueError('Start must be before the end of the video')
            if end and (end <= start or (duration and end > duration + .05)):
                raise ValueError('Invalid trim range')
            preview_seconds = job.get('previewSeconds', 5)
            limit = min(preview_seconds, duration - start) if job['preview'] and duration else (preview_seconds if job['preview'] else (end - start if end else max(0, duration - start)))
            if not job['preview'] and job['mode'] != 'edit':
                start = 0; limit = duration
            job['seek'] = ['-ss', str(start)] if start else []
            job.update(state='processing', duration=limit, width=width, height=height,frameRate=fps)
            persist_job(job) if job.get('id') else None
            # Conservative temporary-space budget; actual disk pressure is checked while processing.
            pixels = width * height * (4 if job['mode'] == 'ai' else 1)
            budget = max(source.stat().st_size * (8 if job['mode'] == 'strong' else 3), int(pixels * fps * (limit or 5) * .10)) + 512 * 1024 * 1024
            if shutil.disk_usage(source.parent).free < budget:
                raise ValueError('Not enough disk space for this job. Trim the video or free space first.')
            trim = ['-t', str(limit)] if limit else []
            master=job.get('encoding') == 'master'
            encode = ['-c:v', 'libx264', '-preset', 'slow' if master else 'fast', '-crf', '16' if master else '18', '-pix_fmt', 'yuv444p' if master else 'yuv420p', *(['-tune','animation'] if master else []), *audio_encode, *( ['-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-color_range','tv'] if hdr and tone_map else color_encode), '-movflags', '+faststart']
            if job['mode']=='trimstatic':
                trim_static_tail(job,source,output,duration,globals())
            elif job['mode']=='audio':
                preset=job.get('audioPreset','level')
                audio_filter={'voice':'highpass=f=90,equalizer=f=2200:t=q:w=1:g=3,afftdn=nf=-25','night':'acompressor=threshold=0.08:ratio=6:attack=10:release=200:makeup=2,alimiter=limit=0.9','level':'loudnorm=I=-16:TP=-1.5:LRA=11'}[preset]
                if preset=='level':
                    analysis=checked_process(job,['ffmpeg','-nostdin','-v','info',*INPUT_OPTIONS,'-i',str(source),*trim,'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],stderr=subprocess.PIPE,text=True)
                    _,report=analysis.communicate()
                    if analysis.returncode!=0: raise RuntimeError('Audio loudness analysis failed')
                    match=re.findall(r'\{[^{}]*"input_i"[^{}]*\}',report,re.S)
                    if not match: raise ValueError('No analyzable audio track')
                    measured=json.loads(match[-1])
                    if measured['input_i']=='-inf': raise ValueError('Source audio is silent')
                    audio_filter=f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}:linear=true"
                process=checked_process(job,['ffmpeg','-nostdin','-y','-v','error',*INPUT_OPTIONS,'-i',str(source),*trim,'-map','0:v:0','-map','0:a:0','-c:v','copy','-af',audio_filter,'-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-progress','pipe:1',str(output)],stdout=subprocess.PIPE,text=True)
                for line in process.stdout: update_ffmpeg_progress(job,line,limit)
                if process.wait()!=0: raise RuntimeError('Audio processing failed')
            elif job['mode'] == 'strong':
                run_seed(job, source, output, width, height, trim, encode)
            elif job['mode'] != 'ai':
                video_filter=watermark_filter(job,width,height) if job['mode']=='watermark' else edit_filter(job,width,height) if job['mode']=='edit' else enhancement_filter(job['mode'],job.get('strength',1),job.get('captureContent','auto')) + ',pad=ceil(iw/2)*2:ceil(ih/2)*2'
                command = ['ffmpeg', '-nostdin', '-y', '-v', 'error', *INPUT_OPTIONS, *job.get('seek', []), '-i', str(source), *trim, '-map', '0:v:0', '-map', '0:a:0?', '-vf',video_filter, *encode, '-progress', 'pipe:1', str(output)]
                if hdr and tone_map:
                    command[command.index('-vf')+1] = HDR_TO_SDR + ',' + video_filter
                process = checked_process(job, command, stdout=subprocess.PIPE, text=True)
                for line in process.stdout:
                    update_ffmpeg_progress(job, line, limit)
                if process.wait() != 0:
                    raise RuntimeError('Video processing failed; see the local ffmpeg.log')
            else:
                if width * height > 1920 * 1080:
                    raise ValueError('AI 2x supports up to 1080p input (up to 4K output)')
                import cv2
                import numpy as np
                if hashlib.sha256(MODEL.read_bytes()).hexdigest() != MODEL_HASH:
                    raise RuntimeError('AI model checksum mismatch')
                cv2.setNumThreads(max(1, min(4, os.cpu_count() or 1)))
                model = cv2.dnn_superres.DnnSuperResImpl_create()
                model.readModel(str(MODEL)); model.setModel('fsrcnn', 2)
                decoder = checked_process(job, ['ffmpeg', '-nostdin', '-v', 'error', *INPUT_OPTIONS, *job.get('seek', []), '-i', str(source), *trim, '-map', '0:v:0', '-vf', f'fps={fps}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'], stdout=subprocess.PIPE)
                encoder = checked_process(job, ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{width*2}x{height*2}', '-r', str(fps), '-i', 'pipe:0', *INPUT_OPTIONS, *job.get('seek', []), '-i', str(source), *trim, '-map', '0:v:0', '-map', '1:a:0?', '-shortest', *encode, str(output)], stdin=subprocess.PIPE)
                frame_size, frames = width * height * 3, 0
                while True:
                    if job['cancel'].is_set():
                        raise InterruptedError('Cancelled')
                    data = bytearray()
                    while len(data) < frame_size:
                        block = decoder.stdout.read(frame_size - len(data))
                        if not block:
                            break
                        data.extend(block)
                    if not data:
                        break
                    if len(data) != frame_size:
                        raise RuntimeError('Incomplete decoded frame')
                    frame = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
                    enhanced=model.upsample(frame)
                    strength=job.get('strength',1)
                    if strength<1: enhanced=cv2.addWeighted(enhanced,strength,cv2.resize(frame,(width*2,height*2),interpolation=cv2.INTER_CUBIC),1-strength,0)
                    encoder.stdin.write(enhanced.tobytes())
                    frames += 1
                    if limit:
                        job['progress'] = min(0.99, frames / fps / limit)
                encoder.stdin.close()
                if decoder.wait() != 0 or encoder.wait() != 0 or not frames:
                    raise RuntimeError('AI encoding failed; see the local ffmpeg.log')
                job.update(width=width*2, height=height*2)
            if job['cancel'].is_set():
                raise InterruptedError('Cancelled')
            # Confirm the result, including duration when the original container lacks it.
            out_width, out_height, _, output_duration = probe(output)
            job.update(width=out_width, height=out_height)
            job.update(state='done', progress=1, duration=output_duration, size=output.stat().st_size)
            if job.get('id'): persist_job(job)
    except Exception as error:
        job.update(state='error' if job.get('resourceError') else 'cancelled' if job['cancel'].is_set() else 'error', error=job.get('resourceError') or str(error))
    finally:
        monitor_done.set(); monitor.join(timeout=3)
        for process in job['processes']:
            stop_process(process, force=True)
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()
        job.pop('log', None)
        source.unlink(missing_ok=True)
        for name in ('seed-input.mp4', 'seed-output.mp4'):
            (source.parent / name).unlink(missing_ok=True)
        if job['state'] != 'done':
            output.unlink(missing_ok=True)
        try:
            if job.get('id'): persist_job(job)
        finally:
            SLOT.release()


def watermark_filter(job,width,height):
    region=job.get('watermark')
    if not region or len(region)!=4: raise ValueError('Select a watermark region first')
    x,y,w,h=region
    if x<1 or y<1 or w<4 or h<4 or x+w>=width or y+h>=height:
        raise ValueError('Watermark region needs a border inside the image. Use crop for edge watermarks.')
    return f'delogo=x={x}:y={y}:w={w}:h={h},pad=ceil(iw/2)*2:ceil(ih/2)*2'

def edit_filter(job, width, height):
    filters = []
    crop = job.get('crop')
    if crop:
        x, y, w, h = crop
        if x < 0 or y < 0 or w < 2 or h < 2 or x+w > width or y+h > height:
            raise ValueError('Crop exceeds the source video dimensions')
        filters.append(f'crop={w}:{h}:{x}:{y}')
    angle = float(job.get('rotation', 0)) % 360
    if angle == 90: filters.append('transpose=clock')
    elif angle == 180: filters.extend(['hflip', 'vflip'])
    elif angle == 270: filters.append('transpose=cclock')
    elif angle:
        radians = angle * 3.141592653589793 / 180
        filters.append(f'rotate={radians}:ow=rotw({radians}):oh=roth({radians}):c=black')
    if job.get('landscape'): filters.extend(['scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black'])
    filters.append('pad=ceil(iw/2)*2:ceil(ih/2)*2')
    return ','.join(filters)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def cors_headers(self):
        origin = self.headers.get('Origin', '')
        if origin.startswith('chrome-extension://') or origin.startswith('http://127.0.0.1:') or origin.startswith('http://localhost:'):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-WeScreen-Token, X-Frame-Width, X-Frame-Height, X-Protect-Text')
        self.send_header('Access-Control-Expose-Headers', 'X-Inference-Ms')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status); self.cors_headers()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def authorized(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'):
            self.reply(403, {'error': 'Invalid host'}); return False
        if not hmac.compare_digest(self.headers.get('X-WeScreen-Token', ''), TOKEN):
            self.reply(401, {'error': 'Invalid local access token'}); return False
        return True

    def do_OPTIONS(self):
        self.send_response(204); self.cors_headers(); self.end_headers()

    def do_POST(self):
        if urlparse(self.path).path == '/connect':
            origin = self.headers.get('Origin', '')
            if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}') or not re.fullmatch(r'chrome-extension://[a-p]{32}', origin):
                return self.reply(403, {'error': 'Automatic connection is only available to a browser extension'})
            with PAIR_GUARD:
                nonce = parse_qs(urlparse(self.path).query).get('challenge', [''])[0]
                try: approved=connect_origin(PAIR_FILE, origin, nonce)
                except (OSError,ValueError): return self.reply(503,{'error':'Pairing metadata could not be read; check local file permissions.'})
                if not approved:
                    return self.reply(403, {'error': 'Helper is paired with another extension. Approve this extension in the local launcher.', 'code': 'PAIRING_REQUIRED', 'nativePairing': True})
            return self.reply(200, {'token': TOKEN})
        if not self.authorized():
            return
        if handle_media_post(self,urlparse(self.path).path,globals()): return
        if urlparse(self.path).path == '/realtime/frame':
            try: size = int(self.headers.get('Content-Length', '0'))
            except ValueError: size = 0
            raw=self.headers.get('Content-Type','').split(';')[0]=='application/x-wescreen-rgb'
            if not 0 < size <= (1080*1080*3 if raw else 2*1024*1024):
                return self.reply(413, {'error': 'Realtime frame must be under 2 MB'})
            if self.headers.get('Content-Type', '').split(';')[0] not in ('image/jpeg','image/png','application/x-wescreen-rgb'):
                return self.reply(415, {'error': 'Realtime input must be JPEG or PNG'})
            if not SLOT.acquire(blocking=False):
                return self.reply(409, {'error': 'Helper is busy; showing original video'})
            try:
                self.connection.settimeout(5)
                data = self.rfile.read(size)
                if len(data) != size: raise ValueError('Incomplete realtime frame')
                lossless=self.headers.get('Content-Type','').split(';')[0]=='image/png'
                if raw:
                    from realtime import enhance_rgb
                    try: width=int(self.headers.get('X-Frame-Width','0'));height=int(self.headers.get('X-Frame-Height','0'))
                    except ValueError: raise ValueError('Invalid RGB dimensions')
                    result,elapsed=enhance_rgb(data,width,height,MODEL,MODEL_HASH,self.headers.get('X-Protect-Text','1')!='0')
                else: result, elapsed = enhance_frame(data, MODEL, MODEL_HASH, lossless=lossless)
                self.send_response(200); self.cors_headers()
                self.send_header('Content-Type', 'application/x-wescreen-rgb' if raw else 'image/png' if lossless else 'image/jpeg')
                self.send_header('Content-Length', str(len(result)))
                self.send_header('X-Inference-Ms', str(round(elapsed, 2)))
                self.end_headers(); self.wfile.write(result)
            except ValueError as error: self.reply(400, {'error': str(error)})
            except (BrokenPipeError, ConnectionResetError): pass
            except Exception as error: self.reply(503, {'error': str(error)})
            finally: SLOT.release()
            return
        parsed = urlparse(self.path); query = parse_qs(parsed.query)
        parts = parsed.path.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'jobs' and parts[2] == 'export':
            with GUARD: job = JOBS.get(parts[1])
            if not job or job['state'] != 'done': return self.reply(409, {'error': 'Result is not ready'})
            ticket = secrets.token_urlsafe(32)
            job.update(exportTicket=ticket, exportUntil=time.time()+120)
            return self.reply(200, {'url': f'http://127.0.0.1:{self.server.server_port}/jobs/{job["id"]}/result?ticket={ticket}'})
        try: preview_seconds = int(query.get('previewSeconds', ['5'])[0])
        except ValueError: return self.reply(400, {'error': 'Invalid preview duration'})
        if preview_seconds not in (3, 5, 10): return self.reply(400, {'error': 'Preview duration must be 3, 5 or 10 seconds'})
        mode = query.get('mode', ['basic'])[0]
        if parsed.path != '/jobs' or mode not in (*FILTERS, 'ai', 'strong', 'edit','audio','trimstatic','watermark'):
            return self.reply(400, {'error': 'Invalid processing mode'})
        if mode == 'strong' and not seed_ready():
            return self.reply(503, {'error': 'SeedVR2 is not installed. Run enhancement/install-seedvr.sh first.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = 0
        if not 0 < size <= 1600 * 1024 * 1024:
            return self.reply(413, {'error': 'Input must be between 1 byte and 1.6 GB'})
        encoding=query.get('encoding',['compatible'])[0]
        if encoding not in ('compatible','master'): return self.reply(400,{'error':'Invalid encoding preset'})
        if not SLOT.acquire(blocking=False):
            return self.reply(409, {'error': 'Another enhancement is running'})
        try:
            if shutil.disk_usage(WORK).free < size * 2 + 512 * 1024 * 1024:
                raise ValueError('Not enough disk space to accept the video')
            audio_preset=query.get('audioPreset',['level'])[0]
            if audio_preset not in ('voice','night','level'):raise ValueError('Invalid audio preset')
            strength=float(query.get('strength',['1'])[0])
            if not 0 <= strength <= 1: raise ValueError('Enhancement strength must be 0–1')
            rotation = float(query.get('rotation', ['0'])[0])
            if not (0 <= rotation <= 360): raise ValueError('Invalid rotation')
            start = float(query.get('start', ['0'])[0]); end = float(query.get('end', ['0'])[0])
            if not (0 <= start <= 86400 and 0 <= end <= 86400):
                raise ValueError('Invalid time range')
            crop = [int(value) for value in query['crop'][0].split(',')] if query.get('crop') else None
            if crop and (len(crop) != 4 or any(value < 0 or value > 8192 for value in crop)):
                raise ValueError('Invalid crop')
            watermark = [int(value) for value in query['watermark'][0].split(',')] if query.get('watermark') else None
            if mode=='watermark' and (not watermark or len(watermark)!=4 or any(v<1 or v>8192 for v in watermark)): raise ValueError('Invalid watermark region')
            identifier = secrets.token_hex(16)
            directory = WORK / identifier; directory.mkdir(mode=0o700)
        except Exception as error:
            SLOT.release()
            return self.reply(400, {'error': str(error)})
        source = directory / 'input'; output = directory / 'enhanced.mp4'
        try:
            self.connection.settimeout(120)
            with source.open('wb') as target:
                remaining = size
                while remaining:
                    block = self.rfile.read(min(1024*1024, remaining))
                    if not block:
                        raise ValueError('Incomplete input')
                    target.write(block); remaining -= len(block)
        except Exception as error:
            SLOT.release(); shutil.rmtree(directory, ignore_errors=True)
            return self.reply(400, {'error': str(error)})
        capture_content=query.get('captureContent',['auto'])[0]
        if capture_content not in ('auto','detail','motion'): capture_content='auto'
        job = dict(id=identifier,encoding=encoding,captureContent=capture_content,toneMap=query.get('toneMap',['0'])==['1'],watermark=watermark,requireSilence=query.get('requireSilence',['1'])==['1'], audioPreset=audio_preset,strength=strength, previewSeconds=preview_seconds, mode=mode, preview=query.get('preview') == ['1'], rotation=rotation, landscape=query.get('landscape')==['1'], batchRef=query.get('batchRef', [''])[0][:150], start=start, end=end, crop=crop, sourceId=query.get('sourceId', [''])[0][:150], name=query.get('name', ['enhanced.mp4'])[0][:150], createdAt=int(time.time()*1000), source=source, output=output, state='queued', progress=0, cancel=threading.Event(), processes=[])
        try:
            persist_job(job)
            with GUARD: JOBS[identifier] = job
            worker = threading.Thread(target=run_job, args=(job,), daemon=True)
            job['worker'] = worker; worker.start()
        except Exception as error:
            with GUARD: JOBS.pop(identifier, None)
            SLOT.release(); shutil.rmtree(directory, ignore_errors=True)
            return self.reply(500, {'error': str(error)})
        self.reply(202, {'id': identifier})

    def do_GET(self):
        parsed = urlparse(self.path); path = parsed.path
        parts = path.strip('/').split('/')
        with GUARD: exported = JOBS.get(parts[1]) if len(parts) == 3 and parts[0] == 'jobs' and parts[2] == 'result' else None
        ticket = parse_qs(parsed.query).get('ticket', [''])[0]
        valid_ticket = bool(exported and exported.get('exportTicket') and time.time() < exported.get('exportUntil', 0) and hmac.compare_digest(ticket, exported['exportTicket']) and self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'))
        if not valid_ticket and not self.authorized(): return
        if path == '/jobs':
            with GUARD: jobs = [{key: job[key] for key in PUBLIC_KEYS if key in job} for job in JOBS.values()]
            return self.reply(200, {'jobs': jobs})
        if path == '/health':
            return self.reply(200, {'version':'1.19.0','nativePairing':True,'smartTail':True,'watermark':True,'merge':True,'diskFree':shutil.disk_usage(WORK).free,'ready': True, 'ai': MODEL.exists(), 'strong': seed_ready(), 'realtime': MODEL.exists(), 'realtimeLossless':True,'realtimeRGB':True,'realtimeEngine':'FSRCNN fallback','realtimeTemporal':False,'toneMap':tone_map_ready(),'realtimeModel': 'FSRCNN 2x', 'model': 'FSRCNN 2x', 'strongModel': 'SeedVR2 3B FP16'})
        parts = path.strip('/').split('/')
        with GUARD:
            job = JOBS.get(parts[1]) if len(parts) >= 2 and parts[0] == 'jobs' else None
        if not job:
            return self.reply(404, {'error': 'Unknown job'})
        if len(parts) == 3 and parts[2] == 'result':
            if job['state'] != 'done':
                return self.reply(409, {'error': 'Result is not ready'})
            self.send_response(200); self.cors_headers(); self.send_header('Content-Disposition', 'attachment; filename=enhanced.mp4'); self.send_header('Content-Type', 'video/mp4'); self.send_header('Content-Length', str(job['output'].stat().st_size)); self.end_headers()
            with job['output'].open('rb') as video:
                shutil.copyfileobj(video, self.wfile)
            return
        self.reply(200, {key: job[key] for key in PUBLIC_KEYS if key in job})

    def do_DELETE(self):
        if not self.authorized():
            return
        parts = urlparse(self.path).path.strip('/').split('/')
        with GUARD:
            job = JOBS.get(parts[1]) if len(parts) == 2 and parts[0] == 'jobs' else None
        if not job:
            return self.reply(404, {'error': 'Unknown job'})
        if job['state'] in ('queued', 'processing'):
            job['cancel'].set()
            for process in job['processes']:
                stop_process(process)
        else:
            with GUARD:
                JOBS.pop(job['id'], None)
            shutil.rmtree(job['output'].parent, ignore_errors=True)
        self.reply(200, {'ok': True})


if __name__ == '__main__':
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise SystemExit('Install ffmpeg and ffprobe first')
    try:
        http = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('WESCREEN_PORT', '8765'))), Handler)
    except OSError as error:
        raise SystemExit(f'Cannot start local enhancer on port 8765: {error}')
    if not os.environ.get('WESCREEN_ENHANCE_TOKEN'):
        runtime = ROOT / '.runtime'; runtime.mkdir(exist_ok=True)
        token_file = runtime / 'token.txt'; token_file.write_text(TOKEN); token_file.chmod(0o600)
    print(f'Local enhancer: http://127.0.0.1:{http.server_port}', flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http.server_close()
        for job in list(JOBS.values()):
            job['cancel'].set()
            for process in list(job['processes']):
                stop_process(process, force=True)
                process.wait()
        for job in list(JOBS.values()):
            if job.get('worker'): job['worker'].join(timeout=5)
        # Finished results persist across restarts until explicitly deleted.
