"""Reproducible synthetic restoration baseline; does not claim real-world perceptual quality."""
import argparse,json,sys
from pathlib import Path
import cv2
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
from smart_restore import diagnose,restore,TemporalRepair

def psnr(reference,image):
    mse=float(np.mean((reference.astype(np.float64)-image)**2))
    return round(10*np.log10(255**2/mse),3) if mse else None

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    clean=np.full((360,640,3),110,np.uint8)
    for i in range(10):cv2.rectangle(clean,(20+i*58,20),(45+i*58,170),(40+i*15,180-i*8,200-i*10),-1)
    cv2.putText(clean,'Course 1080p ABC 012345',(20,225),cv2.FONT_HERSHEY_SIMPLEX,.8,(235,235,235),2,cv2.LINE_AA)
    cv2.putText(clean,'Small text and edge preservation',(20,280),cv2.FONT_HERSHEY_SIMPLEX,.55,(220,220,220),1,cv2.LINE_AA)
    rng=np.random.default_rng(20261025)
    noisy=np.clip(clean.astype(float)+rng.normal(0,6,clean.shape),0,255).astype(np.uint8)
    blurred=cv2.GaussianBlur(clean,(0,0),1.2)
    _,compressed=cv2.imencode('.jpg',clean,[cv2.IMWRITE_JPEG_QUALITY,15]);compressed=cv2.imdecode(compressed,cv2.IMREAD_COLOR)
    cases={'clean':clean,'noise':noisy,'blur':blurred,'compression':compressed,'mixed':cv2.GaussianBlur(noisy,(0,0),.6)}
    reports=[]
    for name,source in cases.items():
        profile=diagnose(source);out=restore(source,TemporalRepair(),0,profile=profile,text=False)
        cv2.imwrite(str(args.output/(name+'-source.png')),source);cv2.imwrite(str(args.output/(name+'-restored.png')),out)
        reports.append({'case':name,'profile':profile,'sourcePSNR':psnr(clean,source),'restoredPSNR':psnr(clean,out),'meanPixelChange':round(float(np.mean(np.abs(source.astype(float)-out))),3)})
    cv2.imwrite(str(args.output/'reference.png'),clean)
    result={'note':'Synthetic single-frame non-neural baseline. PSNR is reference error, not a perceptual score. Null PSNR means identical pixels. Inspect images and validate real clips separately.','cases':reports}
    (args.output/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
