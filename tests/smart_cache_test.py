import sys
import json
import time
import unittest
import tempfile
import threading
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
import server
import smart_cache

class SmartCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.cache_patch=patch.object(smart_cache,'CACHE',self.root/'cache');self.cache_patch.start()
        self.model_patch=patch.object(smart_cache,'smart_ready',return_value=False);self.model_patch.start()
        self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.source=self.root/'source.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-t','1','-c:v','libx264',str(self.source)],check=True)
        self.original=self.source.read_bytes()
    def tearDown(self):
        self.http.shutdown();self.http.server_close()
        for sid,session in list(smart_cache.SESSIONS.items()):smart_cache.cleanup_session(session,vars(server));smart_cache.SESSIONS.pop(sid,None)
        self.model_patch.stop();self.cache_patch.stop();self.tmp.cleanup()
    def request(self,path,method='GET',data=None,token=True):
        request=urllib.request.Request(f'http://127.0.0.1:{self.http.server_port}'+path,data=data,method=method,headers={'X-WeScreen-Token':server.TOKEN if token else 'invalid'})
        with urllib.request.urlopen(request,timeout=20) as response:return response.read()
    def test_authenticated_full_chunk_roundtrip_and_cleanup(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/smart/sources','POST',self.original,False)
        self.assertEqual(error.exception.code,401)
        source=json.loads(self.request('/smart/sources','POST',self.original));sid=source['id']
        with self.assertRaises(urllib.error.HTTPError):self.request(f'/smart/{sid}/chunks/1','POST',b'')
        self.request(f'/smart/{sid}/chunks/0','POST',b'')
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            info=json.loads(self.request(f'/smart/{sid}/chunks/0'))
            if info['state'] in ('done','error'):break
            time.sleep(.1)
        self.assertEqual(info['state'],'done',info)
        self.assertEqual(info['width'],320);self.assertIn('analysis',info)
        output=self.request(f'/smart/{sid}/chunks/0?result=1');self.assertGreater(len(output),100)
        self.assertEqual(self.source.read_bytes(),self.original)
        self.request(f'/smart/{sid}','DELETE');self.assertFalse((self.root/'cache'/sid).exists())
        # A fresh playback session (also after helper restart) reuses repaired bytes.
        reopened=json.loads(self.request('/smart/sources','POST',self.original))
        self.assertIn('0',reopened['completed'])
        self.assertEqual(self.request(f"/smart/{reopened['id']}/chunks/0?result=1"),output)
        self.assertEqual(json.loads(self.request(f"/smart/{reopened['id']}/chunks/0",'POST',b''))['state'],'done')
        different=json.loads(self.request('/smart/sources?content=detail','POST',self.original))
        self.assertEqual(different['completed'],{})
        self.assertTrue(server.SLOT.acquire(blocking=False));server.SLOT.release()
    def test_invalid_upload_removes_temporary_private_source(self):
        with self.assertRaises(urllib.error.HTTPError):self.request('/smart/sources','POST',b'invalid')
        self.assertEqual(list((self.root/'cache').iterdir()),[])

    def test_cancel_running_worker_removes_cache_and_releases_slot(self):
        original_popen=subprocess.Popen
        def slow_worker(command,**kwargs):
            return original_popen([sys.executable,'-c','import time;time.sleep(30)'],**kwargs)
        sid=json.loads(self.request('/smart/sources','POST',self.original))['id']
        with patch.object(smart_cache.subprocess,'Popen',side_effect=slow_worker):
            self.request(f'/smart/{sid}/chunks/0','POST',b'')
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                info=json.loads(self.request(f'/smart/{sid}/chunks/0'))
                if info['state']=='processing':break
                time.sleep(.02)
            self.assertEqual(info['state'],'processing')
            self.request(f'/smart/{sid}','DELETE')
        self.assertFalse((self.root/'cache'/sid).exists())
        self.assertTrue(server.SLOT.acquire(blocking=False));server.SLOT.release()

    def test_cancel_chunk_keeps_source_and_allows_repair_again(self):
        original_popen=subprocess.Popen
        def slow_worker(command,**kwargs):
            return original_popen([sys.executable,'-c','import time;time.sleep(30)'],**kwargs)
        sid=json.loads(self.request('/smart/sources','POST',self.original))['id']
        with patch.object(smart_cache.subprocess,'Popen',side_effect=slow_worker):
            self.request(f'/smart/{sid}/chunks/0','POST',b'')
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                if json.loads(self.request(f'/smart/{sid}/chunks/0'))['state']=='processing':break
                time.sleep(.02)
            self.request(f'/smart/{sid}/chunks/0','DELETE')
        self.assertEqual(smart_cache.SESSIONS[sid]['source'].read_bytes(),self.original)
        self.assertNotIn(0,smart_cache.SESSIONS[sid]['chunks'])
        self.assertFalse(smart_cache.SESSIONS[sid]['cancel'].is_set())
        self.request(f'/smart/{sid}/chunks/0','POST',b'')
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            info=json.loads(self.request(f'/smart/{sid}/chunks/0'))
            if info['state'] in ('done','error'):break
            time.sleep(.1)
        self.assertEqual(info['state'],'done',info)

    def test_full_file_retains_more_than_six_chunks(self):
        longer=self.root/'long.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=3','-t','25','-c:v','libx264',str(longer)],check=True)
        data=longer.read_bytes();result=json.loads(self.request('/smart/sources','POST',data));sid=result['id']
        self.assertEqual(result['totalChunks'],7)
        for index in range(7):
            self.request(f'/smart/{sid}/chunks/{index}','POST',b'')
            deadline=time.monotonic()+20
            while time.monotonic()<deadline:
                info=json.loads(self.request(f'/smart/{sid}/chunks/{index}'))
                if info['state'] in ('done','error'):break
                time.sleep(.05)
            self.assertEqual(info['state'],'done',info)
        self.request(f'/smart/{sid}','DELETE')
        reopened=json.loads(self.request('/smart/sources','POST',data))
        self.assertEqual(len(reopened['completed']),7)
        self.assertGreater(len(self.request(f"/smart/{reopened['id']}/chunks/0?result=1")),100)
