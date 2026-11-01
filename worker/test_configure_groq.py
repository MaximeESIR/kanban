import os
from pathlib import Path
import tempfile
import unittest
from configure_groq import save_key

class ConfigureGroqTests(unittest.TestCase):
    def test_preserves_other_credentials_replaces_key_once_and_keeps_file_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'worker.env'
            path.write_text('ATELIER_WORKER_PASSWORD=private-test\n# preserved comment\nATELIER_GROQ_API_KEY=old\n ATELIER_GROQ_API_KEY=duplicate\n');path.chmod(0o600)
            key='gsk_'+'testonly_'*4
            save_key(key,path)
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertIn('ATELIER_WORKER_PASSWORD=private-test\n# preserved comment\n',path.read_text())
            self.assertEqual(path.read_text().count('ATELIER_GROQ_API_KEY='),1)
            self.assertTrue(path.read_text().endswith(key+'\n'))
    def test_rejects_injection_public_permissions_and_symlink_without_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'worker.env';original='UNCHANGED=1\n';path.write_text(original);path.chmod(0o600)
            for key in ['gsk_abc\nOTHER=secret','gsk_$(whoami)','not-a-key','gsk_']:
                with self.assertRaises(ValueError):save_key(key,path)
                self.assertEqual(path.read_text(),original)
            key='gsk_'+'x'*20
            path.chmod(0o644)
            with self.assertRaises(ValueError):save_key(key,path)
            path.chmod(0o600);link=Path(folder)/'link';link.symlink_to(path)
            with self.assertRaises(ValueError):save_key(key,link)
            self.assertEqual(path.read_text(),original)

if __name__=='__main__':unittest.main()
