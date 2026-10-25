import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('compare_video',Path(__file__).resolve().parents[1]/'scripts/compare-video.py')
compare=importlib.util.module_from_spec(spec);spec.loader.exec_module(compare)
class ComparisonContractTest(unittest.TestCase):
 def test_rejects_mismatched_external_outputs(self):
  source=dict(width=640,height=360,fps=30,duration=4)
  for changed in [dict(width=1280),dict(height=720),dict(fps=24),dict(duration=3)]:
   with self.subTest(changed=changed),patch.object(compare,'probe',return_value={**source,**changed}):
    with self.assertRaises(ValueError):compare.validate(source,'unused')
 def test_modified_input_is_rejected(self):
  with tempfile.TemporaryDirectory() as temporary:
   folder=Path(temporary);(folder/'input.mp4').write_bytes(b'original')
   (folder/'case.json').write_text(json.dumps({'inputSHA256':compare.sha(folder/'input.mp4')}))
   (folder/'input.mp4').write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'input changed'):compare.load(folder)
 def test_modified_reference_is_rejected(self):
  with tempfile.TemporaryDirectory() as temporary:
   folder=Path(temporary);(folder/'input.mp4').write_bytes(b'original');(folder/'reference.mp4').write_bytes(b'reference')
   (folder/'case.json').write_text(json.dumps({'inputSHA256':compare.sha(folder/'input.mp4'),'referenceSHA256':compare.sha(folder/'reference.mp4')}))
   (folder/'reference.mp4').write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'reference changed'):compare.load(folder)

class BlindReviewTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.folder=Path(self.temp.name)
  (self.folder/'input.mp4').write_bytes(b'input')
  outputs={}
  for name in ('spatial','neural'):
   file=self.folder/(name+'.mp4');file.write_bytes(name.encode());outputs[name]={'file':file.name,'sha256':compare.sha(file)}
  compare.save(self.folder,{'inputSHA256':compare.sha(self.folder/'input.mp4'),'outputs':outputs})
  from types import SimpleNamespace
  self.args=SimpleNamespace(case=self.folder,engines=None)
 def vote(self):
  session=json.loads((self.folder/'review-session.json').read_text())
  vote={'reviewId':session['reviewId'],'inputSHA256':session['inputSHA256'],'ratings':{field:'A 更好' for field in compare.RATING_FIELDS},'notes':''}
  file=self.folder/'vote.json';file.write_text(json.dumps(vote));self.args.file=file
  return session,vote
 def test_report_keeps_mapping_and_review_identity(self):
  compare.report(self.args);before=(self.folder/'review-session.json').read_bytes()
  compare.report(self.args)
  self.assertEqual(before,(self.folder/'review-session.json').read_bytes())
 def test_score_maps_blind_votes_and_deduplicates(self):
  compare.report(self.args);session,vote=self.vote()
  result=compare.score(self.args)
  self.assertEqual(result['preferences']['overall'][session['mapping']['A']],1)
  self.assertEqual(compare.score(self.args)['reviews'],1)
  self.assertTrue(compare.score(self.args)['duplicate'])
 def test_stale_or_unrated_vote_rejected(self):
  compare.report(self.args);session,vote=self.vote();vote['reviewId']='old'
  self.args.file.write_text(json.dumps(vote))
  with self.assertRaisesRegex(ValueError,'different review'):compare.score(self.args)
  vote['reviewId']=session['reviewId'];vote['ratings']={field:'未评分' for field in compare.RATING_FIELDS};self.args.file.write_text(json.dumps(vote))
  with self.assertRaisesRegex(ValueError,'no ratings'):compare.score(self.args)
 def test_changed_output_rejected_before_report_or_scoring(self):
  compare.report(self.args);self.vote();(self.folder/'spatial.mp4').write_bytes(b'changed')
  with self.assertRaisesRegex(ValueError,'output changed'):compare.report(self.args)
  with self.assertRaisesRegex(ValueError,'output changed'):compare.score(self.args)
