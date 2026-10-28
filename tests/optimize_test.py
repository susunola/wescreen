import importlib.util
import json
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('optimize_server', ROOT / 'enhancement/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
import optimize  # noqa: E402  (server.py put enhancement/ on sys.path)

PROBE = {'width': 1920, 'height': 1080, 'fps': 60, 'audio_codec': 'opus'}


class PureBuildersTest(unittest.TestCase):
    def test_encoder_detection_reads_ffmpeg_output(self):
        listing = ' V....D libx264              libx264 H.264\n V....D libx265              libx265 H.265\n V....D libvpx-vp9           VP9\n V..... libwebp_anim         WebP\n'
        self.assertEqual(optimize.available_encoders(listing), ['x264', 'x265', 'vp9', 'webp', 'gif'])
        self.assertEqual(optimize.available_encoders(''), ['gif'])

    def test_scaling_never_enlarges_and_stays_even(self):
        self.assertEqual(optimize.scaled_size(1920, 1080, 720), (1280, 720))
        self.assertEqual(optimize.scaled_size(1280, 720, 1080), (1280, 720))
        self.assertEqual(optimize.scaled_size(1001, 563, 0), (1000, 562))
        width, height = optimize.scaled_size(3824, 1770, 1000)
        self.assertEqual((width % 2, height % 2), (0, 0))

    def test_validate_rejects_bad_input_and_unavailable_codecs(self):
        ok = ['x265', 'x264', 'gif']
        self.assertEqual(optimize.validate({}, ok)['target'], 'x265')
        for bad in ({'target': 'prores'}, {'quality': 'ultra'}, {'maxHeight': -1}, {'maxFps': 500}, {'start': 5, 'end': 3}, {'start': -1}, {'maxFps': float('nan')}):
            with self.assertRaises(ValueError, msg=bad):
                optimize.validate(bad, ok)
        with self.assertRaises(ValueError):
            optimize.validate({'target': 'svtav1'}, ok)
        with self.assertRaises(ValueError):
            optimize.validate({'maxHeight': 'tall'}, ok)

    def test_optimize_command_uses_constant_quality_and_sane_audio(self):
        options = optimize.validate({'target': 'x265', 'quality': 'small', 'maxHeight': 720, 'maxFps': 30}, ['x265'])
        command = optimize.optimize_command('in', 'out.mp4', options, PROBE)
        self.assertIn('libx265', command)
        self.assertEqual(command[command.index('-crf') + 1], '30')
        self.assertIn('hvc1', command)
        self.assertEqual(command[command.index('-vf') + 1], 'scale=1280:720:flags=lanczos,fps=30')
        self.assertEqual(command[command.index('-c:a') + 1], 'aac', 'opus does not belong in MP4 players that expect AAC')
        self.assertEqual(command[-1], 'out.mp4')
        self.assertNotIn('-b:v', command)

    def test_svtav1_uses_screen_content_mode_effort_presets_and_can_opt_out(self):
        options = optimize.validate({'target': 'svtav1', 'quality': 'small', 'effort': 'fast'}, ['svtav1'])
        command = optimize.optimize_command('in', 'o.mp4', options, PROBE)
        self.assertEqual(command[command.index('-svtav1-params') + 1], 'scm=1')
        self.assertEqual(command[command.index('-crf') + 1], '50')
        self.assertEqual(command[command.index('-preset') + 1], '10')
        plain = optimize.optimize_command('in', 'o.mp4', {**options, 'screenContent': False}, PROBE)
        self.assertNotIn('-svtav1-params', plain)
        with self.assertRaises(ValueError):
            optimize.validate({'target': 'svtav1', 'effort': 'instant'}, ['svtav1'])

    def test_copy_audio_when_already_mp4_friendly_and_opus_for_webm(self):
        mp4 = optimize.optimize_command('in', 'o.mp4', optimize.validate({'target': 'x264'}, ['x264']), {**PROBE, 'audio_codec': 'aac'})
        self.assertEqual(mp4[mp4.index('-c:a') + 1], 'copy')
        webm = optimize.optimize_command('in', 'o.webm', optimize.validate({'target': 'vp9'}, ['vp9']), PROBE)
        self.assertEqual(webm[webm.index('-c:a') + 1], 'libopus')
        self.assertEqual(webm[webm.index('-b:v') + 1], '0')

    def test_no_filter_when_nothing_to_change_and_trim_is_applied_before_input(self):
        options = optimize.validate({'target': 'x264', 'start': 2, 'end': 7}, ['x264'])
        command = optimize.optimize_command('in', 'o.mp4', options, {'width': 1280, 'height': 720, 'fps': 30, 'audio_codec': 'aac'})
        self.assertNotIn('-vf', command)
        self.assertLess(command.index('-ss'), command.index('-i'))
        self.assertEqual(command[command.index('-t') + 1], '5')

    def test_animation_commands_are_bounded(self):
        gif = optimize.animation_command('in', 'o.gif', optimize.validate({'target': 'gif', 'quality': 'small'}, ['gif']), PROBE)
        graph = gif[gif.index('-filter_complex') + 1]
        self.assertIn('fps=8', graph)
        self.assertIn('scale=640:-2', graph)
        self.assertIn('palettegen=max_colors=96', graph)
        self.assertIn('-an', gif)
        webp = optimize.animation_command('in', 'o.webp', optimize.validate({'target': 'webp', 'quality': 'archive', 'maxFps': 60}, ['webp']), PROBE)
        self.assertIn('fps=30', webp[webp.index('-vf') + 1], 'frame rate is capped even if the request asks for more')
        self.assertIn('libwebp_anim', webp)


class WebpDurationTest(unittest.TestCase):
    def build(self, durations, trailing=b''):
        def chunk(tag, payload):
            return tag + len(payload).to_bytes(4, 'little') + payload + (b'\0' if len(payload) % 2 else b'')
        frames = b''.join(chunk(b'ANMF', bytes(12) + d.to_bytes(3, 'little') + b'\x00' + b'xyz') for d in durations)  # 3-byte image data forces padding
        body = b'WEBP' + chunk(b'VP8X', bytes(10)) + chunk(b'ANIM', bytes(6)) + frames + trailing
        return b'RIFF' + len(body).to_bytes(4, 'little') + body

    def test_sums_frame_delays_across_padded_chunks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'a.webp'
            path.write_bytes(self.build([100, 50, 250]))
            self.assertAlmostEqual(optimize.webp_duration(path), 0.4)
            path.write_bytes(b'not a webp at all')
            self.assertEqual(optimize.webp_duration(path), 0)
            path.write_bytes(self.build([100, 100])[:-9])  # truncated mid-chunk must not raise
            self.assertGreaterEqual(optimize.webp_duration(path), 0)


class JobTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = (server.WORK, server.JOBS, server.PAIR_FILE)
        server.WORK = Path(self.temp.name); server.JOBS = {}; server.PAIR_FILE = server.WORK / 'pair'
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'
        self.clip = server.WORK / 'source.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
                        '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-c:a', 'aac', str(self.clip)], check=True)
        self.encoders = optimize.available_encoders()

    def tearDown(self):
        self.http.shutdown(); self.http.server_close()
        server.WORK, server.JOBS, server.PAIR_FILE = self.old
        self.temp.cleanup()

    def request(self, path, data=None, token=True):
        headers = {'X-WeScreen-Token': server.TOKEN} if token else {}
        return urllib.request.urlopen(urllib.request.Request(self.url + path, data=data, headers=headers), timeout=60)

    def run_job(self, **options):
        upload = json.load(self.request('/uploads', self.clip.read_bytes()))['id']
        identifier = json.load(self.request('/jobs/optimize', json.dumps({'upload': upload, 'name': 't', **options}).encode()))['id']
        deadline = time.time() + 120
        while time.time() < deadline:
            job = json.load(self.request('/jobs/' + identifier))
            if job['state'] in ('done', 'error', 'cancelled'):
                return identifier, job
            time.sleep(.1)
        self.fail('optimize timeout')

    def probe(self, path):
        return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))

    def test_health_advertises_encoders(self):
        health = json.load(self.request('/health'))
        self.assertEqual(health['optimize'], self.encoders)

    def test_x265_reencode_is_smaller_playable_and_keeps_duration(self):
        if 'x265' not in self.encoders: self.skipTest('no libx265')
        identifier, job = self.run_job(target='x265', quality='balanced', maxHeight=240)
        self.assertEqual(job['state'], 'done', job)
        self.assertEqual(job['height'], 240)
        self.assertAlmostEqual(job['duration'], 3, delta=.2)
        self.assertGreater(job['savedRatio'], 0)
        output = server.JOBS[identifier]['output']
        streams = {s['codec_type']: s['codec_name'] for s in self.probe(output)['streams']}
        self.assertEqual(streams, {'video': 'hevc', 'audio': 'aac'})
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True)
        # The staged upload is consumed, the result downloads with its own name and type.
        with self.request(f'/jobs/{identifier}/result') as response:
            self.assertEqual(response.headers['Content-Type'], 'video/mp4')
            self.assertIn('optimized.mp4', response.headers['Content-Disposition'])
            self.assertEqual(len(response.read()), output.stat().st_size)

    def test_svtav1_screen_content_job_is_a_playable_av1_mp4(self):
        if 'svtav1' not in self.encoders: self.skipTest('no libsvtav1')
        identifier, job = self.run_job(target='svtav1', quality='small', effort='fast', maxHeight=180)
        self.assertEqual(job['state'], 'done', job)
        output = server.JOBS[identifier]['output']
        self.assertEqual({s['codec_type']: s['codec_name'] for s in self.probe(output)['streams']}['video'], 'av1')
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True)

    def test_vp9_webm_result_survives_a_helper_restart(self):
        if 'vp9' not in self.encoders: self.skipTest('no libvpx-vp9')
        identifier, job = self.run_job(target='vp9', quality='small', maxHeight=180)
        self.assertEqual(job['state'], 'done', job)
        self.assertEqual(job['outputName'], 'optimized.webm')
        server.JOBS.clear()
        server.load_jobs()
        reloaded = server.JOBS[identifier]
        self.assertEqual(reloaded['state'], 'done')
        self.assertEqual(reloaded['output'].name, 'optimized.webm')
        with self.request(f'/jobs/{identifier}/result') as response:
            response.read()
            self.assertEqual(response.headers['Content-Type'], 'video/webm')

    def test_gif_export_is_a_looping_gif_without_audio(self):
        identifier, job = self.run_job(target='gif', quality='small')
        self.assertEqual(job['state'], 'done', job)
        output = server.JOBS[identifier]['output']
        self.assertEqual(output.read_bytes()[:6], b'GIF89a')
        info = self.probe(output)
        self.assertEqual([s['codec_type'] for s in info['streams']], ['video'])
        self.assertEqual(info['streams'][0]['width'], 640)
        self.assertAlmostEqual(job['duration'], 3, delta=.4)
        with self.request(f'/jobs/{identifier}/result') as response:
            response.read()
            self.assertEqual(response.headers['Content-Type'], 'image/gif')

    def test_webp_export_when_the_build_supports_it(self):
        if 'webp' not in self.encoders: self.skipTest('no libwebp_anim')
        identifier, job = self.run_job(target='webp', quality='balanced', maxHeight=180)
        self.assertEqual(job['state'], 'done', job)
        data = server.JOBS[identifier]['output'].read_bytes()
        self.assertEqual((data[:4], data[8:12]), (b'RIFF', b'WEBP'))

    def test_bad_requests_are_rejected_and_the_upload_is_kept(self):
        upload = json.load(self.request('/uploads', self.clip.read_bytes()))['id']
        for body in ({'upload': '../token'}, {'upload': upload, 'target': 'prores'}, {'upload': upload, 'start': 3, 'end': 1}, {'upload': 'a' * 32}):
            with self.assertRaises(urllib.error.HTTPError, msg=body) as caught:
                self.request('/jobs/optimize', json.dumps(body).encode())
            self.assertEqual(caught.exception.code, 400)
        self.assertTrue((server.WORK / 'uploads' / upload).exists(), 'a rejected request must not consume the upload')
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request('/jobs/optimize', json.dumps({'upload': upload}).encode(), token=False)
        self.assertEqual(caught.exception.code, 401)

    def test_overlong_animation_is_refused_before_work_starts(self):
        upload = json.load(self.request('/uploads', self.clip.read_bytes()))['id']
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request('/jobs/optimize', json.dumps({'upload': upload, 'target': 'gif', 'start': 0, 'end': 120}).encode())
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('limited to', caught.exception.read().decode())


if __name__ == '__main__':
    unittest.main()
