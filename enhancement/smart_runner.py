"""Isolated GPU chunk worker. Original audio and source files are untouched."""
import argparse
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
from smart_restore import TemporalRepair, diagnose, restore
from smart_model import NeuralRepair


def sample_profile(args,options):
    reports=[]
    for fraction in (.1,.5,.9):
        moment=args.start+args.duration*fraction
        command=['ffmpeg','-nostdin','-v','error',*options,'-ss',str(moment),'-i',args.source,'-frames:v','1','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-f','rawvideo','-pix_fmt','bgr24','pipe:1']
        data=subprocess.run(command,capture_output=True,timeout=30,check=True).stdout
        if len(data)==args.width*args.height*3:reports.append(diagnose(np.frombuffer(data,np.uint8).reshape(args.height,args.width,3)))
    if not reports:return None
    profile=dict(reports[len(reports)//2])
    for key in ['noise','blocks','detail']:profile[key]=round(float(np.median([r[key] for r in reports])),2)
    profile['soft']=sum(r['soft'] for r in reports)>len(reports)/2
    profile['degraded']=profile['noise']>1.5 or profile['blocks']>1.5 or profile['soft']
    return profile


def run(args):
    w,h=args.width,args.height;fps=args.fps
    context=min(.25,args.start);begin=args.start-context
    options=['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm']
    profile=sample_profile(args,options)
    decoder=subprocess.Popen(['ffmpeg','-nostdin','-v','error',*options,'-ss',str(begin),'-i',args.source,'-t',str(args.duration+context),'-an','-vf',f'fps={fps},pad=ceil(iw/2)*2:ceil(ih/2)*2','-f','rawvideo','-pix_fmt','bgr24','pipe:1'],stdout=subprocess.PIPE)
    encoder=None
    try:
        neural=NeuralRepair() if args.neural and not args.text else None
        temporal=TemporalRepair();count=0;delivered=0;first_time=None;scale=args.scale if not args.text else 1
        # H.264 4:2:0 is used only for browser playback cache; originals are retained.
        encoder=subprocess.Popen(['ffmpeg','-nostdin','-y','-v','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w*scale}x{h*scale}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-crf','15','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',args.output],stdin=subprocess.PIPE)
        size=w*h*3
        while True:
            data=decoder.stdout.read(size)
            if not data:break
            if len(data)!=size:raise ValueError('Incomplete decoded frame')
            frame=np.frombuffer(data,np.uint8).reshape(h,w,3)
            if profile is None:profile=diagnose(frame)
            timestamp=begin+count/fps;count+=1
            repaired=restore(frame,temporal,timestamp,neural,profile,args.text,scale)
            if timestamp+1e-6<args.start:continue
            if first_time is None:first_time=timestamp
            encoder.stdin.write(repaired.tobytes());delivered+=1
            if delivered%5==0:print(json.dumps({'progress':min(.99,delivered/fps/args.duration)}),flush=True)
        encoder.stdin.close()
        if encoder.wait()!=0 or decoder.wait()!=0 or not delivered:raise RuntimeError('Smart chunk encode/decode failed')
        print(json.dumps({'progress':1,'engine':(f'Real-ESRGAN / {neural.device.upper()}'+(' · native residual guide' if max(w,h)>960 else '')) if neural else 'Motion-aligned spatial repair','analysis':profile,'frames':delivered,'duration':delivered/fps,'start':first_time}),flush=True)
    finally:
        for process in [decoder,encoder]:
            if process and process.poll() is None:process.terminate()
        for process in [decoder,encoder]:
            if process:
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()
                for stream in [process.stdin,process.stdout]:
                    if stream and not stream.closed:stream.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['source','output']:parser.add_argument('--'+name,required=True)
    for name in ['width','height','scale']:parser.add_argument('--'+name,type=int,default=1)
    for name in ['fps','start','duration']:parser.add_argument('--'+name,type=float,required=True)
    parser.add_argument('--neural',action='store_true');parser.add_argument('--text',action='store_true')
    try:run(parser.parse_args())
    except Exception as error:print(json.dumps({'error':str(error)}),flush=True);sys.exit(1)
