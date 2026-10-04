import unittest
import sys
from pathlib import Path
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'enhancement'))
from pairing import parse_pair_url, grant_pairing, connect_origin, trusted_origins, approve_pairing

class PairingTests(unittest.TestCase):
    def test_valid_url_and_rejects_injection_or_duplicate_parameters(self):
        url='wescreen-helper://pair?origin=chrome-extension%3A%2F%2F'+'a'*32+'&challenge='+'b'*64
        self.assertEqual(parse_pair_url(url),('chrome-extension://'+'a'*32,'b'*64))
        for bad in (url+'&challenge='+'c'*64,url+'#anything',url.replace('pair?','pair/unsafe?'),url.replace('wescreen-helper','https'),url.replace('a'*32,'$(touch /tmp/bad)')):
            with self.assertRaises(ValueError): parse_pair_url(bad)
    def test_expiry_and_untrusted_origin_do_not_replace_existing_pairing(self):
        with tempfile.TemporaryDirectory() as directory:
            pair=Path(directory)/'extension-origin.txt';a='chrome-extension://'+'a'*32;b='chrome-extension://'+'b'*32
            self.assertTrue(connect_origin(pair,a));grant_pairing(pair,b,'c'*64)
            self.assertFalse(connect_origin(pair,b,'d'*64))
            with patch('pairing.time.time',return_value=10**12):self.assertFalse(connect_origin(pair,b,'c'*64))
            self.assertEqual(trusted_origins(pair),{a});self.assertTrue(connect_origin(pair,b,'c'*64));self.assertEqual(trusted_origins(pair),{a,b})
            self.assertEqual((pair.with_name('trusted-origins.json').stat().st_mode&0o777),0o600)

    def test_native_approval_survives_restart_and_expired_challenge(self):
        with tempfile.TemporaryDirectory() as directory:
            pair=Path(directory)/'extension-origin.txt';a='chrome-extension://'+'a'*32;b='chrome-extension://'+'b'*32
            self.assertTrue(connect_origin(pair,a))
            approve_pairing(pair,b,'c'*64)
            with patch('pairing.time.time',return_value=10**12):
                self.assertTrue(connect_origin(pair,b))
            self.assertEqual(trusted_origins(pair),{a,b})
