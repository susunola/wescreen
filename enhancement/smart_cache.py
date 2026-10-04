"""Authenticated ephemeral source/chunk cache. No library files are modified."""
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from smart_model import smart_ready,ROOT

SESSIONS={};GUARD=threading.RLock();CHUNK_SECONDS=4;MAX_CHUNKS=6
CACHE=Path(os.environ.get('WESCREEN_SMART_CACHE_DIR') or (Path(os.environ.get('WESCREEN_WORK_DIR') or ROOT/'.runtime'/'jobs').parent/'smart-cache'))


def cleanup_session(session,api):
    with GUARD:
        session['cancel'].set()
        process=session.get('process')
    if process and process.poll() is None:api['stop_process'](process)
    worker=session.get('worker')
    if worker and worker is not threading.current_thread():
        worker.join(timeout=5)
        if worker.is_alive() and process:api['stop_process'](process,force=True);worker.join(timeout=5)
    if not worker or not worker.is_alive():shutil.rmtree(session['directory'],ignore_errors=True)


def expire(api):
    with GUARD:
        expired=[sid for sid,s in SESSIONS.items() if time.monotonic()-s['touch']>600]
        sessions=[SESSIONS.pop(sid) for sid in expired]
    for session in sessions:cleanup_session(session,api)


def public_chunk(chunk):
    return {k:v for k,v in chunk.items() if k not in ('path',)}


def work_chunk(session,index,api):
    chunk=session['chunks'][index]
    process=None
    try:
        if session['cancel'].is_set():raise RuntimeError('Smart session closed')
        width,height,fps,duration=session['media'];start=index*CHUNK_SECONDS
        length=min(CHUNK_SECONDS,duration-start)
        # 2x only for genuinely small containers; large blurry recordings still
        # receive restoration at native size rather than being classified as HD.
        scale=2 if max(width,height)<=960 and min(width,height)<=540 and not session['text'] else 1
        python=sys.executable
        if smart_ready():python=json.loads((ROOT/'.runtime'/'smart-ready.json').read_text())['python']
        command=[python,str(ROOT/'smart_runner.py'),'--source',str(session['source']),'--output',str(chunk['path']),'--width',str(width+width%2),'--height',str(height+height%2),'--fps',str(fps),'--start',str(start),'--duration',str(length),'--scale',str(scale)]
        if smart_ready() and not session['text']:command.append('--neural')
        if session['text']:command.append('--text')
        with (session['directory']/'worker.log').open('ab') as log:
            with GUARD:
                if session['cancel'].is_set():raise RuntimeError('Smart session closed')
                process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=log,text=True,start_new_session=True)
                session['process']=process;chunk['state']='processing'
            for line in process.stdout:
                if session['cancel'].is_set():api['stop_process'](process);break
                if shutil.disk_usage(CACHE).free<256*1024*1024:raise ValueError('Insufficient disk space for smart cache')
                if chunk['path'].exists() and chunk['path'].stat().st_size>256*1024*1024:raise ValueError('Smart chunk exceeds helper cache limit')
                try:
                    report=json.loads(line)
                    for key in ['progress','engine','analysis','frames','duration','start','error']:
                        if key in report:chunk[key]=report[key]
                except ValueError:pass
            if process.wait()!=0 or session['cancel'].is_set() or not chunk['path'].is_file():raise RuntimeError(chunk.get('error','Smart repair interrupted'))
        if chunk['path'].stat().st_size>256*1024*1024:raise ValueError('Smart chunk exceeds helper cache limit')
        chunk.update(state='done',progress=1,width=(width+width%2)*scale,height=(height+height%2)*scale,size=chunk['path'].stat().st_size)
        with GUARD:
            # LRU eviction of completed chunks only; caller can regenerate a seek.
            done=sorted([(i,c) for i,c in session['chunks'].items() if c['state']=='done' and i!=index],key=lambda pair:pair[1]['touch'])
            total=sum(c.get('size',0) for c in session['chunks'].values())
            while done and (len(session['chunks'])>MAX_CHUNKS or total>256*1024*1024):
                i,c=done.pop(0);total-=c.get('size',0);c['path'].unlink(missing_ok=True);del session['chunks'][i]
    except Exception as error:
        chunk.update(state='error',error=str(error));chunk['path'].unlink(missing_ok=True)
    finally:
        if process and process.poll() is None:api['stop_process'](process)
        if process and process.stdout:process.stdout.close()
        session['process']=None;session['busy']=False;api['SLOT'].release()
        if session['cancel'].is_set():shutil.rmtree(session['directory'],ignore_errors=True)


