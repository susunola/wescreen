"""Authenticated, bounded uploads and lossless-first merge jobs."""
import json
import secrets
import shutil
import subprocess
import threading
from pathlib import Path
import re
import time
import sys
import math


def handle_media_post(handler, path, api):
    work, slot, jobs, guard = api['WORK'], api['SLOT'], api['JOBS'], api['GUARD']
    if path not in ('/uploads', '/jobs/merge'): return False
    try:
        length = int(handler.headers.get('Content-Length', '0'))
        if path == '/uploads':
            if not 0 < length <= 1600 * 1024 * 1024: raise ValueError('Each part must be under 1.6 GB')
            if shutil.disk_usage(work).free < length * 2 + 512 * 1024 * 1024: raise ValueError('Insufficient disk space')
            upload = work / 'uploads'; upload.mkdir(exist_ok=True, mode=0o700)
            # Expire abandoned staging uploads; never touch library originals or completed jobs.
            for stale in upload.iterdir():
                if stale.is_file() and re.fullmatch('[a-f0-9]{32}',stale.name) and time.time()-stale.stat().st_mtime>86400: stale.unlink(missing_ok=True)
            identifier = secrets.token_hex(16); target = upload / identifier
            handler.connection.settimeout(120)
            try:
                with target.open('xb') as out:
                    remaining = length
                    while remaining:
                        block = handler.rfile.read(min(1024 * 1024, remaining))
                        if not block: raise ValueError('Incomplete upload')
                        out.write(block); remaining -= len(block)
                api['probe'](target)
            except Exception:
                target.unlink(missing_ok=True); raise
            handler.reply(201, {'id': identifier}); return True
        if not 0 < length <= 65536: raise ValueError('Invalid merge request size')
        handler.connection.settimeout(10)
        data = json.loads(handler.rfile.read(length)); ids = data.get('parts')
        if not isinstance(ids, list) or not 2 <= len(ids) <= 128 or len(set(ids)) != len(ids): raise ValueError('Choose 2–128 distinct parts')
        if any(not isinstance(i, str) or not re.fullmatch('[a-f0-9]{32}', i) for i in ids): raise ValueError('Invalid upload identifiers')
        sources = [work / 'uploads' / i for i in ids]
        if not all(p.is_file() for p in sources): raise ValueError('Uploaded part is missing')
        total = sum(p.stat().st_size for p in sources)
        if shutil.disk_usage(work).free < total * (3 if data.get('compatible') else 1.2) + 512 * 1024 * 1024: raise ValueError('Insufficient merge space')
        if not slot.acquire(blocking=False): handler.reply(409, {'error': 'Another processing job is running'}); return True
        identifier = secrets.token_hex(16); directory = work / identifier
        try:
            directory.mkdir(mode=0o700)
            parts = []
            for index, source in enumerate(sources):
                target = directory / f'part-{index:03d}'; source.rename(target); parts.append(target)
            job = dict(id=identifier,mode='merge',compress=bool(data.get('compress')),batchRef=str(data.get('batchRef',''))[:150],smartTail=bool(data.get('smartTail')),requireSilence=data.get('requireSilence') is not False,name=str(data.get('name','video'))[:150],sourceId=str(data.get('sourceId',''))[:150],createdAt=int(time.time()*1000),preview=False,compatible=bool(data.get('compatible')),state='queued',progress=0,source=parts[0],output=directory/'enhanced.mp4',cancel=threading.Event(),processes=[])
            api['persist_job'](job)
            with guard: jobs[identifier] = job
            worker = threading.Thread(target=run_merge,args=(job,parts,bool(data.get('compatible')),api),daemon=True); job['worker']=worker;worker.start()
        except Exception:
            slot.release(); raise
        handler.reply(202,{'id':identifier}); return True
    except Exception as error:
        handler.reply(400,{'error':str(error)}); return True


def stream_signature(path, options):
    result = subprocess.run(['ffprobe','-v','error',*options,'-show_streams','-show_data_hash','sha256','-of','json',str(path)],capture_output=True,text=True,timeout=30,check=True)
    streams = json.loads(result.stdout)['streams']
    keys = ('codec_type','codec_name','codec_tag_string','width','height','pix_fmt','sample_rate','channels','channel_layout','time_base','extradata_hash')
    return [{k:s.get(k) for k in keys} for s in streams if s['codec_type'] in ('video','audio')]


def compressed_dimensions(width, height):
    # Preserve the first part's aspect ratio without enlarging low-resolution sources.
    bounds = (1920, 1080) if width >= height else (1080, 1920)
    scale = min(1, bounds[0] / width, bounds[1] / height)
    return max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)


def compression_encoders():
    if sys.platform == 'darwin':
        try:
            available = subprocess.check_output(['ffmpeg', '-hide_banner', '-encoders'], stderr=subprocess.DEVNULL, text=True, timeout=10)
            if 'h264_videotoolbox' in available:
                return ['h264_videotoolbox', 'libx264']
        except (OSError, subprocess.SubprocessError):
            pass
    return ['libx264']


