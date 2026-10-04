import sys
import unittest
from pathlib import Path
import numpy as np
import cv2
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
from smart_restore import TemporalRepair,diagnose,restore,text_protection,clean_chroma,recover_soft_detail

class SmartRestoreTest(unittest.TestCase):
    def test_noise_detection_and_diagnostics_ignore_borders(self):
        rng=np.random.default_rng(4)
        image=(120+rng.integers(-7,8,(96,128,3))).astype(np.uint8)
        padded=np.pad(image,((0,0),(40,40),(0,0)))
        report=diagnose(padded)
        self.assertTrue(report['degraded']);self.assertGreater(report['noise'],1)
        self.assertEqual(report['contentWidth'],128)

    def test_temporal_rejects_cuts_and_seek_history(self):
        t=TemporalRepair();a=np.full((64,96,3),40,np.uint8);b=np.full_like(a,190)
        t.apply(a,0);np.testing.assert_array_equal(t.apply(b,.04),b)
        rng=np.random.default_rng(3);frame=(128+rng.integers(-5,6,a.shape)).astype(np.uint8)
        np.testing.assert_array_equal(t.apply(frame,4),frame)
        t.reset();np.testing.assert_array_equal(t.apply(frame,4.04),frame)

    def test_aligned_static_noise_is_reduced(self):
        rng=np.random.default_rng(10);shape=(96,128,3)
        a=(128+rng.integers(-4,5,shape)).astype(np.uint8);b=(128+rng.integers(-4,5,shape)).astype(np.uint8)
        t=TemporalRepair();t.apply(a,0);out=t.apply(b,.04)
        self.assertLess(np.mean((out.astype(float)-128)**2),np.mean((b.astype(float)-128)**2))

    def test_motion_does_not_leave_previous_edge(self):
        a=np.full((96,128,3),70,np.uint8);a[20:60,20:60]=190
        b=np.full_like(a,70);b[20:60,28:68]=190
        t=TemporalRepair();t.apply(a,0);out=t.apply(b,.04)
        np.testing.assert_array_equal(out,b)

    def test_text_bypasses_neural_and_temporal(self):
        class Bad:
            def apply(self,*args):raise AssertionError('Temporal applied to text')
        image=np.full((32,64,3),128,np.uint8)
        out=restore(image,Bad(),0,lambda *_: (_ for _ in ()).throw(AssertionError('Neural text')),diagnose(image),True,2)
        np.testing.assert_array_equal(out,image)

    def test_large_neural_guide_adds_bounded_residual_without_replacing_edges(self):
        from smart_model import NeuralRepair
        model=NeuralRepair.__new__(NeuralRepair);sizes=[]
        def prediction(frame,scale):
            sizes.append(frame.shape)
            return np.clip(frame.astype(int)+20,0,255).astype(np.uint8)
        model.infer_tiles=prediction
        frame=np.full((600,1200,3),100,np.uint8);frame[:,600:]=190
        result=model(frame,1)
        self.assertEqual(result.shape,frame.shape)
        self.assertEqual(max(sizes[0][:2]),640)
        self.assertLessEqual(np.abs(result.astype(int)-frame.astype(int)).max(),12)
        np.testing.assert_array_equal(result[:,599:601],frame[:,599:601])

    def test_subtitle_strokes_get_soft_protection_not_a_hard_binary_edge(self):
        image=np.full((180,320,3),160,np.uint8)
        cv2.putText(image,'SOURCE TEXT',(25,100),cv2.FONT_HERSHEY_SIMPLEX,.55,(10,10,10),1,cv2.LINE_AA)
        mask=text_protection(image)
        self.assertGreater(float(mask[80:105,20:160].max()),.9)
        self.assertTrue(np.any((mask>0)&(mask<1)))
        self.assertEqual(float(text_protection(np.full_like(image,128)).max()),0)

    def test_chroma_speckles_reduce_without_luma_blur(self):
        rng=np.random.default_rng(42)
        ycc=np.full((96,128,3),128,np.uint8);ycc[:,64:,0]=180
        ycc[...,1:]=128+rng.integers(-10,11,(96,128,2))
        frame=cv2.cvtColor(ycc,cv2.COLOR_YCrCb2BGR)
        profile=diagnose(frame);self.assertGreater(profile['chromaNoise'],2)
        out=cv2.cvtColor(clean_chroma(frame,profile),cv2.COLOR_BGR2YCrCb)
        before=cv2.cvtColor(frame,cv2.COLOR_BGR2YCrCb)
        self.assertLess(np.mean((out[...,1:].astype(float)-128)**2),np.mean((before[...,1:].astype(float)-128)**2)*.8)
        self.assertLessEqual(np.abs(out[...,0].astype(int)-before[...,0]).max(),1)
        np.testing.assert_array_equal(clean_chroma(frame,{'chromaNoise':0}),frame)

    def test_soft_detail_increases_blurred_edge_without_new_extrema(self):
        source=np.full((96,128,3),65,np.uint8);source[:,64:]=185
        blurred=cv2.GaussianBlur(source,(0,0),2)
        out=recover_soft_detail(blurred,{'soft':True,'noise':0})
        self.assertGreater(float(out[:,66,0].mean()-out[:,61,0].mean()),float(blurred[:,66,0].mean()-blurred[:,61,0].mean()))
        self.assertGreaterEqual(out.min(),blurred.min());self.assertLessEqual(out.max(),blurred.max())
        self.assertLessEqual(np.abs(out.astype(int)-blurred.astype(int)).max(),5)
        np.testing.assert_array_equal(recover_soft_detail(blurred,{'soft':False}),blurred)

    def test_soft_detail_does_not_amplify_flat_noise(self):
        rng=np.random.default_rng(25)
        frame=(128+rng.integers(-2,3,(96,128,1))).astype(np.uint8).repeat(3,axis=2)
        out=recover_soft_detail(frame,{'soft':True,'noise':4})
        np.testing.assert_array_equal(out,frame)

    def test_soft_large_source_uses_more_detailed_guide_with_bounded_residual(self):
        from smart_model import NeuralRepair
        from smart_runner import neural_settings
        self.assertEqual(neural_settings({'soft':True,'noise':0})['guide_long_side'],960)
        self.assertEqual(neural_settings({'noise':5})['denoise'],.5)
        self.assertEqual(neural_settings({'soft':False,'noise':0})['guide_long_side'],640)
        model=NeuralRepair.__new__(NeuralRepair);model.guide_long_side=960;sizes=[]
        def prediction(frame,scale):
            sizes.append(frame.shape)
            return np.clip(frame.astype(int)+20,0,255).astype(np.uint8)
        model.infer_tiles=prediction
        frame=np.full((600,1200,3),100,np.uint8);frame[:,600:]=190
        out=model(frame,1)
        self.assertEqual(max(sizes[0][:2]),960)
        self.assertEqual(out.shape,frame.shape)
        self.assertLessEqual(np.abs(out.astype(int)-frame.astype(int)).max(),12)
        np.testing.assert_array_equal(out[:,599:601],frame[:,599:601])
