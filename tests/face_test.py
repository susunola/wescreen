"""Face mode preview gates and streaming failure behavior."""
import hashlib
import json
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
import server
from face_runner import read_frame
import io


class FaceTest(unittest.TestCase):
    def test_frame_stream_rejects_truncation(self):
        self.assertEqual(read_frame(io.BytesIO(b'abcdef'),6),b'abcdef')
        self.assertEqual(read_frame(io.BytesIO(),6),b'')
        with self.assertRaises(ValueError): read_frame(io.BytesIO(b'abc'),6)

    def test_matching_preview_is_required_and_source_mismatch_releases_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
            threading.Thread(target=http.serve_forever,daemon=True).start()
            def request(params,data=b'video'):
                req=urllib.request.Request(f'http://127.0.0.1:{http.server_port}/jobs?mode=face&'+params,data=data,headers={'X-WeScreen-Token':server.TOKEN})
                try:
                    with urllib.request.urlopen(req) as response: return response.status,json.load(response)
                except urllib.error.HTTPError as error: return error.code,json.load(error)
            try:
                with patch.object(server,'WORK',Path(temp)),patch.object(server,'face_ready',return_value=True):
                    status,error=request('preview=0');self.assertEqual(status,400);self.assertIn('preview',error['error']);self.assertFalse(server.SLOT.locked())
                    receipt=dict(mode='face',preview=True,state='done',strength=.65,faceFidelity=.8,faceSourceHash=hashlib.sha256(b'correct').hexdigest())
                    with patch.dict(server.JOBS,{'face-receipt':receipt}):
                        status,error=request('preview=0&strength=.65&faceFidelity=.8&facePreviewId=face-receipt');self.assertEqual(status,400);self.assertIn('another video',error['error']);self.assertFalse(server.SLOT.locked());self.assertEqual(list(Path(temp).iterdir()),[])
                        status,error=request('preview=0&strength=.5&faceFidelity=.8&facePreviewId=face-receipt',b'correct');self.assertEqual(status,400);self.assertFalse(server.SLOT.locked())
                    with patch.object(server,'face_ready',return_value=False):
                        status,error=request('preview=1');self.assertEqual(status,503);self.assertIn('install-face.command',error['error'])
            finally: http.shutdown();http.server_close()
