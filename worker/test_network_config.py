import tempfile
import unittest
import json
from pathlib import Path
from network_config import save_network_config

class NetworkConfigTests(unittest.TestCase):
    def test_only_proxy_settings_are_saved_privately_with_loopback_bypass(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'network.env'
            save_network_config(path,{'HTTPS_PROXY':'http://name:password@proxy.test:3128','no_proxy':'internal.test','PRIVATE_SECRET':'never'})
            values={k:json.loads(v) for k,v in (line.split('=',1) for line in path.read_text().splitlines())}
            self.assertEqual(values['HTTPS_PROXY'],'http://name:password@proxy.test:3128')
            self.assertNotIn('PRIVATE_SECRET',values)
            self.assertIn('localhost',values['no_proxy'])
            self.assertIn('127.0.0.1',values['NO_PROXY'])
            self.assertEqual(path.stat().st_mode&0o777,0o600)
    def test_missing_environment_keeps_previous_settings_and_injection_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'network.env'
            save_network_config(path,{'https_proxy':'http://proxy.test:3128'})
            previous=path.read_bytes()
            self.assertFalse(save_network_config(path,{}))
            with self.assertRaises(ValueError):save_network_config(path,{'https_proxy':'http://proxy\nEVIL=1'})
            self.assertEqual(previous,path.read_bytes())
    def test_symlink_destination_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            target=Path(root)/'target';target.write_text('keep')
            path=Path(root)/'network.env';path.symlink_to(target)
            with self.assertRaises(ValueError):save_network_config(path,{'https_proxy':'http://proxy.test'})
            self.assertEqual(target.read_text(),'keep')

    def test_connection_confirmation_requires_current_process_and_recent_heartbeat(self):
        from connection_status import fresh
        self.assertTrue(fresh({'pid':42,'connected_at':100},42,101))
        self.assertFalse(fresh({'pid':41,'connected_at':100},42,101))
        self.assertFalse(fresh({'pid':42,'connected_at':100},42,140))
        self.assertFalse(fresh({'pid':42,'connected_at':110},42,100))
        self.assertFalse(fresh({},42,100))
