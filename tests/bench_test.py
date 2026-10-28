import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bench'))
import metrics  # noqa: E402
import report  # noqa: E402
import ffmpeg_sweep  # noqa: E402


class FrameMarkerTest(unittest.TestCase):
    def test_roundtrip_all_indices_survive_noise(self):
        rng = np.random.default_rng(1)
        for index in (0, 1, 149, 255, 256, 40000, 65535):
            frame = rng.integers(0, 255, (64, 320), dtype=np.uint8)
            metrics.stamp_marker(frame, index)
            noisy = np.clip(frame.astype(int) + rng.integers(-40, 40, frame.shape), 0, 255).astype(np.uint8)
            self.assertEqual(metrics.read_marker(noisy), index)

    def test_unstamped_frame_is_rejected(self):
        self.assertIsNone(metrics.read_marker(np.full((64, 320), 128, dtype=np.uint8)))
        self.assertIsNone(metrics.read_marker(np.zeros((64, 320), dtype=np.uint8)))


class SizeAtQualityTest(unittest.TestCase):
    points = [{'bytes': 1000, 'edge_psnr': 30.0}, {'bytes': 4000, 'edge_psnr': 40.0}]

    def test_interpolates_in_log_size(self):
        # Halfway in quality is the geometric mean of the sizes, not the arithmetic one.
        self.assertAlmostEqual(metrics.size_at_quality(self.points, 'edge_psnr', 35.0), 2000.0, places=3)

    def test_returns_endpoints_exactly(self):
        self.assertAlmostEqual(metrics.size_at_quality(self.points, 'edge_psnr', 30.0), 1000.0, places=3)
        self.assertAlmostEqual(metrics.size_at_quality(self.points, 'edge_psnr', 40.0), 4000.0, places=3)

    def test_never_extrapolates(self):
        self.assertIsNone(metrics.size_at_quality(self.points, 'edge_psnr', 45.0))
        self.assertIsNone(metrics.size_at_quality(self.points, 'edge_psnr', 25.0))

    def test_ignores_missing_metric_and_unsorted_input(self):
        pts = [{'bytes': 4000, 'edge_psnr': 40.0}, {'bytes': 500, 'edge_psnr': None}, {'bytes': 1000, 'edge_psnr': 30.0}]
        self.assertAlmostEqual(metrics.size_at_quality(pts, 'edge_psnr', 35.0), 2000.0, places=3)


class PixelMetricsTest(unittest.TestCase):
    def test_psnr_identical_and_noisy(self):
        a = np.full((32, 32), 100, dtype=np.uint8)
        self.assertEqual(metrics.psnr(a, a), 99.0)
        b = a.copy()
        b[0, 0] = 110
        expected = 10 * math.log10(255 ** 2 / (100 / (32 * 32)))
        self.assertAlmostEqual(metrics.psnr(a, b), expected, places=4)

    def test_edge_psnr_only_sees_edges(self):
        ref = np.zeros((64, 64), dtype=np.uint8)
        ref[:, 32:] = 255  # one hard vertical edge
        noisy_flat = ref.copy()
        noisy_flat[:, :8] = 20  # damage far from the edge: must not change edge PSNR
        self.assertEqual(metrics.edge_psnr(ref, noisy_flat), 99.0)
        noisy_edge = ref.copy()
        noisy_edge[:, 30:34] = 128  # damage on the edge
        self.assertLess(metrics.edge_psnr(ref, noisy_edge), 20)

    def test_edge_psnr_is_none_for_flat_reference(self):
        flat = np.full((16, 16), 90, dtype=np.uint8)
        self.assertIsNone(metrics.edge_psnr(flat, flat))

    def test_best_offset_finds_a_frame_shift(self):
        rng = np.random.default_rng(1)
        ref = [rng.integers(0, 255, (24, 24), dtype=np.uint8) for _ in range(20)]
        decoded = [np.zeros((24, 24), dtype=np.uint8)] * 2 + ref  # output starts two frames late
        indices = list(range(0, 20, 2))
        self.assertEqual(metrics.best_offset({i: ref[i] for i in indices}, decoded, indices), 2)


class MatchFrameTest(unittest.TestCase):
    def test_finds_the_content_match_wherever_it_is(self):
        rng = np.random.default_rng(2)
        frames = [rng.integers(0, 255, (16, 16), dtype=np.uint8) for _ in range(40)]
        # A stretched recording: the matching frame is far from where its index says.
        self.assertEqual(metrics.match_frame(frames[30], frames, 5), 30)
        self.assertIn(metrics.match_frame(frames[30], frames, 5, window=3), range(2, 9))


class ExtensionBitrateParityTest(unittest.TestCase):
    """The Python port must match videoBitrate() in recorder.js, or the proxy rows mean nothing."""

    def test_known_values(self):
        # 1080p30 detail: base bitrates are used unscaled.
        self.assertEqual(ffmpeg_sweep.extension_bitrate(1920, 1080, 30, 'detail', 'compact'), 3_000_000)
        self.assertEqual(ffmpeg_sweep.extension_bitrate(1920, 1080, 30, 'detail', 'standard'), 6_000_000)
        self.assertEqual(ffmpeg_sweep.extension_bitrate(1920, 1080, 30, 'motion', 'high'), 14_000_000)
        # Sublinear in pixels: 720p is (0.4444)^0.75 of the 1080p rate, not 0.4444.
        expected = round(6_000_000 * (1280 * 720 / (1920 * 1080)) ** .75)
        self.assertEqual(ffmpeg_sweep.extension_bitrate(1280, 720, 30, 'detail', 'standard'), expected)

    def test_matches_recorder_js_source(self):
        source = (Path(__file__).resolve().parents[1] / 'recorder.js').read_text()
        for needle in ('24000000', '3000000', '6000000', '14000000', '2500000', '4000000', 'Math.pow(pixels,.75)', 'Math.pow(fps,.585)', '180000000'):
            self.assertIn(needle, source, f'recorder.js no longer contains {needle}; update the bench port')


class ReportTest(unittest.TestCase):
    def rows(self):
        def row(source, encoder, param, clip, nbytes, edge):
            return {'source': source, 'encoder': encoder, 'param': param, 'clip': clip, 'bytes': nbytes, 'edge_psnr': edge,
                    'kbps': nbytes / 100, 'mb_per_min': 1.0, 'ssim': 0.99, 'frames_decoded': 150, 'frames_expected': 150, 'browser': 'TestBrowser'}
        return [row('browser', 'MediaRecorder vp9', 'a', 'c1', 4000, 40.0), row('browser', 'MediaRecorder vp9', 'b', 'c1', 1000, 30.0),
                row('ffmpeg', 'x264', 'a', 'c1', 2000, 40.0), row('ffmpeg', 'x264', 'b', 'c1', 500, 30.0)]

    def test_ratio_against_baseline(self):
        text = report.render(self.rows(), 'browser: MediaRecorder vp9')
        self.assertIn('| ffmpeg: x264 | 0.50× (n=1) | 0.50× (n=1) |', text)
        self.assertIn('TestBrowser', text)

    def test_unreachable_target_is_a_dash_not_a_guess(self):
        rows = [r for r in self.rows() if not (r['encoder'] == 'x264' and r['param'] == 'a')]
        rows.append({**rows[-1], 'param': 'c', 'bytes': 800, 'edge_psnr': 33.0})
        text = report.render(rows, 'browser: MediaRecorder vp9')
        self.assertIn('| ffmpeg: x264 | 0.', text)
        self.assertIn('| —', text)  # 35 dB lies outside the measured x264 range


if __name__ == '__main__':
    unittest.main()