def handle_smart(handler,method,api):
    parsed=urlparse(handler.path);parts=parsed.path.strip('/').split('/')
    if not parts or parts[0]!='smart':return False
    expire(api);query=parse_qs(parsed.query)
    try:
        if method=='POST' and parsed.path=='/smart/sources':
            length=int(handler.headers.get('Content-Length','0'))
            if not 0<length<=1600*1024*1024:raise ValueError('Smart input must be under 1.6 GB')
            with GUARD:
                if len(SESSIONS)>=2:raise ValueError('Two smart playback sessions are already active')
                CACHE.mkdir(parents=True,exist_ok=True,mode=0o700)
                if shutil.disk_usage(CACHE).free<length*2+512*1024*1024:raise ValueError('Insufficient smart cache space')
                sid=secrets.token_hex(16);directory=CACHE/sid;directory.mkdir(mode=0o700)
                session={'directory':directory,'source':directory/'source','chunks':{},'touch':time.monotonic(),'cancel':threading.Event(),'busy':False,'text':query.get('content')==['detail']}
                SESSIONS[sid]=session
            try:
                handler.connection.settimeout(120)
                with session['source'].open('xb') as target:
                    remaining=length
                    while remaining:
                        data=handler.rfile.read(min(1024*1024,remaining))
                        if not data:raise ValueError('Incomplete smart source upload')
                        target.write(data);remaining-=len(data)
                session['media']=api['probe'](session['source'])
                if session['media'][3]<=0:raise ValueError('Source duration is unavailable')
            except Exception:
                with GUARD:SESSIONS.pop(sid,None)
                shutil.rmtree(directory,ignore_errors=True);raise
            handler.reply(201,{'id':sid,'chunkSeconds':CHUNK_SECONDS,'neural':smart_ready()});return True
        if len(parts)<2 or not re.fullmatch('[a-f0-9]{32}',parts[1]):raise ValueError('Invalid smart session')
        with GUARD:session=SESSIONS.get(parts[1])
        if not session:handler.reply(404,{'error':'Smart session expired'});return True
        session['touch']=time.monotonic()
        if method=='DELETE' and len(parts)==2:
            with GUARD:SESSIONS.pop(parts[1],None)
            cleanup_session(session,api);handler.reply(200,{'deleted':True});return True
        if len(parts)!=4 or parts[2]!='chunks' or not parts[3].isdigit():raise ValueError('Invalid smart chunk')
        index=int(parts[3])
        if not 0<=index<math.ceil(session['media'][3]/CHUNK_SECONDS):raise ValueError('Chunk outside source duration')
        with GUARD:chunk=session['chunks'].get(index)
        if method=='POST':
            if chunk and chunk['state'] in ('queued','processing','done'):
                chunk['touch']=time.monotonic();handler.reply(200,public_chunk(chunk));return True
            if session['busy'] or not api['SLOT'].acquire(blocking=False):handler.reply(409,{'error':'Helper busy; original playback continues'});return True
            try:
                chunk={'state':'queued','progress':0,'start':index*CHUNK_SECONDS,'path':session['directory']/f'{index}.mp4','touch':time.monotonic()}
                with GUARD:
                    for key,old in list(session['chunks'].items()):
                        if old['state']=='error':old['path'].unlink(missing_ok=True);del session['chunks'][key]
                    session['chunks'][index]=chunk;session['busy']=True
                worker=threading.Thread(target=work_chunk,args=(session,index,api),daemon=True);session['worker']=worker;worker.start()
            except Exception:session['busy']=False;api['SLOT'].release();raise
            handler.reply(202,public_chunk(chunk));return True
        if method=='GET':
            if not chunk:handler.reply(404,{'error':'Chunk not requested'});return True
            chunk['touch']=time.monotonic()
            if query.get('result')==['1']:
                if chunk['state']!='done':handler.reply(409,{'error':'Chunk not ready'});return True
                with GUARD:stream=chunk['path'].open('rb');size=chunk['path'].stat().st_size
                with stream:
                    handler.connection.settimeout(30)
                    handler.send_response(200);handler.cors_headers();handler.send_header('Content-Type','video/mp4');handler.send_header('Content-Length',str(size));handler.end_headers();shutil.copyfileobj(stream,handler.wfile)
                return True
            handler.reply(200,public_chunk(chunk));return True
        raise ValueError('Invalid smart operation')
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:handler.reply(400,{'error':'Cannot decode smart source' if isinstance(error,subprocess.SubprocessError) else str(error)});return True


def start_cleanup(api):
    CACHE.mkdir(parents=True,exist_ok=True,mode=0o700)
    # Only our generated cache folders are removed; recordings/jobs are untouched.
    for item in CACHE.iterdir():
        if item.is_dir() and re.fullmatch('[a-f0-9]{32}',item.name):shutil.rmtree(item,ignore_errors=True)
    def sweep():
        while True:time.sleep(30);expire(api)
    threading.Thread(target=sweep,daemon=True).start()
