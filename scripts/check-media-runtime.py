"""Probe actual local encoder usability without capturing a user's screen."""
import argparse,json,platform,shutil,subprocess,tempfile,time
from pathlib import Path

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
 result={'platform':platform.system(),'architecture':platform.machine(),'ffmpeg':bool(shutil.which('ffmpeg')),'ffprobe':bool(shutil.which('ffprobe')),'screenCaptureTested':False,'note':'Synthetic encoder smoke tests; OS screen capture permissions and multi-hour device recording are not certified.','encoders':{}}
 if result['ffmpeg']:
  encoders=subprocess.run(['ffmpeg','-hide_banner','-encoders'],capture_output=True,text=True,check=True).stdout
  candidates=['libx264','h264_videotoolbox'] if platform.system()=='Darwin' else ['libx264','h264_nvenc','h264_qsv','h264_amf']
  with tempfile.TemporaryDirectory() as directory:
   for name in candidates:
    if name not in encoders:result['encoders'][name]={'reported':False,'tested':False};continue
    output=Path(directory)/(name+'.mp4');command=['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','0.5','-an','-c:v',name]
    if name=='h264_videotoolbox':command+=['-allow_sw','0']
    command+=['-pix_fmt','yuv420p',str(output)];started=time.perf_counter()
    try:
     proc=subprocess.run(command,capture_output=True,timeout=30);valid=proc.returncode==0
     if valid:valid=subprocess.run(['ffmpeg','-v','error','-i',str(output),'-frames:v','1','-f','null','-'],capture_output=True,timeout=15).returncode==0
     result['encoders'][name]={'reported':True,'tested':True,'usable':valid,'smokeSeconds':round(time.perf_counter()-started,3)}
    except subprocess.TimeoutExpired:result['encoders'][name]={'reported':True,'tested':True,'usable':False,'reason':'timeout'}
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
