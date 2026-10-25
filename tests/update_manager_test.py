import hashlib,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]/'enhancement';sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('update_manager',ROOT/'update-manager.py');manager=importlib.util.module_from_spec(spec);spec.loader.exec_module(manager)

class UpdateManagerTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.old=self.root/'installed';self.new=self.root/'package'
  for folder,value in [(self.old,1),(self.new,2)]:
   (folder/'models').mkdir(parents=True);(folder/'models/FSRCNN_x2.pb').write_bytes(b'model');(folder/'server.py').write_text("MODEL_HASH = '"+hashlib.sha256(b'model').hexdigest()+"'\nVALUE="+str(value)+'\n')
   (folder/'installation.py').write_text('PROTOCOL_VERSION=2\n');(folder/'start.sh').write_text('#!/bin/bash\n');(folder/'requirements.txt').write_text('')
  (self.old/'.runtime').mkdir();(self.old/'.runtime/user-model.bin').write_bytes(b'preserved-model');(self.old/'.runtime/token.txt').write_text('preserved-token')
  self.guard=patch.object(manager,'idle_guard');self.guard.start()
 def tearDown(self):self.guard.stop();self.temp.cleanup()
 def test_install_and_rollback_preserve_runtime(self):
  result=manager.install(self.new,self.old);self.assertEqual(result['state'],'installed');self.assertIn('VALUE=2',(self.old/'server.py').read_text())
  manager.rollback(self.old,result['receipt']);self.assertIn('VALUE=1',(self.old/'server.py').read_text());self.assertEqual((self.old/'.runtime/token.txt').read_text(),'preserved-token');self.assertEqual((self.old/'.runtime/user-model.bin').read_bytes(),b'preserved-model')
 def test_corrupt_package_never_changes_installed_code(self):
  (self.new/'models/FSRCNN_x2.pb').write_bytes(b'corrupt')
  with self.assertRaisesRegex(ValueError,'checksum'):manager.install(self.new,self.old)
  self.assertIn('VALUE=1',(self.old/'server.py').read_text())
 def test_mid_update_failure_rolls_back(self):
  original=manager.os.replace;failed=False
  def replace(source,target):
   nonlocal failed
   if Path(target).name=='server.py' and not failed:failed=True;raise OSError('Injected write failure')
   return original(source,target)
  with patch.object(manager.os,'replace',side_effect=replace),self.assertRaises(OSError):manager.install(self.new,self.old)
  self.assertIn('VALUE=1',(self.old/'server.py').read_text());self.assertTrue((self.old/'.runtime/user-model.bin').exists())
 def test_source_symlink_is_rejected(self):
  (self.new/'redirect.py').symlink_to(self.old/'server.py')
  with self.assertRaisesRegex(ValueError,'symbolic'):manager.install(self.new,self.old)
 def test_busy_guard_runs_before_same_directory_install(self):
  with patch.object(manager,'idle_guard',side_effect=RuntimeError('busy')),self.assertRaisesRegex(RuntimeError,'busy'):manager.install(self.old,self.old)

 def test_unchanged_install_releases_maintenance(self):
  with patch.object(manager,'release_maintenance') as release:
   result=manager.install(self.old,self.old)
  self.assertEqual(result['state'],'unchanged');release.assert_called_once_with(self.old)
 def test_staging_failure_releases_maintenance(self):
  with patch.object(manager.shutil,'copy2',side_effect=OSError('stage failure')),patch.object(manager,'release_maintenance') as release:
   with self.assertRaises(OSError):manager.install(self.new,self.old)
  release.assert_called_once_with(self.old)
 def test_busy_refusal_does_not_release_another_lease(self):
  with patch.object(manager,'idle_guard',side_effect=RuntimeError('busy')),patch.object(manager,'release_maintenance') as release:
   with self.assertRaises(RuntimeError):manager.install(self.new,self.old)
  release.assert_not_called()
