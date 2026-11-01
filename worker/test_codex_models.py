import json
import unittest
from unittest.mock import Mock, patch
from codex_models import ModelCatalog, normalize_catalog

class ModelTests(unittest.TestCase):
    def test_catalog_keeps_only_supported_single_agent_choices(self):
        model={'slug':'gpt-test','display_name':'Test','visibility':'list','default_reasoning_level':'high',
               'supported_reasoning_levels':[{'effort':e} for e in ('low','high','ultra')]}
        result=normalize_catalog({'models':[model,model,{**model,'slug':'hidden','visibility':'hide'},
            {**model,'slug':'--unsafe'},{**model,'slug':'other','default_reasoning_level':'ultra'}]})
        self.assertEqual(result,[{'id':'gpt-test','label':'Test','efforts':['low','high'],'default_effort':'high'},
            {'id':'other','label':'Test','efforts':['low','high'],'default_effort':'low'}])

    def test_catalog_is_cached_and_failure_never_selects_another_model(self):
        catalog=ModelCatalog()
        with patch('codex_models.subprocess.run',return_value=Mock(returncode=0,stdout=json.dumps({'models':[]}))) as command:
            self.assertEqual(catalog.get('/codex',{}),[])
            catalog.get('/codex',{})
            self.assertEqual(command.call_count,1)
            catalog.checked-=301
            command.side_effect=OSError('private error must not be printed')
            self.assertEqual(catalog.get('/codex',{}),[])

if __name__=='__main__':unittest.main()
