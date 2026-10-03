"""Conservative terminal freeze analysis. Never modify the input recording."""
import json
import re
import subprocess

def terminal_start(report, name):
    start = None
    for kind, value in re.findall(r'\b'+name+r'_(start|end):\s*([0-9.]+)', report):
        start = float(value) if kind == 'start' else None
    return start

def detection_report(job,source,duration,api,audio=False):
    path=source.parent/('tail-audio.log' if audio else 'tail-picture.log')
    filters=['-vn','-af','silencedetect=n=-50dB:d=60'] if audio else ['-an','-vf','scale=160:-2,freezedetect=n=-45dB:d=60']
    with path.open('w') as log:
        process=api['checked_process'](job,['ffmpeg','-nostdin','-nostats','-v','info',*api['INPUT_OPTIONS'],'-i',str(source),*filters,'-progress','pipe:1','-f','null','-'],stdout=subprocess.PIPE,stderr=log,text=True)
        for line in process.stdout:
            if line.startswith('out_time_us=') and line.partition('=')[2].strip().isdigit():
                job['progress']=max(job.get('progress',0),(.4 if audio else 0)+.4*min(1,int(line.partition('=')[2])/1e6/duration))
        process.stdout.close()
        if process.wait(): raise RuntimeError('Tail analysis failed')
    if job['cancel'].is_set(): raise InterruptedError('Cancelled')
    return path.read_text(errors='replace')

def analyze_tail(job, source, duration, api):
    job.update(stage='checking-static-tail', progress=0)
    if duration <= 61: return None, 'short-video'
    report=detection_report(job,source,duration,api)
    freeze=terminal_start(report,'freeze')
    if freeze is None: return None, 'moving-tail'
    job['progress']=.45
    start=freeze
    if job.get('requireSilence',True):
        data=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=index','-of','json',str(source)]))
        if data.get('streams'):
            report=detection_report(job,source,duration,api,audio=True)
            # silencedetect reports an end at EOF; it still represents a silent terminal interval.
            starts=re.findall(r'\bsilence_start:\s*([0-9.]+)',report)
            ends=re.findall(r'\bsilence_end:\s*([0-9.]+)',report)
            if not starts or (ends and float(ends[-1]) < duration-.2): return None,'audible-tail'
            start=max(start,float(starts[-1]))
    if start<1: return None,'entire-video-static'
    cut=start+1  # Keep one second of the last meaningful frame.
    if duration-cut<=60: return None,'tail-under-one-minute'
    return cut,'static-silent-tail' if job.get('requireSilence',True) else 'static-tail'

def trim_static_tail(job, source, output, duration, api):
    cut,reason=analyze_tail(job,source,duration,api)
    job.update(tailReason=reason,tailRemoved=max(0,duration-cut) if cut else 0)
    job['stage']='trimming-static-tail' if cut else 'preserving-recording'
    # Stream copy keeps compressed pixels and audio intact; WebM codecs need MP4 conversion.
    streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_type,codec_name','-of','json',str(source)]))['streams']
    compatible=all(s['codec_name'] in ('h264','hevc','aac') for s in streams if s['codec_type'] in ('video','audio'))
    encode=['-c','copy'] if compatible else ['-c:v','libx264','-crf','18','-preset','fast','-c:a','aac','-b:a','192k']
    process=api['checked_process'](job,['ffmpeg','-nostdin','-y','-v','error',*api['INPUT_OPTIONS'],'-i',str(source),*(['-t',str(cut)] if cut else []),'-map','0:v:0','-map','0:a:0?',*encode,'-movflags','+faststart','-progress','pipe:1',str(output)],stdout=subprocess.PIPE,text=True)
    for line in process.stdout: api['update_ffmpeg_progress'](job,line,cut or duration)
    process.stdout.close()
    if process.wait(): raise RuntimeError('Static tail trim failed')
