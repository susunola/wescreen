"""Size optimisation and animated export, run by the local helper with FFmpeg.

The browser records fast and roughly (a real-time encoder with a bitrate target). Here we have time, so a
finished recording can be re-encoded with a slow constant-quality encoder: the same text sharpness in
fewer bytes (see bench/RESULTS.md for the measurements behind the defaults), or exported as a short GIF /
animated WebP for chat and docs.

Command construction is pure (no subprocess, no filesystem) so it can be unit-tested without FFmpeg.
"""
import json
import math
import re
import secrets
import shutil
import subprocess
import threading
import time
from pathlib import Path

# Constant-quality settings per codec. Lower CRF = larger, sharper. Anchored on the sweep in bench/results
# (x264 20/26/32, x265 22/28/34, svtav1 30/38/46, vp9 28/36/44) and nudged toward the sharper end because
# screen recordings are mostly text, where soft edges are the visible failure.
CRF = {
    'x264': {'archive': 18, 'balanced': 23, 'small': 28},
    'x265': {'archive': 22, 'balanced': 26, 'small': 30},
    'svtav1': {'archive': 28, 'balanced': 34, 'small': 40},
    'vp9': {'archive': 28, 'balanced': 34, 'small': 40},
}
ENCODER_NAMES = {'x264': 'libx264', 'x265': 'libx265', 'svtav1': 'libsvtav1', 'vp9': 'libvpx-vp9'}
CONTAINERS = {'x264': 'mp4', 'x265': 'mp4', 'svtav1': 'mp4', 'vp9': 'webm'}
ANIMATED = ('gif', 'webp')
QUALITIES = ('archive', 'balanced', 'small')
MAX_ANIMATION_SECONDS = 60
MAX_ANIMATION_WIDTH = 1280
MIME = {'mp4': 'video/mp4', 'webm': 'video/webm', 'gif': 'image/gif', 'webp': 'image/webp'}


