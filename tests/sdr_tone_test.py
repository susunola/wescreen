import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
from realtime import balanced_sdr_tone, clean_compression, adaptive_detail, clean_blocks, enhance_rgb

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

    def test_flat_codec_noise_reduced_and_step_edges_preserved(self):
        rng=np.random.default_rng(20)
        noisy=(128+rng.integers(-5,6,(64,64,3))).astype(np.uint8)
        cleaned=clean_compression(noisy)
        self.assertLess(np.mean((cleaned.astype(float)-128)**2),np.mean((noisy.astype(float)-128)**2))
        step=np.full((32,64,3),60,np.uint8);step[:,32:]=190
        np.testing.assert_array_equal(clean_compression(step),step)

    def test_detail_does_not_create_halos_or_amplify_small_noise(self):
        step=np.full((32,64,3),60,np.uint8);step[:,32:]=190
        result=adaptive_detail(step)
        np.testing.assert_array_equal(result,step)
        rng=np.random.default_rng(4)
        noise=(128+rng.integers(-1,2,(32,32,3))).astype(np.uint8)
        np.testing.assert_array_equal(adaptive_detail(noise),noise)

    def test_detail_increases_texture_contrast_with_bounded_delta(self):
        wave=np.round(128+24*np.sin(np.arange(64)*1.5)).astype(np.uint8)
        image=np.repeat(np.tile(wave,(32,1))[...,None],3,axis=2)
        result=adaptive_detail(image)
        self.assertGreater(result[...,0].astype(float).std(),image[...,0].astype(float).std())
        self.assertLessEqual(np.abs(result.astype(int)-image.astype(int)).max(),3)

    def test_clean_sources_bypass_noise_cleanup(self):
        rng=np.random.default_rng(42)
        image=(128+rng.integers(-1,2,(64,64,3))).astype(np.uint8)
        np.testing.assert_array_equal(clean_compression(image),image)

    def test_native_resolution_noise_is_detected_without_downsample_averaging(self):
        rng=np.random.default_rng(24)
        image=(128+rng.integers(-5,6,(1080,1920,3))).astype(np.uint8)
        result=clean_compression(image)
        self.assertLess(np.mean((result.astype(float)-128)**2),np.mean((image.astype(float)-128)**2)*.8)
        self.assertEqual(result.shape,image.shape)

    def test_block_seams_reduced_without_blurring_strong_edges(self):
        image=np.full((32,32,3),120,np.uint8);image[:,8:16]=132
        result=clean_blocks(image)
        self.assertLess(abs(int(result[4,8,0])-int(result[4,7,0])),12)
        image[:,16:]=220
        result=clean_blocks(image)
        np.testing.assert_array_equal(result[:,15:17],image[:,15:17])

    def test_same_size_repair_does_not_invoke_super_resolution(self):
        from unittest.mock import patch
        image=np.full((32,64,3),128,np.uint8)
        with patch('realtime.upsample',side_effect=AssertionError('Unexpected SR')):
            output,_=enhance_rgb(image.tobytes(),64,32,None,None,False,1)
        np.testing.assert_array_equal(np.frombuffer(output,np.uint8).reshape(image.shape),image)
