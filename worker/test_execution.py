import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from ticket_executor import TicketExecutor, ProcessLock, ExecutionError, add_repository, read_registry, clean_env, policy, private_json
from realtime_events import RealtimeEvents

class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.repo=self.root/'repo with spaces';self.repo.mkdir()
        subprocess.run(['git','init','-q',str(self.repo)],check=True)
        (self.repo/'hello.py').write_text('answer = 1\n')
        subprocess.run(['git','-C',str(self.repo),'add','.'],check=True)
        subprocess.run(['git','-C',str(self.repo),'-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','Initial'],check=True)
        self.registry=self.root/'repositories.json';self.row=add_repository(str(self.repo),'Test',self.registry)
        self.gateway=Mock();self.gateway.rpc.return_value=True
        self.runner=TicketExecutor(self.gateway,self.registry,self.root/'runs')
        self.binary=self.root/'fake-codex'
        self.binary.write_text('''#!/usr/bin/python3
import json,sys,pathlib
args=sys.argv
work=pathlib.Path(args[args.index('-C')+1]);report=pathlib.Path(args[args.index('--output-last-message')+1])
prompt=sys.stdin.read()
assert 'Aucun résultat' not in prompt
(work/'hello.py').write_text('answer = 42\\n')
exec((work/'hello.py').read_text());assert answer==42
report.write_text(json.dumps({'summary':'Valeur corrigée','tests':['assert answer == 42 : OK'],'limitations':[]}))
print(json.dumps({'type':'turn.completed'}))
''');self.binary.chmod(0o700)
        self.job={'id':'10000000-0000-4000-8000-000000000001','repository_id':self.row['id'],'lease':'lease','ticket_snapshot':{'title':'Corriger la valeur'},'project_name':'Test'}
    def tearDown(self):self.runner.close();self.temp.cleanup()
    def start(self):
        with patch('ticket_executor.codex_binary',return_value=str(self.binary)),patch('ticket_executor.preflight',return_value=True):self.runner.start(self.job)
    def test_real_git_worktree_process_and_report_delivery_preserve_original(self):
        self.start()
        self.runner.process.wait(timeout=10)
        self.assertEqual((self.repo/'hello.py').read_text(),'answer = 1\n')
        folder=self.runner.folder
        self.assertEqual((folder/'worktree/hello.py').read_text(),'answer = 42\n')
        self.assertTrue(self.runner.tick())
        name,data=self.gateway.rpc.call_args.args
        self.assertEqual(name,'worker_development_finish');self.assertIsNone(data['p_error'])
        self.assertEqual(data['p_result']['summary'],'Valeur corrigée')
        self.assertTrue((folder/'delivery.json').exists())
        self.assertFalse(any(k in data for k in ('status','ticket_status')))
        with self.assertRaises(FileExistsError):self.start()
    def test_git_checkout_filters_never_run_outside_the_sandbox(self):
        canary=self.root/'filter-executed'
        (self.repo/'.gitattributes').write_text('hello.py filter=malicious\n')
        subprocess.run(['git','-C',str(self.repo),'add','.gitattributes'],check=True)
        subprocess.run(['git','-C',str(self.repo),'-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','Attribute'],check=True)
        subprocess.run(['git','-C',str(self.repo),'config','filter.malicious.smudge','touch '+str(canary)+'; cat'],check=True)
        subprocess.run(['git','-C',str(self.repo),'config','filter.malicious.required','true'],check=True)
        self.start();self.runner.process.wait(timeout=10)
        self.assertFalse(canary.exists())
    def test_watchdog_stops_process_even_if_service_loop_never_calls_tick(self):
        self.binary.write_text('#!/usr/bin/python3\nimport sys,time\nsys.stdin.read()\ntime.sleep(120)\n')
        self.start();proc=self.runner.process;self.runner.last_contact-=61
        proc.wait(timeout=6)
        self.assertTrue(self.runner.watchdog_tripped)
        self.assertEqual([c.args[0] for c in self.gateway.rpc.call_args_list],['worker_development_pulse'])
    def test_cancellation_during_preparation_prevents_codex_start(self):
        self.gateway.rpc.return_value=False
        with self.assertRaises(ExecutionError):self.start()
        self.assertIsNone(self.runner.process)
        self.assertEqual((self.runner.folder/'worktree/hello.py').read_text(),'answer = 1\n')
    def test_denies_unknown_repo_and_path_override_in_job(self):
        self.job['repository_id']='different';self.job['path']=str(self.repo)
        with self.assertRaises(ExecutionError):self.start()
        self.assertFalse((self.root/'runs'/self.job['id']).exists())
    def test_refuses_to_launch_without_sandbox(self):
        with patch('ticket_executor.codex_binary',return_value=str(self.binary)),patch('ticket_executor.preflight',side_effect=ExecutionError('denied')):
            with self.assertRaises(ExecutionError):self.runner.start(self.job)
        self.assertIsNone(self.runner.process)
    def test_one_session_per_pc_even_across_executor_instances(self):
        first=ProcessLock(self.root/'global.lock')
        try:
            with self.assertRaises(ExecutionError):ProcessLock(self.root/'global.lock')
        finally:first.close()
    def test_registry_requires_exact_git_root_and_private_permissions(self):
        self.assertEqual(add_repository(str(self.repo),'Again',self.registry),self.row)
        sub=self.repo/'sub';sub.mkdir()
        with self.assertRaises(ExecutionError):add_repository(str(sub),'Bad',self.registry)
        self.registry.chmod(0o644)
        with self.assertRaises(ExecutionError):read_registry(self.registry)
    def test_no_service_secrets_in_child_env_or_network_access_policy(self):
        with patch.dict(os.environ,{'ATELIER_WORKER_PASSWORD':'secret','OPENAI_API_KEY':'secret','SSH_AUTH_SOCK':'secret'}):
            env=clean_env()
        self.assertNotIn('ATELIER_WORKER_PASSWORD',env);self.assertNotIn('OPENAI_API_KEY',env);self.assertNotIn('SSH_AUTH_SOCK',env)
        flags=policy(self.repo,self.root/'scratch')
        self.assertIn('permissions.atelier.network.enabled=false',flags)
        self.assertIn('permissions.atelier.filesystem.":root"="deny"',flags)
        self.assertNotIn('--sandbox',flags)
    def test_cancellation_stops_session_and_never_delivers_result(self):
        self.start();self.gateway.rpc.return_value=False;self.runner.last_pulse-=11
        self.assertTrue(self.runner.tick());self.assertIsNone(self.runner.process)
        self.assertEqual(self.gateway.rpc.call_args.args[0],'worker_development_pulse')
    def test_disconnection_stops_session_without_relaunch(self):
        self.start();self.runner.last_contact-=61
        with self.assertRaises(ExecutionError):self.runner.tick()
        self.assertIsNone(self.runner.process)
    def test_failed_delivery_retries_the_same_report_without_new_session(self):
        self.start();self.runner.process.wait(timeout=10)
        self.gateway.rpc.side_effect=[OSError('offline'),True]
        with self.assertRaises(OSError):self.runner.tick()
        first=self.gateway.rpc.call_args
        self.runner.tick();self.assertEqual(self.gateway.rpc.call_args,first)
    def test_realtime_join_requires_actual_subscription_and_reconnect_drains(self):
        wake=threading.Event();events=RealtimeEvents(Mock(),wake)
        self.assertNotIn('password',json.dumps(events.join('TOKEN')))
        with self.assertRaises(ConnectionError):events.receive({'event':'phx_reply','ref':'1','payload':{'status':'ok','response':{}}})
        events.receive({'event':'phx_reply','ref':'1','payload':{'status':'ok','response':{'postgres_changes':[{'id':1}]}}})
        self.assertTrue(wake.is_set());wake.clear()
        events.receive({'event':'postgres_changes','payload':{}});self.assertTrue(wake.is_set())
        with self.assertRaises(ConnectionError):events.receive({'event':'system','payload':{'status':'error'}})

if __name__=='__main__':unittest.main()
