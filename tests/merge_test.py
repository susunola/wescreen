import importlib.util,json,os,subprocess,tempfile,threading,time,unittest,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('merge_server',ROOT/'enhancement/server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
class MergeTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.old=(server.WORK,server.JOBS,server.PAIR_FILE);server.WORK=Path(self.temp.name);server.JOBS={};server.PAIR_FILE=server.WORK/'pair';self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=self.http.serve_forever,daemon=True).start();self.url=f'http://127.0.0.1:{self.http.server_port}';self.clip=server.WORK/'source.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-c:a','aac',str(self.clip)],check=True)
 def tearDown(self):
  self.http.shutdown();self.http.server_close();server.WORK,server.JOBS,server.PAIR_FILE=self.old;self.temp.cleanup()
 def request(self,path,data=None,token=True):
  headers={'X-WeScreen-Token':server.TOKEN} if token else {};req=urllib.request.Request(self.url+path,data=data,headers=headers);return urllib.request.urlopen(req,timeout=30)
 def upload(self,path=None):return json.load(self.request('/uploads',(path or self.clip).read_bytes()))['id']
 def job(self,ids,compatible=False,smart=False,compress=False):
  result=json.load(self.request('/jobs/merge',json.dumps({'parts':ids,'compatible':compatible,'compress':compress,'name':'test.mp4','smartTail':smart,'requireSilence':True}).encode()));identifier=result['id'];deadline=time.time()+30
  while time.time()<deadline:
   job=json.load(self.request('/jobs/'+identifier))
   if job['state'] in ('done','error','cancelled'):return identifier,job
   time.sleep(.05)
  self.fail('merge timeout')
 def test_lossless_merge_duration_audio_and_no_reencode(self):
  identifier,job=self.job([self.upload(),self.upload()]);self.assertEqual(job['state'],'done',job);self.assertAlmostEqual(job['duration'],2,delta=.15);output=server.JOBS[identifier]['output'];streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(output)]))['streams'];self.assertEqual([s['codec_name'] for s in streams],['h264','aac']);self.assertEqual(server.JOBS[identifier]['stage'],'lossless-merge');self.assertTrue(self.clip.exists())
 def test_mismatch_rejected_and_compatible_reencoding_works(self):
  other=server.WORK/'other.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=180x320:rate=24','-t','1','-c:v','libx264',str(other)],check=True)
  _,job=self.job([self.upload(),self.upload(other)]);self.assertEqual(job['state'],'error');self.assertIn('different',job['error']);_,job=self.job([self.upload(),self.upload(other)],True);self.assertEqual(job['state'],'done',job)
 def test_auth_and_path_validation(self):
  with self.assertRaises(urllib.error.HTTPError) as cm:self.request('/uploads',self.clip.read_bytes(),False)
  self.assertEqual(cm.exception.code,401)
  with self.assertRaises(urllib.error.HTTPError) as cm:self.request('/jobs/merge',json.dumps({'parts':['../token','https://example.com']}).encode())
  self.assertEqual(cm.exception.code,400)
 def test_invalid_media_not_retained(self):
  with self.assertRaises(urllib.error.HTTPError):self.request('/uploads',b'not video')
  self.assertEqual(list((server.WORK/'uploads').iterdir()),[])
 def test_compressed_merge_caps_resolution_reduces_size_and_preserves_original(self):
  large=server.WORK/'large.mp4'
  subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=2560x1440:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-crf','0','-c:a','aac',str(large)],check=True)
  before=large.read_bytes()
  identifier,job=self.job([self.upload(large),self.upload(large)],compress=True)
  self.assertEqual(job['state'],'done',job);self.assertEqual((job['width'],job['height']),(1920,1080));self.assertAlmostEqual(job['duration'],4,delta=.2)
  self.assertTrue(job['compress']);self.assertEqual(job['stage'],'compressed-merge');self.assertLess(job['size'],large.stat().st_size);self.assertEqual(large.read_bytes(),before)
  self.assertTrue(json.loads((server.JOBS[identifier]['output'].parent/'job.json').read_text())['compress'])
  self.assertEqual(list(server.JOBS[identifier]['output'].parent.glob('normalized-*.mp4')),[])
 def test_compressed_merge_handles_reversed_tracks_and_missing_audio(self):
  reversed_clip=server.WORK/'reversed.mp4';silent=server.WORK/'silent.mp4'
  subprocess.run(['ffmpeg','-v','error','-i',str(self.clip),'-map','0:a:0','-map','0:v:0','-c','copy',str(reversed_clip)],check=True)
  subprocess.run(['ffmpeg','-v','error','-i',str(self.clip),'-map','0:v:0','-c','copy',str(silent)],check=True)
  identifier,job=self.job([self.upload(),self.upload(reversed_clip),self.upload(silent)],compress=True)
  self.assertEqual(job['state'],'done',job);self.assertAlmostEqual(job['duration'],3,delta=.2);self.assertEqual((job['width'],job['height']),(160,90))
  output=server.JOBS[identifier]['output'];streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(output)]))['streams']
  self.assertEqual([s['codec_name'] for s in streams],['h264','aac'])
  subprocess.run(['ffmpeg','-v','error','-i',str(output),'-f','null','-'],check=True)
 def test_compression_dimensions_preserve_portrait_and_ultrawide(self):
  from merge import compressed_dimensions
  self.assertEqual(compressed_dimensions(3824,1770),(1920,888));self.assertEqual(compressed_dimensions(2160,3840),(1080,1920));self.assertEqual(compressed_dimensions(320,180),(320,180))
 def test_compressed_merge_normalizes_different_video_time_bases(self):
  other=server.WORK/'different-clock.mp4'
  subprocess.run(['ffmpeg','-v','error','-i',str(self.clip),'-c','copy','-video_track_timescale','19264',str(other)],check=True)
  identifier,job=self.job([self.upload(),self.upload(other)],compress=True)
  self.assertEqual(job['state'],'done',job);self.assertAlmostEqual(job['duration'],2,delta=.15)
  streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(server.JOBS[identifier]['output'])]))['streams']
  self.assertEqual(streams[0]['time_base'],'1/90000')
 def test_duration_mismatch_is_not_exported(self):
  from unittest.mock import patch
  probe=server.probe
  def wrong_duration(path):
   w,h,f,d=probe(path)
   return (w,h,f,d*100 if Path(path).name=='enhanced.mp4' else d)
  with patch.object(server,'probe',side_effect=wrong_duration):
   identifier,job=self.job([self.upload(),self.upload()],compress=True)
  self.assertEqual(job['state'],'error');self.assertIn('duration',job['error']);self.assertFalse(server.JOBS[identifier]['output'].exists())
 def test_static_tail_crosses_parts_and_originals_remain(self):
  first=server.WORK/'first.mp4';second=server.WORK/'second.mp4'
  subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=5:duration=3','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-vf','tpad=stop_mode=clone:stop_duration=75','-t','78','-c:v','libx264','-g','5','-c:a','aac',str(first)],check=True)
  subprocess.run(['ffmpeg','-v','error','-i',str(first),'-ss','40','-c','copy',str(second)],check=True)
  # Same signature, with a terminal hold continuing into the second part.
  before=[p.read_bytes() for p in (first,second)]
  _,job=self.job([self.upload(first),self.upload(second)],smart=True)
  self.assertEqual(job['state'],'done',job);self.assertGreater(job['tailRemoved'],60);self.assertLess(job['duration'],5)
  self.assertEqual([p.read_bytes() for p in (first,second)],before)

class AudioRepairTest(unittest.TestCase):
 def test_loudness_repair_preserves_encoded_video(self):
  with tempfile.TemporaryDirectory() as tmp:
   source=Path(tmp)/'source.mp4';output=Path(tmp)/'output.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-c:a','aac',str(source)],check=True)
   def video_hash(path):return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:v:0','-c','copy','-f','hash','-hash','sha256','pipe:1'])
   original=video_hash(source);job=dict(source=source,output=output,mode='audio',audioPreset='level',preview=False,state='queued',progress=0,cancel=threading.Event(),processes=[])
   server.SLOT.acquire();server.run_job(job);self.assertEqual(job['state'],'done',job);self.assertEqual(original,video_hash(output))
   report=subprocess.run(['ffmpeg','-v','info','-i',str(output),'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
   import re
   measured=json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',report,re.S)[-1]);self.assertAlmostEqual(float(measured['input_i']),-16,delta=1)

if __name__=='__main__':unittest.main()
