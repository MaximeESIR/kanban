"""Regression coverage for CLI configuration and fail-closed sandbox diagnostics."""
from pathlib import Path
import os
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch

from ticket_executor import ExecutionError, policy, preflight, runtime_binary


class SandboxTests(unittest.TestCase):
    def test_cli_tables_preserve_literal_paths_and_remove_all_mcp_servers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            work=root/'projet.v1 "été"'
            binary=root/'runtime/codex'
            args=policy(work,work/'tmp',root/'depot.git',runtime_binary=binary)
            config=tomllib.loads('\n'.join(args[1::2]))
            self.assertEqual(config['mcp_servers'],{})
            self.assertEqual(config['projects'],{str(work):{'trust_level':'untrusted'}})
            fs=config['permissions']['atelier']['filesystem']
            self.assertEqual(fs[':root'],'deny')
            self.assertEqual(fs[str(work/'.git')],'write')
            self.assertEqual(fs[str(work/'.env')],'deny')
            self.assertEqual(fs[str(root/'depot.git')],'write')
            self.assertEqual(fs[str(Path.home()/'.codex')],'deny')
            self.assertEqual(fs[str(binary.resolve())],'read')
            self.assertEqual(config['shell_environment_policy']['inherit'],'none')
            self.assertIn('/usr/bin',config['shell_environment_policy']['set']['PATH'].split(':'))
            self.assertFalse(config['permissions']['atelier']['network']['enabled'])

    def test_runtime_copy_is_private_identical_and_repairs_changed_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.write_text('#!/bin/sh\nexit 0\n')
            copied=runtime_binary(source,root/'runtime')
            self.assertEqual(copied.read_bytes(),source.read_bytes())
            self.assertEqual(copied.stat().st_mode&0o777,0o500)
            self.assertTrue(os.access(copied,os.X_OK))
            inode=copied.stat().st_ino
            self.assertEqual(runtime_binary(source,root/'runtime').stat().st_ino,inode)
            copied.chmod(0o700);copied.write_text('altered')
            self.assertEqual(runtime_binary(source,root/'runtime').read_bytes(),source.read_bytes())
            source.write_text('#!/bin/sh\nexit 1\n')
            updated=runtime_binary(source,root/'runtime')
            self.assertNotEqual(updated,copied)
            self.assertEqual(updated.read_bytes(),source.read_bytes())

    def test_runtime_cache_refuses_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.write_text('trusted')
            copied=runtime_binary(source,root/'runtime')
            unrelated=root/'unrelated';unrelated.write_text('untouched')
            copied.unlink();copied.symlink_to(unrelated)
            with self.assertRaises(ExecutionError):runtime_binary(source,root/'runtime')
            self.assertEqual(unrelated.read_text(),'untouched')

    def test_runtime_copies_and_verifies_standalone_helpers_without_private_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'codex';source.write_text('cli')
            helper=root/'codex-code-mode-host';helper.write_text('host')
            (root/'codex-exec-server').write_text('executor')
            (root/'auth.json').write_text('private canary')
            copied=runtime_binary(source,root/'runtime')
            self.assertEqual((copied.parent/helper.name).read_text(),'host')
            self.assertEqual((copied.parent/helper.name).stat().st_mode&0o777,0o500)
            self.assertFalse((copied.parent/'auth.json').exists())
            helper.write_text('updated host')
            runtime_binary(source,root/'runtime')
            self.assertEqual((copied.parent/helper.name).read_text(),'updated host')
            (copied.parent/helper.name).unlink()
            (copied.parent/helper.name).symlink_to(root/'auth.json')
            with self.assertRaises(ExecutionError):runtime_binary(source,root/'runtime')

    def test_diagnostic_identifies_invalid_config_without_leaking_raw_output(self):
        result=subprocess.CompletedProcess([],1,'','Error: invalid transport\nprivate-password-example')
        with patch('ticket_executor.subprocess.run',return_value=result):
            with self.assertRaises(ExecutionError) as error:preflight('/usr/bin/false')
        self.assertIn('configuration transmise à Codex est invalide',str(error.exception))
        self.assertNotIn('private-password-example',str(error.exception))
        self.assertNotIn('doctor',str(error.exception))

    def test_probe_requires_success_and_marker_and_distinguishes_security_failure(self):
        for code,output,expected in [(21,'ATELIER_SANDBOX_OK','fichiers privés'),(22,'','réseau'),(0,'','contrôle a échoué')]:
            with self.subTest(code=code):
                result=subprocess.CompletedProcess([],code,output,'')
                with patch('ticket_executor.subprocess.run',return_value=result):
                    with self.assertRaisesRegex(ExecutionError,expected):preflight('/usr/bin/false')

    def test_timeout_does_not_echo_command_or_configuration(self):
        with patch('ticket_executor.subprocess.run',side_effect=subprocess.TimeoutExpired(['private-value'],20)):
            with self.assertRaisesRegex(ExecutionError,'dépasse 20 secondes') as error:preflight('/usr/bin/false')
        self.assertNotIn('private-value',str(error.exception))


if __name__=='__main__':unittest.main()
