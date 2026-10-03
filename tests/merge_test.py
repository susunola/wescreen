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
 def job(self,ids,compatible=False):
  result=json.load(self.request('/jobs/merge',json.dumps({'parts':ids,'compatible':compatible,'name':'test.mp4'}).encode()));identifier=result['id'];deadline=time.time()+30
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
