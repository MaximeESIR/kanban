import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


setup = load('atelier_setup', ROOT / 'setup.py')
installer = load('atelier_install', ROOT / 'install_clients.py')
VALUE = {'supabase_url': 'https://exampletest.supabase.co', 'publishable_key': 'sb_publishable_PUBLIC_TEST_KEY',
         'agent_email': 'agent@example.com', 'agent_password': 'PRIVATE_PASSWORD'}


class SetupTests(unittest.TestCase):
    def test_creation_private_and_replacement_requires_explicit_option_and_keeps_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'private/mcp.json'
            setup.save_config(VALUE, path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), VALUE)
            with self.assertRaises(ValueError): setup.save_config(VALUE, path)
            backup = setup.save_config({**VALUE, 'agent_password': 'NEW_PASSWORD'}, path, replace=True)
            self.assertEqual(json.loads(backup.read_text()), VALUE)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)

    def test_symlinks_public_secret_keys_and_shared_files_are_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'mcp.json'
            with self.assertRaises(ValueError): setup.save_config({**VALUE, 'publishable_key': 'sb_secret_BAD'}, path)
            original = Path(folder) / 'untouched'; original.write_text('untouched')
            path.symlink_to(original)
            with self.assertRaises(ValueError): setup.save_config(VALUE, path, replace=True)
            self.assertEqual(original.read_text(), 'untouched')
            path.unlink(); setup.save_config(VALUE, path); path.chmod(0o644)
            with self.assertRaises(ValueError): setup.save_config(VALUE, path, replace=True)


class ClientInstallTests(unittest.TestCase):
    def test_existing_foreign_entry_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            home = Path(folder)
            path = home / '.claude.json'
            before = json.dumps({'mcpServers': {'atelier': {'command': 'unrelated', 'args': []}}})
            path.write_text(before)
            run = Mock()
            with self.assertRaises(ValueError): installer.install('claude', home=home, run=run)
            run.assert_not_called(); self.assertEqual(path.read_text(), before)

    def test_existing_matching_entry_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            home = Path(folder); (home / '.codex').mkdir()
            launcher = str(ROOT / 'launch.sh')
            (home / '.codex/config.toml').write_text('[mcp_servers.atelier]\ncommand="/bin/bash"\nargs=[' + json.dumps(launcher) + ']\n')
            run = Mock()
            self.assertIn('déjà configuré', installer.install('codex', home=home, run=run))
            run.assert_not_called()

    def test_cli_install_creates_private_backup_and_has_no_credentials_in_argv(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True), patch.object(installer.shutil, 'which', return_value='/usr/bin/claude'):
            home = Path(folder); path = home / '.claude.json'
            before = '{"unrelated_private_setting":"PRIVATE_VALUE"}'
            path.write_text(before)
            run = Mock(return_value=types.SimpleNamespace(returncode=0))
            self.assertIn('ajouté', installer.install('claude', home=home, run=run))
            backups = list((home / '.config/atelier/client-backups').glob('claude-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), before)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            self.assertNotIn('PRIVATE_VALUE', str(run.call_args))
            self.assertEqual(run.call_args.args[0][:4], ['claude', 'mcp', 'add', '--scope'])

    def test_dry_run_does_not_write_or_execute_and_dangling_symlink_is_refused(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            home = Path(folder); run = Mock()
            self.assertIn('vibe mcp add', installer.install('vibe', home=home, dry_run=True, run=run))
            self.assertEqual(list(home.iterdir()), [])
            path = home / '.claude.json'; path.symlink_to(home / 'nonexistent')
            with self.assertRaises(ValueError): installer.install('claude', home=home, dry_run=True, run=run)
            run.assert_not_called()


if __name__ == '__main__': unittest.main()