def encode_compressed_part(job, command, target, duration, offset, total, api):
    for encoder in compression_encoders():
        encoding = ['-c:v', encoder, '-b:v', '2200k', '-maxrate', '3500k', '-bufsize', '7000k', '-profile:v', 'high']
        if encoder == 'libx264':
            encoding += ['-preset', 'fast']
        process = api['checked_process'](job, [*command, *encoding, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-shortest', '-video_track_timescale', '90000', '-progress', 'pipe:1', str(target)], stdout=subprocess.PIPE, text=True)
        for line in process.stdout:
            if line.startswith('out_time_us=') and re.fullmatch(r'[0-9]+', line.partition('=')[2].strip()):
                seconds = min(duration, int(line.partition('=')[2]) / 1e6)
                job['progress'] = max(job.get('progress', 0), min(.95, (offset + seconds) / total * .95))
        process.stdout.close()
        if process.wait() == 0:
            return
        if job['cancel'].is_set():
            raise InterruptedError('Cancelled')
        target.unlink(missing_ok=True)
    raise RuntimeError('Compression failed; see the local ffmpeg.log')


def run_merge(job, parts, compatible, api):
    output=job['output']; directory=output.parent
    original_parts=list(parts); monitor_done=threading.Event()
    def monitor_disk():
        while not monitor_done.wait(1):
            if shutil.disk_usage(directory).free < 256*1024*1024:
                job['cancel'].set()
                for process in list(job['processes']): api['stop_process'](process)
                return
    threading.Thread(target=monitor_disk,daemon=True).start()
    try:
        job.update(state='processing',stage='merge'); api['persist_job'](job)
        signatures=[stream_signature(p,api['INPUT_OPTIONS']) for p in parts]
        durations=[api['probe'](p)[3] for p in parts]
        if any(not math.isfinite(d) or d <= 0 for d in durations): raise ValueError('Cannot determine recording duration')
        total_duration=sum(durations)
        same=all(s==signatures[0] for s in signatures[1:])
        compress = job.get('compress', False)
        if not same and not compatible and not compress: raise ValueError('Parts use different codecs or stream parameters. Enable compatibility encoding and retry; originals are preserved.')
        with (directory/'ffmpeg.log').open('wb') as log:
            job['log']=log
            if not same or compress:
                width,height,fps,_=api['probe'](parts[0]); width-=width%2; height-=height%2
                if compress:
                    width,height=compressed_dimensions(width,height)
                    fps=min(fps,30)
                    job['stage']='compressing'
                normalized=[]
                offset=0
                for i,p in enumerate(parts):
                    if job['cancel'].is_set(): raise InterruptedError('Cancelled')
                    target=directory/f'normalized-{i:03d}.mp4';has_audio=any(s['codec_type']=='audio' for s in signatures[i])
                    cmd=['ffmpeg','-nostdin','-y','-v','error',*api['INPUT_OPTIONS'],'-i',str(p)]
                    if not has_audio: cmd+=['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
                    cmd+=['-map','0:v:0','-map','0:a:0' if has_audio else '1:a:0','-vf',f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}']
                    if compress:
                        encode_compressed_part(job,cmd,target,durations[i],offset,total_duration,api)
                        offset+=durations[i]
                        job['progress']=offset/total_duration*.95
                    else:
                        cmd+=['-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-shortest','-video_track_timescale','90000',str(target)]
                        process=api['checked_process'](job,cmd)
                        if process.wait()!=0: raise RuntimeError('Compatibility encoding failed')
                        job['progress']=(i+1)/len(parts)*.8
                    normalized.append(target)
                parts=normalized
            job['stage']='merging'
            manifest=directory/'concat.txt';manifest.write_text(''.join(f"file '{p.name}'\n" for p in parts))
            # The concat protocol only opens server-generated filenames inside this job directory.
            process=api['checked_process'](job,['ffmpeg','-nostdin','-y','-v','error','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',str(manifest),'-map','0:v:0','-map','0:a:0?','-c','copy','-video_track_timescale','90000','-movflags','+faststart',str(output)])
            if process.wait()!=0: raise RuntimeError('Merge failed; try compatibility encoding')
            if job['cancel'].is_set(): raise InterruptedError('Cancelled')
            width,height,_,duration=api['probe'](output)
            # Never publish a result with an expanded or truncated timeline.
            if not math.isfinite(duration) or abs(duration-total_duration) > max(1, len(parts)*.1):
                raise RuntimeError('Merged duration does not match the recording. Export stopped; originals are preserved.')
            if job.get('smartTail'):
                from tail import trim_static_tail
                trimmed=directory/'tail-trimmed.mp4'
                try:
                    trim_static_tail(job,output,trimmed,duration,api)
                    trimmed.replace(output)
                finally: trimmed.unlink(missing_ok=True)
                width,height,_,duration=api['probe'](output)
            job.update(state='done',progress=1,width=width,height=height,duration=duration,size=output.stat().st_size,stage='smart-tail' if job.get('smartTail') else 'compressed-merge' if compress else 'lossless-merge' if same else 'compatible-merge')
    except Exception as error:
        job.update(state='cancelled' if job['cancel'].is_set() else 'error',error=str(error));output.unlink(missing_ok=True)
    finally:
        monitor_done.set()
        for temporary in [*original_parts,*directory.glob('normalized-*.mp4')]: temporary.unlink(missing_ok=True)
        job.pop('log',None);api['persist_job'](job);api['SLOT'].release()
