import base64
import unittest
from pathlib import Path
from atelier_worker import process_job, local_url
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
if __name__=='__main__':unittest.main()
