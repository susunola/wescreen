"""Conservative adjacent overlap detection: unique audio alignment plus video agreement."""
import json, subprocess
import cv2
import numpy as np


def audio(path,start,duration):
    result=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(max(0,start)),'-i',str(path),'-t',str(duration),'-vn','-ac','1','-af','lowpass=f=1800','-ar','16000','-f','f32le','pipe:1'],capture_output=True,timeout=45,check=True)
    return np.frombuffer(result.stdout,np.float32).copy()


def frame(path,second):
    result=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(max(0,second)),'-i',str(path),'-frames:v','1','-vf','scale=96:54','-pix_fmt','gray','-f','rawvideo','pipe:1'],capture_output=True,timeout=30,check=True)
    if len(result.stdout)!=96*54:raise ValueError('No comparison frame')
    return np.frombuffer(result.stdout,np.uint8).astype(np.float32)


def detect_overlap(previous,current,previous_duration,current_duration):
    try:
        tail=min(30,previous_duration);offset=.2;window=1.2
        if min(previous_duration,current_duration)<2:return {'seconds':0,'reason':'short-part'}
        old=audio(previous,previous_duration-tail,tail)
        new=audio(current,offset,window)
        if len(new)<16000 or len(old)<=len(new) or np.std(new)<.008:return {'seconds':0,'reason':'no-distinct-audio'}
        scores=cv2.matchTemplate(old.reshape(1,-1),new.reshape(1,-1),cv2.TM_CCOEFF_NORMED).reshape(-1)
        index=int(np.argmax(scores));confidence=float(scores[index])
        alternatives=scores.copy();alternatives[max(0,index-4000):index+4001]=-1
        if confidence<.97 or (len(alternatives) and float(alternatives.max())>confidence-.04):return {'seconds':0,'reason':'uncertain-audio','audioConfidence':round(confidence,5)}
        overlap=tail-index/16000+offset
        if not 1.8<=overlap<min(current_duration-.5,30):return {'seconds':0,'reason':'outside-safe-range'}
        errors=[]
        for moment in (.3,.7,1.1):
            a=frame(previous,previous_duration-overlap+moment);b=frame(current,moment)
            error=np.abs(a-b);errors.append(float(error.mean()))
            if error.mean()>3 or np.percentile(error,99)>18:return {'seconds':0,'reason':'different-video'}
        return {'seconds':round(overlap,4),'audioConfidence':round(confidence,5),'videoMAE':round(max(errors),3),'reason':'confirmed-overlap'}
    except (OSError,ValueError,subprocess.SubprocessError,cv2.error):return {'seconds':0,'reason':'comparison-unavailable'}
