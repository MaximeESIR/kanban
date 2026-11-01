import base64
import unittest
from unittest.mock import Mock, patch
from pathlib import Path
from atelier_worker import process_job, local_url, Runner, poll_seconds
class WorkerTests(unittest.TestCase):
 def test_no_execution(self):
  for kind in ['exec','shell','code','fetch']:
   with self.assertRaises(ValueError):process_job({'kind':kind,'input':{'command':'echo bad'}},None,None)
 def test_summary(self):
  result=process_job({'kind':'summarize','input':{'text':'Bonjour','prompt':'Court'}},lambda s,u:'Résumé',None)
  self.assertEqual(result,{'text':'Résumé'})
 def test_search_filters_invented_sources(self):
  result=process_job({'kind':'search','input':{'query':'jetson','documents':[{'id':'a','title':'Jetson','content':'déployer'}]}},lambda s,u:'{"matches":[{"id":"bad"},{"id":"a","reason":"Déploiement"},{"id":"a"}]}',None)
  self.assertEqual(result['matches'],[{'id':'a','reason':'Déploiement'}])
 def test_audio_cleanup(self):
  paths=[]
  def transcribe(path):paths.append(path);self.assertEqual(Path(path).read_bytes(),b'test');return 'Bonjour'
  self.assertEqual(process_job({'kind':'transcribe','input':{'mime':'audio/webm;codecs=opus','audio_base64':base64.b64encode(b'test').decode()}},None,transcribe),{'text':'Bonjour'})
  self.assertFalse(Path(paths[0]).exists())
 def test_rejects_invalid_audio(self):
  with self.assertRaises(ValueError):process_job({'kind':'transcribe','input':{'mime':'text/html','audio_base64':'!!!!'}},None,None)
 def test_local_only(self):
  for url in ['http://evil.test','https://localhost','http://localhost@evil.test','http://127.0.0.1?x=1']:
   with self.assertRaises(ValueError):local_url(url)
  self.assertEqual(local_url('http://127.0.0.1:11434/'),'http://127.0.0.1:11434')
 def runner(self):
  gateway=Mock();gateway.rpc.return_value={'id':'job-1','lease':'lease-1','kind':'transcribe'}
  receiver=Mock();receiver.poll.return_value=False
  child=Mock();child.is_alive.return_value=True
  ctx=Mock();ctx.Pipe.return_value=(receiver,Mock());ctx.Process.return_value=child
  return Runner(gateway,ctx),gateway,receiver,child
 @patch('atelier_worker.capabilities',return_value=['transcribe'])
 def test_busy_worker_does_not_claim_a_new_job_after_server_cancellation(self,_caps):
  runner,gateway,receiver,child=self.runner()
  runner.tick(); runner.last_heartbeat-=11
  runner.tick()
  self.assertEqual([c.args[0] for c in gateway.rpc.call_args_list],['worker_poll','worker_heartbeat'])
  receiver.poll.return_value=True;receiver.recv.return_value=({'text':'Bonjour'},None)
  gateway.rpc.return_value=False
  runner.tick()
  self.assertIsNone(runner.child)
  child.terminate.assert_called_once()
 @patch('atelier_worker.capabilities',return_value=['transcribe'])
 def test_delivery_retries_preserve_completed_transcription_without_running_twice(self,_caps):
  runner,gateway,receiver,child=self.runner();runner.tick()
  receiver.poll.return_value=True;receiver.recv.return_value=({'text':'Bonjour'},None)
  gateway.rpc.side_effect=[OSError('Temporary outage'),True]
  with self.assertRaises(OSError):runner.tick()
  runner.tick()
  finishes=[c for c in gateway.rpc.call_args_list if c.args[0]=='worker_finish']
  self.assertEqual(len(finishes),2)
  self.assertEqual(finishes[0].args,finishes[1].args)
  receiver.recv.assert_called_once()
 def test_polling_interval_is_bounded(self):
  with patch.dict('os.environ',{'ATELIER_POLL_SECONDS':'2'}):self.assertEqual(poll_seconds(),2)
  for value in ['0','100','nan']:
   with patch.dict('os.environ',{'ATELIER_POLL_SECONDS':value}):
    with self.assertRaises(ValueError):poll_seconds()
 @patch('atelier_worker.capabilities',return_value=['transcribe'])
 def test_crashed_engine_reports_failure_instead_of_retrying_a_closed_pipe(self,_caps):
  runner,gateway,receiver,child=self.runner();runner.tick()
  receiver.poll.return_value=True;receiver.recv.side_effect=EOFError
  gateway.rpc.return_value=True;runner.tick()
  self.assertIsNone(runner.child)
  self.assertIn('interrompu',gateway.rpc.call_args.args[1]['p_error'])
if __name__=='__main__':unittest.main()
