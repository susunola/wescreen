import json,time,unittest,urllib.error
from merge_test import MergeTest,server

class SequenceMergeTest(unittest.TestCase):
 setUp=MergeTest.setUp
 tearDown=MergeTest.tearDown
 request=MergeTest.request
 def wait(self,sid,received=None):
  deadline=time.time()+30
  while time.time()<deadline:
   job=json.load(self.request('/jobs/'+sid))
   if job['state'] in ('done','error','cancelled') or (received is not None and job.get('receivedParts')==received and job.get('stage')=='waiting-next-part'):return job
   time.sleep(.05)
  self.fail('Sequence timeout')
 def test_incremental_merge_keeps_only_one_original_and_preserves_timeline(self):
  data=json.dumps({'count':2,'duration':2}).encode()
  with self.assertRaises(urllib.error.HTTPError):self.request('/sequence',data,False)
  sid=json.load(self.request('/sequence',data))['id']
  with self.assertRaises(urllib.error.HTTPError):self.request(f'/sequence/{sid}/part/1',self.clip.read_bytes())
  with self.assertRaises(urllib.error.HTTPError):self.request(f'/sequence/{sid}/finish',b'')
  for i in range(2):
   self.request(f'/sequence/{sid}/part/{i}',self.clip.read_bytes()).close()
   job=self.wait(sid,i+1);self.assertEqual(job['state'],'processing',job)
   self.assertFalse((server.WORK/sid/'incoming').exists())
  self.request(f'/sequence/{sid}/finish',b'').close();job=self.wait(sid)
  self.assertEqual(job['state'],'done',job);self.assertAlmostEqual(job['duration'],2,delta=.2)
  self.assertFalse(list((server.WORK/sid).glob('normalized-*')))
  self.assertTrue(self.clip.exists());self.assertTrue(server.JOBS[sid]['output'].is_file())
 def test_confirmed_overlap_is_trimmed_from_merged_output(self):
  import subprocess
  source=server.WORK/'overlap-source.mkv'
  subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=192x108:rate=15','-f','lavfi','-i','anoisesrc=color=pink:amplitude=0.3:seed=19:sample_rate=48000','-t','12','-c:v','libx264','-c:a','pcm_s16le',str(source)],check=True)
  sid=json.load(self.request('/sequence',json.dumps({'count':2,'duration':15}).encode()))['id']
  for index,start,duration in [(0,0,8),(1,5,7)]:
   clip=server.WORK/f'overlap-{index}.mp4'
   subprocess.run(['ffmpeg','-v','error','-ss',str(start),'-i',str(source),'-t',str(duration),'-c:v','libx264','-c:a','aac',str(clip)],check=True)
   self.request(f'/sequence/{sid}/part/{index}',clip.read_bytes()).close()
   self.assertEqual(self.wait(sid,index+1)['state'],'processing')
  self.request(f'/sequence/{sid}/finish',b'').close();job=self.wait(sid)
  self.assertEqual(job['state'],'done',job)
  self.assertAlmostEqual(job['duration'],12,delta=.25,msg=(server.WORK/sid/'overlap-report.json').read_text())
  self.assertAlmostEqual(job['overlapRemoved'],3,delta=.15)
  self.assertTrue(source.exists())
