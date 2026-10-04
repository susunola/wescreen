"""Run with enhancement/.venv/bin/python -m unittest discover -s tests -p '*_test.py'."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('enhance_server', ROOT / 'enhancement/server.py')
server = importlib.util.module_from_spec(spec); spec.loader.exec_module(server)


class EnhancementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.source = Path(self.temp.name) / 'input.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', str(self.source)], check=True)

    def tearDown(self):
        self.temp.cleanup()

    def job(self, mode):
        return dict(source=self.source, output=Path(self.temp.name)/'output.mp4', mode=mode, preview=True, state='queued', progress=0, cancel=threading.Event(), processes=[])

    def test_master_is_444_and_compatible_is_420_without_changing_source(self):
        before=self.source.read_bytes()
        for preset,pixel_format in [('master','yuv444p'),('compatible','yuv420p')]:
            upload=Path(self.temp.name)/('upload-'+preset+'.mp4');upload.write_bytes(before)
            job=self.job('natural');job.update(source=upload,encoding=preset,captureContent='detail',preview=False)
            server.SLOT.acquire();server.run_job(job)
            self.assertEqual(job['state'],'done',job.get('error'))
            info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(job['output'])]))
            self.assertEqual(info['streams'][0]['pix_fmt'],pixel_format)
            self.assertEqual(self.source.read_bytes(),before)
        self.assertIn('unsharp=3:3:0.15',server.enhancement_filter('natural',1,'detail'))
        self.assertNotIn('hqdn3d',server.enhancement_filter('natural',1,'detail'))

    def test_ffmpeg_unavailable_timestamp_does_not_abort_or_reset_progress(self):
        job = {'progress': .2}
        for line in ('out_time_us=N/A\n', 'out_time_us=\n', 'out_time_us=-1\n', 'progress=continue\n'):
            server.update_ffmpeg_progress(job, line, 5)
            self.assertEqual(job['progress'], .2)
        server.update_ffmpeg_progress(job, 'out_time_us=2500000\n', 5)
        self.assertEqual(job['progress'], .5)
        server.update_ffmpeg_progress(job, 'out_time_us=1000000\n', 5)
        self.assertEqual(job['progress'], .5)
        server.update_ffmpeg_progress(job, 'out_time_us=9000000\n', 5)
        self.assertEqual(job['progress'], .99)

    def test_static_tail_trim_and_audio_protection(self):
        master=Path(self.temp.name)/'master.mp4'
        for audible in (False,True):
            subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=5:duration=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000' if audible else 'anullsrc=r=48000:cl=mono','-vf','tpad=stop_mode=clone:stop_duration=75','-t','78','-c:v','libx264','-c:a','aac',str(master)],check=True)
            before=master.read_bytes();self.source.write_bytes(before)
            job=self.job('trimstatic');job.update(preview=False,requireSilence=True)
            server.SLOT.acquire();server.run_job(job)
            self.assertEqual(job['state'],'done',job.get('error'))
            self.assertEqual(master.read_bytes(),before)
            if audible:self.assertEqual(job['tailRemoved'],0);self.assertGreater(job['duration'],77)
            else:self.assertGreater(job['tailRemoved'],70);self.assertLess(job['duration'],5)

    def test_static_tail_preserves_whole_still_and_internal_hold(self):
        from tail import analyze_tail
        master=Path(self.temp.name)/'protected.mp4'
        for internal in (False,True):
            inputs=['-f','lavfi','-i','testsrc2=size=160x90:rate=5:duration=3'] if internal else ['-f','lavfi','-i','color=c=blue:size=160x90:rate=5:duration=78']
            filters=['-vf','tpad=start_mode=clone:start_duration=75'] if internal else []
            subprocess.run(['ffmpeg','-v','error','-y',*inputs,*filters,'-c:v','libx264',str(master)],check=True)
            before=master.read_bytes();job=self.job('trimstatic');job.update(preview=False,requireSilence=True,log=None)
            cut,reason=analyze_tail(job,master,78,vars(server))
            self.assertIsNone(cut,reason);self.assertEqual(master.read_bytes(),before)

    def test_watermark_patch_preserves_dimensions_audio_and_rejects_edges(self):
        for region in ([20,20,20,12],[0,10,20,10],[150,10,20,10]):
            self.source.write_bytes(subprocess.check_output(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']))
            job=self.job('watermark');job['watermark']=region;server.SLOT.acquire();server.run_job(job)
            self.assertEqual(job['state'],'done' if region[0]==20 else 'error',job.get('error'))
            if region[0]==20:self.assertEqual((job['width'],job['height']),(160,90));self.assertGreater(job['size'],0)

    def test_basic_and_light_preserve_size_and_audio(self):
        for mode in ('basic', 'natural', 'light'):
            with self.subTest(mode=mode):
                copy = Path(self.temp.name)/f'{mode}.mp4'; copy.write_bytes(self.source.read_bytes())
                job = self.job(mode); job['source'] = copy
                server.SLOT.acquire(); server.run_job(job)
                self.assertEqual(job['state'], 'done', job.get('error'))
                self.assertEqual((job['width'], job['height']), (160,90))
                self.assertGreater(job['size'], 0)
                streams = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(job['output'])]))['streams']
                self.assertEqual({stream['codec_name'] for stream in streams}, {'h264','aac'})
                self.assertAlmostEqual(job['duration'], 1, delta=0.2)

    def test_ai_uses_neural_model_and_doubles_dimensions(self):
        job = self.job('ai'); server.SLOT.acquire(); server.run_job(job)
        self.assertEqual(job['state'], 'done', job.get('error'))
        self.assertEqual((job['width'], job['height']), (320,180))
        self.assertAlmostEqual(job['duration'], 1, delta=0.2)

    def test_cancel_removes_incomplete_output_and_releases_slot(self):
        job = self.job('ai'); job['cancel'].set(); server.SLOT.acquire(); server.run_job(job)
        self.assertEqual(job['state'], 'cancelled')
        self.assertFalse(job['output'].exists())
        self.assertTrue(server.SLOT.acquire(blocking=False)); server.SLOT.release()

    @unittest.skipUnless(os.environ.get('WESCREEN_SEEDVR_TEST') == '1', 'Large-model integration is opt-in')
    def test_seedvr_restores_real_video_and_preserves_audio(self):
        job = self.job('strong'); server.SLOT.acquire(); server.run_job(job)
        log = (self.source.parent / 'ffmpeg.log').read_text(errors='replace')
        self.assertEqual(job['state'], 'done', str(job.get('error')) + '\n' + log[-5000:])
        self.assertGreater(job['width'], 160)
        self.assertLessEqual(max(job['width'], job['height']), 1920)
        self.assertAlmostEqual(job['duration'], 1, delta=0.2)
        streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(job['output'])]))['streams']
        self.assertEqual({stream['codec_name'] for stream in streams}, {'h264', 'aac'})
        self.assertEqual(job['detail']['phase'], 'Decoding')

    def test_selected_preview_and_trim_crop_keep_audio(self):
        for mode, preview, start, end, crop in [('natural', True, .5, 0, None), ('ai', True, .5, 0, None), ('edit', False, .25, .75, [20, 10, 100, 60])]:
            with self.subTest(mode=mode):
                source = Path(self.temp.name) / f'{mode}-trim.mp4'; source.write_bytes(self.source.read_bytes())
                job = self.job(mode); job.update(source=source, start=start, end=end, crop=crop, preview=preview)
                server.SLOT.acquire(); server.run_job(job)
                self.assertEqual(job['state'], 'done', job.get('error'))
                self.assertAlmostEqual(job['duration'], .5, delta=.12)
                streams = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(job['output'])]))['streams']
                self.assertEqual({stream['codec_name'] for stream in streams}, {'h264','aac'})
                if mode == 'edit': self.assertEqual((job['width'], job['height']), (100,60))

    def test_invalid_crop_and_disk_budget_release_slot(self):
        job = self.job('edit'); job.update(start=0, end=.5, crop=[150,0,100,60])
        server.SLOT.acquire(); server.run_job(job)
        self.assertEqual(job['state'], 'error'); self.assertIn('Crop', job['error'])
        job = self.job('natural'); job['source'] = self.source
        self.source.write_bytes(subprocess.check_output(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-t','1','-c:v','libx264','-f','matroska','pipe:1']))
        with patch.object(server.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 1})()):
            server.SLOT.acquire(); server.run_job(job)
        self.assertEqual(job['state'], 'error'); self.assertIn('disk', job['error'])
        self.assertFalse(server.SLOT.locked())

    def test_completed_result_survives_reload_and_exports_without_long_lived_token(self):
        identifier = 'a'*32; directory = Path(self.temp.name)/identifier; directory.mkdir()
        source = directory/'input'; source.write_bytes(self.source.read_bytes())
        job = self.job('natural'); job.update(id=identifier, source=source, output=directory/'enhanced.mp4', sourceId='source-1', name='video.mp4', createdAt=1)
        with patch.object(server, 'WORK', Path(self.temp.name)), patch.dict(server.JOBS, clear=True):
            server.SLOT.acquire(); server.run_job(job)
            self.assertEqual(job['state'], 'done',job.get('error'))
            server.load_jobs(); self.assertTrue(server.JOBS[identifier]['output'].exists())
            http = server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
            threading.Thread(target=http.serve_forever,daemon=True).start()
            url = f'http://127.0.0.1:{http.server_port}'
            try:
                request = urllib.request.Request(url+'/jobs',headers={'X-WeScreen-Token':server.TOKEN})
                self.assertEqual(json.load(urllib.request.urlopen(request))['jobs'][0]['sourceId'],'source-1')
                request = urllib.request.Request(url+f'/jobs/{identifier}/export',data=b'',headers={'X-WeScreen-Token':server.TOKEN})
                ticket = json.load(urllib.request.urlopen(request))['url']
                self.assertNotIn(server.TOKEN,ticket)
                self.assertEqual(urllib.request.urlopen(ticket).read(),job['output'].read_bytes())
                with self.assertRaises(urllib.error.HTTPError): urllib.request.urlopen(url+f'/jobs/{identifier}/result?ticket=bad')
                request = urllib.request.Request(url+f'/jobs/{identifier}',method='DELETE',headers={'X-WeScreen-Token':server.TOKEN})
                urllib.request.urlopen(request).close(); self.assertFalse(job['output'].exists())
            finally: http.shutdown(); http.server_close()

    def test_http_disk_failure_does_not_lock_future_jobs(self):
        http = server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=http.serve_forever,daemon=True).start()
        try:
            with patch.object(server.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 1})()):
                request = urllib.request.Request(f'http://127.0.0.1:{http.server_port}/jobs?mode=natural',data=self.source.read_bytes(),headers={'X-WeScreen-Token':server.TOKEN})
                with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                self.assertEqual(error.exception.code,400)
                self.assertFalse(server.SLOT.locked())
        finally: http.shutdown(); http.server_close()

    def test_auto_connection_pins_extension_and_rejects_web_origins(self):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        try:
            with patch.object(server, 'PAIR_FILE', Path(self.temp.name)/'paired.txt'):
                url = f'http://127.0.0.1:{http.server_port}/connect'
                for origin in ('', 'https://example.com', 'http://localhost:8000', 'chrome-extension://invalid'):
                    request = urllib.request.Request(url, data=b'{}', headers={'Origin': origin})
                    with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                    self.assertEqual(error.exception.code, 403)
                first = 'chrome-extension://' + 'a'*32
                request = urllib.request.Request(url, data=b'{}', headers={'Origin': first})
                self.assertEqual(json.load(urllib.request.urlopen(request))['token'], server.TOKEN)
                self.assertEqual(server.PAIR_FILE.read_text(), first)
                self.assertEqual(json.load(urllib.request.urlopen(request))['token'], server.TOKEN)
                request = urllib.request.Request(url, data=b'{}', headers={'Origin': 'chrome-extension://'+'b'*32})
                with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 403)
                request = urllib.request.Request(url, data=b'{}', headers={'Origin': first, 'Host': 'evil.example'})
                with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 403)
                from pairing import grant_pairing
                second='chrome-extension://'+'b'*32
                nonce='c'*64
                grant_pairing(server.PAIR_FILE, second, nonce)
                wrong=urllib.request.Request(url+'?challenge='+nonce,data=b'{}',headers={'Origin':'chrome-extension://'+'d'*32})
                with self.assertRaises(urllib.error.HTTPError): urllib.request.urlopen(wrong)
                approved=urllib.request.Request(url+'?challenge='+nonce,data=b'{}',headers={'Origin':second})
                self.assertEqual(json.load(urllib.request.urlopen(approved))['token'],server.TOKEN)
                for origin in (first,second):
                    request=urllib.request.Request(url,data=b'{}',headers={'Origin':origin})
                    self.assertEqual(json.load(urllib.request.urlopen(request))['token'],server.TOKEN)
                self.assertFalse((server.PAIR_FILE.parent/'pair-grants'/(nonce+'.json')).exists())
        finally: http.shutdown(); http.server_close()

    def test_selected_preview_duration_is_respected(self):
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-t','12','-c:v','libx264',str(self.source)],check=True)
        for seconds in (3, 10):
            job = self.job('natural'); job.update(start=1, previewSeconds=seconds)
            copy = Path(self.temp.name)/f'preview-{seconds}.mp4'; copy.write_bytes(self.source.read_bytes()); job['source']=copy
            server.SLOT.acquire(); server.run_job(job)
            self.assertEqual(job['state'], 'done', job.get('error'))
            self.assertAlmostEqual(job['duration'], seconds, delta=.15)

    def test_http_requires_token(self):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        try:
            url = f'http://127.0.0.1:{http.server_port}/health'
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url)
            self.assertEqual(error.exception.code, 401)
            request = urllib.request.Request(url, headers={'X-WeScreen-Token': server.TOKEN})
            self.assertTrue(json.load(urllib.request.urlopen(request))['ready'])
            with patch.object(server, 'seed_ready', return_value=False):
                request = urllib.request.Request(url.replace('/health', '/jobs?mode=strong'), data=b'x', headers={'X-WeScreen-Token': server.TOKEN})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 503)
                self.assertFalse(server.SLOT.locked())
        finally:
            http.shutdown(); http.server_close()

    def test_rotation_swaps_dimensions_preserves_audio_and_expands_arbitrary_angles(self):
        for angle in (90, 270, 45, 360):
            with self.subTest(angle=angle):
                copy=Path(self.temp.name)/f'rotate-{angle}.mp4';copy.write_bytes(self.source.read_bytes())
                job=self.job('edit');job.update(source=copy,rotation=angle,preview=False)
                server.SLOT.acquire();server.run_job(job)
                self.assertEqual(job['state'],'done',job.get('error'))
                if angle in (90,270):self.assertEqual((job['width'],job['height']),(90,160))
                elif angle==360:self.assertEqual((job['width'],job['height']),(160,90))
                else:self.assertGreater(job['width'],160);self.assertGreater(job['height'],90)
                streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(job['output'])]))['streams']
                self.assertEqual({stream['codec_name'] for stream in streams},{'h264','aac'})

    def test_portrait_source_rotates_to_landscape_and_canvas_keeps_upright(self):
        for angle,landscape in [(90,False),(0,True)]:
            portrait=Path(self.temp.name)/f'portrait-{angle}.mp4'
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(self.source),'-vf','transpose=clock','-c:v','libx264','-c:a','aac',str(portrait)],check=True)
            job=self.job('edit');job.update(source=portrait,rotation=angle,landscape=landscape,preview=False)
            server.SLOT.acquire();server.run_job(job)
            self.assertEqual(job['state'],'done',job.get('error'))
            self.assertEqual((job['width'],job['height']),(1920,1080) if landscape else (160,90))



class RealtimeTest(unittest.TestCase):
    def test_frame_uses_neural_model_and_doubles_dimensions(self):
        import cv2
        import numpy as np
        from realtime import enhance_frame
        image = np.random.default_rng(4).integers(0, 256, (90, 160, 3), dtype=np.uint8)
        ok, jpeg = cv2.imencode('.jpg', image)
        self.assertTrue(ok)
        output, elapsed = enhance_frame(jpeg.tobytes(), server.MODEL, server.MODEL_HASH)
        decoded = cv2.imdecode(np.frombuffer(output, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(decoded.shape[:2], (180, 320))
        self.assertGreater(elapsed, 0)
        interpolation = cv2.resize(image, (320, 180), interpolation=cv2.INTER_CUBIC)
        self.assertGreater(float(np.abs(decoded.astype(float)-interpolation).mean()), 1)

    def test_rejects_oversize_header_before_decoding(self):
        from realtime import jpeg_dimensions
        jpeg = b'\xff\xd8\xff\xc0\x00\x0b\x08' + (6000).to_bytes(2,'big')*2 + b'\x01\x01\x11\x00'
        with self.assertRaises(ValueError): jpeg_dimensions(jpeg)
        with self.assertRaises(ValueError): jpeg_dimensions(b'not an image')

    def test_raw_rgb_same_size_lossless_transport_and_limits(self):
        from realtime import enhance_rgb
        import numpy as np
        rgb=np.zeros((32,64,3),np.uint8);rgb[:,20:23]=[240,30,15]
        result,elapsed=enhance_rgb(rgb.tobytes(),64,32,server.MODEL,server.MODEL_HASH)
        self.assertEqual(len(result),rgb.size);self.assertGreater(elapsed,0)
        with self.assertRaises(ValueError):enhance_rgb(rgb.tobytes()[:-1],64,32,server.MODEL,server.MODEL_HASH)
        with self.assertRaises(ValueError):enhance_rgb(b'',1920,1080,server.MODEL,server.MODEL_HASH)

    def test_http_authentication_limits_and_busy_fallback(self):
        from http.server import ThreadingHTTPServer
        import cv2
        import numpy as np
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{http.server_port}/realtime/frame'
        jpeg = cv2.imencode('.jpg', np.zeros((32,64,3), np.uint8))[1].tobytes()
        headers = {'Content-Type':'image/jpeg', 'X-WeScreen-Token':server.TOKEN}
        try:
            with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(urllib.request.Request(base, jpeg))
            self.assertEqual(error.exception.code, 401)
            with urllib.request.urlopen(urllib.request.Request(base,jpeg,headers)) as response:
                self.assertEqual(response.headers['Content-Type'],'image/jpeg')
                self.assertGreater(float(response.headers['X-Inference-Ms']),0)
            raw_headers={'Content-Type':'application/x-wescreen-rgb','X-WeScreen-Token':server.TOKEN,'X-Frame-Width':'64','X-Frame-Height':'32'}
            with urllib.request.urlopen(urllib.request.Request(base,bytes(64*32*3),raw_headers)) as response:
                self.assertEqual(response.headers['Content-Type'],'application/x-wescreen-rgb')
                self.assertEqual(len(response.read()),64*32*3)
                self.assertEqual(response.headers['X-Frame-Width'],'64')
            with urllib.request.urlopen(urllib.request.Request(base,bytes(64*32*3),{**raw_headers,'X-Output-Scale':'2'})) as response:
                self.assertEqual(response.headers['X-Frame-Width'],'128');self.assertEqual(response.headers['X-Frame-Height'],'64')
                self.assertEqual(len(response.read()),128*64*3)
            server.SLOT.acquire()
            try:
                with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(urllib.request.Request(base,jpeg,headers))
                self.assertEqual(error.exception.code,409)
            finally: server.SLOT.release()
            with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(urllib.request.Request(base,b'x',{**headers,'Content-Length':str(2*1024*1024+1)}))
            self.assertEqual(error.exception.code,413)
        finally: http.shutdown(); http.server_close(); thread.join()

class NativeRGBTest(unittest.TestCase):
    def test_native_1080p_input_and_portrait_acceptance(self):
        import numpy as np
        from realtime import enhance_rgb
        for width,height in [(1920,1080),(1080,1920)]:
            frame=np.full((height,width,3),80,np.uint8)
            with patch('realtime.upsample',side_effect=lambda image,*args:np.repeat(np.repeat(image,2,axis=0),2,axis=1)):
                output,_=enhance_rgb(frame.tobytes(),width,height,server.MODEL,server.MODEL_HASH,False,1)
            self.assertEqual(output,frame.tobytes())
        with self.assertRaises(ValueError):enhance_rgb(bytes(1920*1080*3),1920,1080,server.MODEL,server.MODEL_HASH,True,3)

class QualityPreservationTest(unittest.TestCase):
    setUp=EnhancementTest.setUp
    tearDown=EnhancementTest.tearDown
    job=EnhancementTest.job
    def test_visual_restoration_preserves_audio_packets(self):
        def packets(path):
            return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-c:a','copy','-f','adts','pipe:1'])
        before=packets(self.source)
        job=self.job('natural');job.update(preview=False,captureContent='motion')
        server.SLOT.acquire();server.run_job(job)
        self.assertEqual(job['state'],'done',job.get('error'))
        self.assertEqual(packets(job['output']),before)

    def test_hdr_requires_explicit_conversion_and_output_is_bt709(self):
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-t','1','-c:v','libx264','-pix_fmt','yuv420p10le','-x264-params','colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',str(self.source)],check=True)
        with self.assertRaisesRegex(ValueError,'HDR'):server.probe(self.source)
        job=self.job('natural');job.update(preview=False,toneMap=True)
        server.SLOT.acquire();server.run_job(job)
        self.assertEqual(job['state'],'done',job.get('error'))
        info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(job['output'])]))['streams'][0]
        self.assertEqual(info['color_transfer'],'bt709');self.assertEqual(info['color_primaries'],'bt709')

    def test_lossless_live_frame_is_png_and_dimensions_bounded(self):
        import cv2
        import numpy as np
        from realtime import frame_dimensions,enhance_frame
        ok,encoded=cv2.imencode('.png',np.zeros((90,160,3),dtype=np.uint8));self.assertTrue(ok)
        result,elapsed=enhance_frame(encoded.tobytes(),server.MODEL,server.MODEL_HASH,lossless=True)
        self.assertTrue(result.startswith(b'\x89PNG'));self.assertEqual(cv2.imdecode(np.frombuffer(result,np.uint8),1).shape[:2],(180,320));self.assertGreater(elapsed,0)
        bad=bytearray(encoded.tobytes());bad[16:20]=(10000).to_bytes(4,'big')
        with self.assertRaises(ValueError):frame_dimensions(bad)

if __name__ == '__main__':
    unittest.main()
