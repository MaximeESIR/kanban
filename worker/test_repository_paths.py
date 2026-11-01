import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock,patch
from repository_paths import check_path,register_path,RepositoryRequests
from ticket_executor import ExecutionError,read_registry

class RepositoryPathTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.repo=self.root/'Projet avec espaces';self.repo.mkdir()
        subprocess.run(['git','init','-q',str(self.repo)],check=True)
        (self.repo/'a.txt').write_text('original')
        subprocess.run(['git','-C',str(self.repo),'add','.'],check=True)
        subprocess.run(['git','-C',str(self.repo),'-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','Initial'],check=True)
        self.config=self.root/'registry.json'
        self.job={'worker_id':'10000000-0000-4000-8000-000000000001','requested_path':str(self.repo),'label':'Projet'}
    def tearDown(self):self.temp.cleanup()
    def test_existing_path_is_exact_private_idempotent_and_source_is_untouched(self):
        before={str(p.relative_to(self.repo)):p.read_bytes() for p in self.repo.rglob('*') if p.is_file()}
        row=register_path(self.job,self.config,existing=[])
        self.assertEqual(row['path'],str(self.repo));self.assertFalse(row['initialize'])
        self.assertEqual(register_path(self.job,self.config,existing=[]),row)
        self.assertEqual(self.config.stat().st_mode&0o777,0o600)
        self.assertEqual(len(read_registry(self.config)),1)
        self.assertEqual(before,{str(p.relative_to(self.repo)):p.read_bytes() for p in self.repo.rglob('*') if p.is_file()})
    def test_new_folder_requires_explicit_choice_and_never_initializes_git_or_copies(self):
        new=self.root/'Chanson';job={**self.job,'requested_path':str(new)}
        with self.assertRaisesRegex(ExecutionError,'existe pas'):register_path(job,self.config,existing=[])
        self.assertFalse(new.exists())
        row=register_path({**job,'create_if_missing':True},self.config,existing=[])
        self.assertEqual(row['path'],str(new));self.assertTrue(row['initialize']);self.assertEqual(list(new.iterdir()),[])
    def test_refuses_private_traversal_symlinks_nonempty_creation_and_non_git(self):
        linked=self.root/'linked';linked.symlink_to(self.repo,target_is_directory=True)
        for path in ['relative',str(Path.home()),str(Path.home()/'.ssh'),str(Path.home()/'.config/atelier'),str(linked),str(self.repo/'..'/'other'),str(self.root/'bad\npath')]:
            with self.subTest(path=path),self.assertRaises(ExecutionError):check_path(path)
        plain=self.root/'plain';plain.mkdir();(plain/'secret.txt').write_text('untouched')
        with self.assertRaises(ExecutionError):check_path(str(plain))
        with self.assertRaises(ExecutionError):check_path(str(plain),True)
        self.assertEqual((plain/'secret.txt').read_text(),'untouched')
    def test_target_is_never_executed_as_a_shell_command(self):
        strange=self.root/'x;touch PWN';strange.mkdir()
        self.assertEqual(check_path(str(strange),True),(strange,True))
        self.assertFalse((self.root/'PWN').exists())
    def test_pending_validation_schedules_recovery_without_busy_polling(self):
        gateway=Mock();gateway.rpc.return_value={'retry_after':65}
        receiver=RepositoryRequests(gateway)
        self.assertFalse(receiver.tick([],True));self.assertFalse(receiver.due())
        receiver.retry_at-=66;self.assertTrue(receiver.due())

if __name__=='__main__':unittest.main()