def available_encoders(ffmpeg_output=None):
    """Which of our codecs this FFmpeg build can encode."""
    if ffmpeg_output is None:
        try:
            ffmpeg_output = subprocess.check_output(['ffmpeg', '-hide_banner', '-encoders'], stderr=subprocess.DEVNULL, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            ffmpeg_output = ''
    found = {name for name in ENCODER_NAMES.values() if re.search(rf'\s{re.escape(name)}\s', ffmpeg_output)}
    result = [codec for codec, name in ENCODER_NAMES.items() if name in found]
    if re.search(r'\slibwebp_anim\s', ffmpeg_output): result.append('webp')
    result.append('gif')  # built into every FFmpeg
    return result


def even(value):
    return max(2, int(value) // 2 * 2)


def scaled_size(width, height, max_height=0, max_width=0):
    """Fit inside the limits without ever enlarging; keeps dimensions even for yuv420p."""
    scale = 1.0
    if max_height and height > max_height: scale = min(scale, max_height / height)
    if max_width and width > max_width: scale = min(scale, max_width / width)
    return even(width * scale), even(height * scale)


def validate(options, available):
    """Normalise untrusted request options. Raises ValueError with a user-facing message."""
    target = options.get('target', 'x265')
    if target not in (*CRF, *ANIMATED): raise ValueError('Unknown target format')
    if target not in available: raise ValueError(f'This FFmpeg build cannot encode {target}')
    quality = options.get('quality', 'balanced')
    if quality not in QUALITIES: raise ValueError('Quality must be archive, balanced or small')
    max_height = int(options.get('maxHeight') or 0)
    if not 0 <= max_height <= 4320: raise ValueError('Invalid maximum height')
    max_fps = float(options.get('maxFps') or 0)
    if not 0 <= max_fps <= 120: raise ValueError('Invalid maximum frame rate')
    start, end = float(options.get('start') or 0), float(options.get('end') or 0)
    if start < 0 or end < 0 or (end and end <= start): raise ValueError('Invalid trim range')
    if not all(math.isfinite(v) for v in (max_fps, start, end)): raise ValueError('Invalid number')
    return dict(target=target, quality=quality, maxHeight=max_height, maxFps=max_fps, start=start, end=end)


def video_filter(width, height, fps, options):
    parts = []
    target_width, target_height = scaled_size(width, height, options['maxHeight'])
    if (target_width, target_height) != (width, height) or width % 2 or height % 2:
        parts.append(f'scale={target_width}:{target_height}:flags=lanczos')
    if options['maxFps'] and fps > options['maxFps'] + .5:
        parts.append(f'fps={options["maxFps"]:g}')
    return parts


def trim_arguments(options):
    seek = ['-ss', f'{options["start"]:g}'] if options['start'] else []
    length = ['-t', f'{options["end"] - options["start"]:g}'] if options['end'] else []
    return seek, length


def optimize_command(source, output, options, probe_info):
    """FFmpeg arguments for a constant-quality re-encode. probe_info = {'width','height','fps','audio_codec'}."""
    target, quality = options['target'], options['quality']
    seek, length = trim_arguments(options)
    command = ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', *seek, '-i', str(source), *length, '-map', '0:v:0', '-map', '0:a:0?']
    filters = video_filter(probe_info['width'], probe_info['height'], probe_info['fps'], options)
    if filters: command += ['-vf', ','.join(filters)]
    crf = str(CRF[target][quality])
    if target == 'x264':
        command += ['-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    elif target == 'x265':
        command += ['-c:v', 'libx265', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-movflags', '+faststart']
    elif target == 'svtav1':
        command += ['-c:v', 'libsvtav1', '-preset', '6', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    else:  # vp9 / webm
        command += ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', crf, '-row-mt', '1', '-cpu-used', '2', '-pix_fmt', 'yuv420p']
    if CONTAINERS[target] == 'webm':
        command += ['-c:a', 'libopus', '-b:a', '96k']
    elif probe_info.get('audio_codec') in ('aac', 'mp3', 'alac'):
        command += ['-c:a', 'copy']
    else:
        command += ['-c:a', 'aac', '-b:a', '128k']
    return [*command, '-progress', 'pipe:1', str(output)]


def animation_command(source, output, options, probe_info):
    """GIF (two-pass palette in one command) or animated WebP, bounded in size, duration and frame rate."""
    target, quality = options['target'], options['quality']
    seek, length = trim_arguments(options)
    fps = options['maxFps'] or {'archive': 15, 'balanced': 12, 'small': 8}[quality]
    fps = min(fps, 30 if target == 'webp' else 20)
    width = min(probe_info['width'], MAX_ANIMATION_WIDTH, {'archive': 1280, 'balanced': 960, 'small': 640}[quality])
    if options['maxHeight']:
        width = min(width, even(probe_info['width'] * min(1, options['maxHeight'] / probe_info['height'])))
    width = even(width)
    base = f'fps={fps:g},scale={width}:-2:flags=lanczos'
    head = ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', *seek, '-i', str(source), *length, '-an']
    if target == 'gif':
        colors = {'archive': 256, 'balanced': 192, 'small': 96}[quality]
        graph = f'{base},split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
        return [*head, '-filter_complex', graph, '-loop', '0', '-progress', 'pipe:1', str(output)]
    webp_quality = {'archive': 90, 'balanced': 75, 'small': 55}[quality]
    return [*head, '-vf', base, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', str(webp_quality), '-preset', 'text', '-compression_level', '6', '-loop', '0', '-progress', 'pipe:1', str(output)]


def output_name(target):
    extension = CONTAINERS.get(target) or target
    return f'optimized.{extension}', MIME[extension]


def handle_optimize_post(handler, path, api):
    """POST /jobs/optimize  {parts:[uploadId], target, quality, maxHeight, maxFps, start, end, name}"""
    if path != '/jobs/optimize': return False
    work, slot, jobs, guard = api['WORK'], api['SLOT'], api['JOBS'], api['GUARD']
    try:
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= 65536: raise ValueError('Invalid request size')
        handler.connection.settimeout(10)
        data = json.loads(handler.rfile.read(length))
        identifier_in = data.get('upload')
        if not isinstance(identifier_in, str) or not re.fullmatch('[a-f0-9]{32}', identifier_in): raise ValueError('Invalid upload identifier')
        source = work / 'uploads' / identifier_in
        if not source.is_file(): raise ValueError('Uploaded video is missing')
        options = validate(data, available_encoders())
        if options['target'] in ANIMATED:
            seconds = (options['end'] - options['start']) if options['end'] else 0
            if seconds > MAX_ANIMATION_SECONDS: raise ValueError(f'Animated exports are limited to {MAX_ANIMATION_SECONDS} seconds; trim first')
        if shutil.disk_usage(work).free < source.stat().st_size * 2 + 512 * 1024 * 1024: raise ValueError('Insufficient disk space')
        if not slot.acquire(blocking=False):
            handler.reply(409, {'error': 'Another processing job is running'}); return True
        identifier = secrets.token_hex(16); directory = work / identifier
        try:
            directory.mkdir(mode=0o700)
            moved = directory / 'source'; source.rename(moved)
            filename, mime = output_name(options['target'])
            job = dict(id=identifier, mode='optimize', target=options['target'], quality=options['quality'], name=str(data.get('name', 'video'))[:150],
                       sourceId=str(data.get('sourceId', ''))[:150], batchRef=str(data.get('batchRef', ''))[:150], createdAt=int(time.time() * 1000), preview=False,
                       state='queued', progress=0, source=moved, output=directory / filename, outputName=filename, mime=mime,
                       cancel=threading.Event(), processes=[], inputBytes=moved.stat().st_size, start=options['start'], end=options['end'])
            api['persist_job'](job)
            with guard: jobs[identifier] = job
            worker = threading.Thread(target=run_optimize, args=(job, options, api), daemon=True); job['worker'] = worker; worker.start()
        except Exception:
            slot.release(); raise
        handler.reply(202, {'id': identifier}); return True
    except Exception as error:
        handler.reply(400, {'error': str(error)}); return True


def run_optimize(job, options, api):
    source, output = job['source'], job['output']
    done = threading.Event()

    def monitor_disk():
        while not done.wait(1):
            if shutil.disk_usage(output.parent).free < 256 * 1024 * 1024:
                job['resourceError'] = 'Disk space became insufficient; free space and retry.'
                job['cancel'].set()
                for process in list(job['processes']): api['stop_process'](process)
                return
    threading.Thread(target=monitor_disk, daemon=True).start()
    try:
        job.update(state='processing', stage='optimize')
        width, height, fps, duration = api['probe'](source)
        audio = subprocess.run(['ffprobe', '-v', 'error', *api['INPUT_OPTIONS'], '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', str(source)], capture_output=True, text=True, timeout=30).stdout.strip()
        info = dict(width=width, height=height, fps=fps, audio_codec=audio)
        span = (options['end'] or duration) - options['start']
        if not math.isfinite(span) or span <= 0: raise ValueError('Cannot determine the length to encode')
        if options['target'] in ANIMATED and span > MAX_ANIMATION_SECONDS: raise ValueError(f'Animated exports are limited to {MAX_ANIMATION_SECONDS} seconds; trim first')
        command = (animation_command if options['target'] in ANIMATED else optimize_command)(source, output, options, info)
        with (output.parent / 'ffmpeg.log').open('wb') as log:
            job['log'] = log
            process = api['checked_process'](job, command, stdout=subprocess.PIPE, text=True)
            for line in process.stdout:
                api['update_ffmpeg_progress'](job, line, span)
            process.stdout.close()
            if process.wait() != 0:
                if job['cancel'].is_set(): raise InterruptedError('Cancelled')
                raise RuntimeError('Encoding failed; see the local ffmpeg.log')
        if job['cancel'].is_set(): raise InterruptedError('Cancelled')
        dimensions = {}
        if options['target'] in ANIMATED:
            out_duration = animated_duration(output)
        else:
            dimensions['width'], dimensions['height'], _, out_duration = api['probe'](output)
        # Never publish a truncated result; the original upload is kept by the caller until it downloads this.
        if out_duration and abs(out_duration - span) > max(1.0, span * .02):
            raise RuntimeError('Encoded duration does not match the recording. Export stopped; the original is preserved.')
        job.update(state='done', progress=1, duration=out_duration or span, size=output.stat().st_size,
                   **dimensions, savedRatio=round(1 - output.stat().st_size / max(1, job['inputBytes']), 4))
    except Exception as error:
        job.update(state='cancelled' if job['cancel'].is_set() else 'error', error=job.get('resourceError') or str(error))
        output.unlink(missing_ok=True)
    finally:
        done.set()
        source.unlink(missing_ok=True)
        job.pop('log', None); api['persist_job'](job); api['SLOT'].release()


def webp_duration(path):
    """Sum the frame delays of an animated WebP. FFmpeg cannot decode animated WebP, so read the container."""
    total = 0
    with Path(path).open('rb') as handle:
        header = handle.read(12)
        if len(header) < 12 or header[:4] != b'RIFF' or header[8:12] != b'WEBP': return 0
        while True:
            chunk = handle.read(8)
            if len(chunk) < 8: break
            size = int.from_bytes(chunk[4:8], 'little')
            if chunk[:4] == b'ANMF':
                frame = handle.read(16)
                if len(frame) < 16: break
                total += int.from_bytes(frame[12:15], 'little')
                handle.seek(size - 16 + (size & 1), 1)
            else:
                handle.seek(size + (size & 1), 1)
    return total / 1000


def animated_duration(path):
    """GIF durations come from packet timestamps; animated WebP from its own frame delays."""
    if Path(path).suffix == '.webp': return webp_duration(path)
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', str(path)],
                            capture_output=True, text=True, timeout=60)
    try:
        rows = [line.split(',') for line in result.stdout.splitlines() if line.strip()]
        return max(float(pts) + float(duration or 0) for pts, duration, *_ in rows)
    except (ValueError, TypeError):
        return 0
