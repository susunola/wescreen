import unittest,tempfile,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
from overlap import detect_overlap
class OverlapTest(unittest.TestCase):
 def test_unique_overlap_matches_but_static_silent_slides_do_not(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);source=p/'source.mkv'
   subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=192x108:rate=15','-f','lavfi','-i','anoisesrc=color=pink:amplitude=0.3:seed=17:sample_rate=48000','-t','12','-c:v','libx264','-crf','15','-c:a','pcm_s16le',str(source)],check=True)
   for name,start,duration in [('a',0,8),('b',5,7),('c',8,4)]:
    subprocess.run(['ffmpeg','-v','error','-ss',str(start),'-i',str(source),'-t',str(duration),'-c:v','libx264','-crf','15','-c:a','aac',str(p/(name+'.mp4'))],check=True)
   result=detect_overlap(p/'a.mp4',p/'b.mp4',8,7)
   self.assertAlmostEqual(result['seconds'],3,delta=.12,msg=result)
   self.assertEqual(detect_overlap(p/'a.mp4',p/'c.mp4',8,4)['seconds'],0)
   silent=p/'silent.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=white:size=192x108:rate=15','-t','5','-c:v','libx264',str(silent)],check=True)
   self.assertEqual(detect_overlap(silent,silent,5,5)['seconds'],0)
 def test_periodic_audio_and_different_video_do_not_authorize_cuts(self):
  import numpy as np
  from unittest.mock import patch
  rate=16000;t=np.arange(rate*8)/rate
  tone=(.2*np.sin(2*np.pi*440*t)).astype(np.float32)
  with patch('overlap.audio',side_effect=[tone,tone[:int(rate*1.2)] ]):
   self.assertEqual(detect_overlap('previous','current',8,7)['seconds'],0)
  rng=np.random.default_rng(5);old=rng.normal(0,.1,rate*8).astype(np.float32);new=old[int(rate*5.2):int(rate*6.4)]
  with patch('overlap.audio',side_effect=[old,new]),patch('overlap.frame',side_effect=[np.zeros(5184,np.float32),np.full(5184,80,np.float32)]):
   result=detect_overlap('previous','current',8,7)
   self.assertEqual(result['seconds'],0);self.assertEqual(result['reason'],'different-video')
