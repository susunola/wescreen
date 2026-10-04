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
        self.assertLessEqual(np.abs(result.astype(int)-image.astype(int)).max(),4)
        self.assertEqual(result.dtype,np.uint8)

    def test_low_amplitude_noise_not_amplified(self):
        rng=np.random.default_rng(6)
        grey=128+rng.integers(-1,2,(32,32),dtype=np.int16)
        image=np.repeat(grey[...,None],3,axis=2).astype(np.uint8)
        np.testing.assert_array_equal(balanced_sdr_tone(image),image)

    def test_midtones_gain_local_detail_without_color_cast(self):
        ramp=np.linspace(70,180,64).astype(np.uint8)
        image=np.repeat(np.tile(ramp,(32,1))[...,None],3,axis=2)
        image[:,28:36]=145
        result=balanced_sdr_tone(image)
        self.assertGreater(int(result[16,28,0]),int(image[16,28,0]))
        np.testing.assert_array_equal(result[...,0],result[...,1])
        np.testing.assert_array_equal(result[...,1],result[...,2])
