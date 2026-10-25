"""Authenticated incremental compressed merge; at most one original part on disk."""
import json, math, re, secrets, shutil, threading, time
from pathlib import Path
from merge import compressed_dimensions, encode_compressed_part, stream_signature


def fail(job,error,api):
    job.update(state='cancelled' if job['cancel'].is_set() else 'error',error=str(error),stage='stopped')
    api['persist_job'](job)


def process_part(job,index,api):
    source=job['output'].parent/'incoming';target=source.parent/f'normalized-{index:04d}.mp4'
    try:
        width,height,fps,duration=api['probe'](source)
        if not math.isfinite(duration) or duration<=0:raise ValueError('Invalid part duration')
        if index==0:job['sequenceDimensions']=(*compressed_dimensions(width,height),min(fps,30))
        width,height,fps=job['sequenceDimensions']
        audio=any(s['codec_type']=='audio' for s in stream_signature(source,api['INPUT_OPTIONS']))
        command=['ffmpeg','-nostdin','-y','-v','error',*api['INPUT_OPTIONS'],'-i',str(source)]
        if not audio:command+=['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
        command+=['-map','0:v:0','-map','0:a:0' if audio else '1:a:0','-vf',f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}']
        with (source.parent/'ffmpeg.log').open('ab') as log:
            job['log']=log
            encode_compressed_part(job,command,target,duration,job['sequenceDuration'],job['expectedDuration'],api)
        if job['cancel'].is_set():raise InterruptedError('Cancelled')
        api['probe'](target)
        job['sequenceDuration']+=duration;job['receivedParts']+=1
        job.update(stage='waiting-next-part',detail=f"{job['receivedParts']} / {job['totalParts']} parts compressed",progress=min(.95,job['sequenceDuration']/job['expectedDuration']*.95))
    except Exception as error:target.unlink(missing_ok=True);fail(job,error,api)
    finally:
        source.unlink(missing_ok=True);job.pop('log',None)
        for process in job['processes']:
            if process.poll() is None:api['stop_process'](process)
            for stream in (process.stdin,process.stdout,process.stderr):
                if stream and not stream.closed:stream.close()
        job['processes']=[];job['sequenceBusy']=False;api['persist_job'](job);api['SLOT'].release()


def finish(job,api):
    directory=job['output'].parent
    parts=[directory/f'normalized-{i:04d}.mp4' for i in range(job['totalParts'])]
    try:
        # Check every boundary, including chunks compressed before this feature
        # was enabled. Same slides alone never authorize a cut.
        from overlap import detect_overlap
        removed=0;checks=[]
        for index in range(1,len(parts)):
            if job['cancel'].is_set():raise InterruptedError('Cancelled')
            job.update(stage='checking-overlaps',detail=f'Checking join {index} / {len(parts)-1}',progress=.95)
            previous_duration=api['probe'](parts[index-1])[3];current_duration=api['probe'](parts[index])[3]
            verdict=detect_overlap(parts[index-1],parts[index],previous_duration,current_duration)
            cut=verdict['seconds'];checks.append({'part':index,**verdict})
            if cut:
                temporary=directory/f'dedup-{index:04d}.mp4'
                command=['ffmpeg','-nostdin','-y','-v','error',*api['INPUT_OPTIONS'],'-ss',str(cut),'-i',str(parts[index]),'-map','0:v:0','-map','0:a:0?']
                with (directory/'ffmpeg.log').open('ab') as log:
                    job['log']=log
                    encode_compressed_part(job,command,temporary,current_duration-cut,0,current_duration-cut,api)
                trimmed_duration=api['probe'](temporary)[3]
                if abs(trimmed_duration-(current_duration-cut))>.15:raise ValueError('Overlap trim timeline mismatch')
                temporary.replace(parts[index]);removed+=current_duration-trimmed_duration
            (directory/'overlap-report.json').write_text(json.dumps(checks,indent=2))
        job['sequenceDuration']-=removed;job['overlapRemoved']=round(removed,3)
        total=sum(p.stat().st_size for p in parts)
        if shutil.disk_usage(directory).free<total*1.1+512*1024**2:raise ValueError('Insufficient space for final compressed file')
        manifest=directory/'concat.txt';manifest.write_text(''.join(f"file '{p.name}'\n" for p in parts))
        job.update(stage='merging',progress=.96)
        with (directory/'ffmpeg.log').open('ab') as log:
            job['log']=log
            process=api['checked_process'](job,['ffmpeg','-nostdin','-y','-v','error','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',str(manifest),'-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart',str(job['output'])])
            if process.wait()!=0 or job['cancel'].is_set():raise RuntimeError('Final merge interrupted')
        width,height,_,duration=api['probe'](job['output'])
        if abs(duration-job['sequenceDuration'])>max(1,len(parts)*.1):raise ValueError('Merged timeline mismatch')
        job.update(state='done',stage='compressed-merge',progress=1,width=width,height=height,duration=duration,size=job['output'].stat().st_size)
        for part in parts:part.unlink(missing_ok=True)
    except Exception as error:job['output'].unlink(missing_ok=True);fail(job,error,api)
    finally:job.pop('log',None);job['sequenceBusy']=False;api['persist_job'](job);api['SLOT'].release()


def handle_sequence(handler,path,api):
    if not path.startswith('/sequence'):return False
    try:
        length=int(handler.headers.get('Content-Length','0'))
        if path=='/sequence':
            if not 0<length<=65536:raise ValueError('Invalid sequence request')
            data=json.loads(handler.rfile.read(length));count=int(data['count']);duration=float(data['duration'])
            if not 2<=count<=2048 or not math.isfinite(duration) or duration<=0:raise ValueError('Invalid sequence size or duration')
            # Includes compressed intermediates, final file, incoming part and reserve.
            if shutil.disk_usage(api['WORK']).free<duration*300000*2+2*1024**3:raise ValueError('Insufficient disk space for incremental merge')
            identifier=secrets.token_hex(16);directory=api['WORK']/identifier;directory.mkdir(mode=0o700)
            job=dict(id=identifier,mode='merge',sequence=True,compress=True,compatible=True,preview=False,name='all-recordings-merged.mp4',sourceId='',createdAt=int(time.time()*1000),state='processing',stage='waiting-next-part',progress=0,totalParts=count,receivedParts=0,sequenceDuration=0,expectedDuration=duration,sequenceBusy=False,source=directory/'incoming',output=directory/'enhanced.mp4',cancel=threading.Event(),processes=[])
            with api['GUARD']:api['JOBS'][identifier]=job
            api['persist_job'](job);handler.reply(201,{'id':identifier});return True
        parts=path.strip('/').split('/')
        if len(parts)<3 or not re.fullmatch('[a-f0-9]{32}',parts[1]):raise ValueError('Invalid sequence identifier')
        with api['GUARD']:job=api['JOBS'].get(parts[1])
        if len(parts)==3 and parts[2]=='resume' and job and job.get('sequence'):
            if job.get('sequenceBusy'):handler.reply(409,{'error':'Current part is still stopping'});return True
            if job['state'] not in ('cancelled','error'):raise ValueError('Sequence does not need recovery')
            if not 0<length<=65536:raise ValueError('Invalid recovery request')
            data=json.loads(handler.rfile.read(length));duration=float(data['duration'])
            if not math.isfinite(duration) or duration<=0:raise ValueError('Invalid total duration')
            completed=[job['output'].parent/f'normalized-{i:04d}.mp4' for i in range(job['receivedParts'])]
            durations=[api['probe'](p)[3] for p in completed]
            if completed:
                w,h,fps,_=api['probe'](completed[0]);job['sequenceDimensions']=(w,h,min(fps,30))
            job.update(source=job['output'].parent/'incoming',state='processing',stage='waiting-next-part',expectedDuration=duration,sequenceDuration=sum(durations),sequenceBusy=False,processes=[],cancel=threading.Event())
            job.pop('error',None);api['persist_job'](job);handler.reply(200,{'resumed':True});return True
        if not job or not job.get('sequence') or job['state']!='processing' or job['cancel'].is_set():raise ValueError('Sequence is unavailable')
        with api['GUARD']:
            if job.get('sequenceBusy') or not api['SLOT'].acquire(blocking=False):handler.reply(409,{'error':'Local helper busy'});return True
            job['sequenceBusy']=True
        try:
            if len(parts)==3 and parts[2]=='finish':
                if job['receivedParts']!=job['totalParts']:raise ValueError('Sequence has missing parts')
                target=finish;args=(job,api)
            elif len(parts)==4 and parts[2]=='part' and parts[3].isdigit():
                index=int(parts[3])
                if index!=job['receivedParts'] or index>=job['totalParts']:raise ValueError('Part is out of order')
                if not 0<length<=1600*1024**2:raise ValueError('Part exceeds 1.6 GB')
                if shutil.disk_usage(api['WORK']).free<length+512*1024**2:raise ValueError('Insufficient space for incoming part')
                handler.connection.settimeout(120)
                try:
                    with job['source'].open('wb') as stream:
                        remaining=length
                        while remaining:
                            block=handler.rfile.read(min(1024**2,remaining))
                            if not block:raise ValueError('Incomplete part upload')
                            stream.write(block);remaining-=len(block)
                except Exception:job['source'].unlink(missing_ok=True);raise
                job.update(stage='compressing',detail=f"Compressing part {index+1} / {job['totalParts']}")
                target=process_part;args=(job,index,api)
            else:raise ValueError('Invalid sequence operation')
            worker=threading.Thread(target=target,args=args,daemon=True);job['worker']=worker;worker.start()
        except Exception:job['sequenceBusy']=False;api['SLOT'].release();raise
        handler.reply(202,{'id':job['id']});return True
    except (ValueError,OSError,KeyError,TypeError) as error:handler.reply(400,{'error':str(error)});return True
