import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
from realtime import balanced_sdr_tone

class SDRToneTest(unittest.TestCase):
    def test_flat_colors_and_endpoints_preserved(self):
        for color in [(0,0,0),(255,255,255),(70,120,180),(128,128,128)]:
            image=np.full((16,16,3),color,np.uint8)
            np.testing.assert_array_equal(balanced_sdr_tone(image),image)

    def test_detail_change_bounded(self):
        rng=np.random.default_rng(42)
        image=rng.integers(0,256,(32,32,3),dtype=np.uint8)
        result=balanced_sdr_tone(image)
        self.assertLessEqual(np.abs(result.astype(int)-image.astype(int)).max(),2)
        self.assertEqual(result.dtype,np.uint8)
