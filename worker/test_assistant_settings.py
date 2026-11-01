import base64
import io
import os
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from assistant_settings import AssistantSettings, AssistantConfigurationError, release_ollama_model
from atelier_worker import Runner, execute, capabilities
from groq_provider import GroqError


class AssistantSettingsTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {'ATELIER_GROQ_API_KEY': 'test-private-key'}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.gateway = Mock()
        self.preference = {'provider': 'local', 'revision': 0}
        self.accept_report = True
        def rpc(name, data):
            if name == 'worker_assistant_settings': return dict(self.preference)
            if name == 'worker_assistant_report': return self.accept_report
            return None
        self.gateway.rpc.side_effect = rpc
        self.local = Mock(return_value=['summarize', 'transcribe'])
        self.release = Mock(return_value=True)
        self.clock = Mock(return_value=100.0)
        self.settings = AssistantSettings(self.gateway, self.local, self.release, self.clock)

    def report(self):
        return next(c.args[1] for c in reversed(self.gateway.rpc.call_args_list)
                    if c.args[0] == 'worker_assistant_report')

    def test_default_local_never_loads_or_unloads_a_model(self):
        self.assertTrue(self.settings.refresh())
        self.assertEqual(self.settings.provider, 'local')
        self.assertTrue(self.settings.ready)
        self.local.assert_called_once()
        self.release.assert_not_called()
        self.assertFalse(self.report()['p_local_models_unloaded'])
        self.assertEqual(self.report()['p_capabilities'], ['summarize', 'transcribe'])

    def test_unchanged_preference_is_polled_no_more_than_every_ten_seconds(self):
        self.settings.refresh()
        self.gateway.rpc.reset_mock()
        self.clock.return_value = 109.9
        self.assertFalse(self.settings.refresh())
        self.gateway.rpc.assert_not_called()
        self.clock.return_value = 110.0
        self.settings.refresh()
        self.assertEqual(self.gateway.rpc.call_count, 2)

    def test_explicit_groq_releases_local_models_once_and_does_not_probe_local_capabilities(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.settings.refresh()
        self.assertTrue(self.settings.ready)
        self.assertEqual(self.report()['p_state'], 'ready')
        self.assertTrue(self.report()['p_local_models_unloaded'])
        self.assertTrue(self.report()['p_groq_configured'])
        self.assertEqual(set(self.report()['p_capabilities']), {'summarize', 'rewrite', 'search', 'transcribe'})
        self.clock.return_value += 10
        self.settings.refresh()
        self.release.assert_called_once()
        self.local.assert_not_called()

    def test_groq_without_key_still_releases_models_and_reports_blocked(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        with patch.dict(os.environ, {}, clear=True): self.settings.refresh()
        self.release.assert_called_once()
        self.assertFalse(self.settings.ready)
        self.assertTrue(self.report()['p_local_models_unloaded'])
        self.assertFalse(self.report()['p_groq_configured'])
        self.assertEqual(self.report()['p_state'], 'blocked')
        self.assertIn('Clé Groq', self.report()['p_error'])
        self.assertEqual(self.report()['p_capabilities'], [])

    def test_groq_with_unconfirmed_release_blocks_and_retries_release_later(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.release.side_effect = [AssistantConfigurationError('Déchargement indisponible.'), True]
        self.settings.refresh()
        self.assertFalse(self.settings.ready)
        self.assertFalse(self.report()['p_local_models_unloaded'])
        self.clock.return_value += 10
        self.settings.refresh()
        self.assertTrue(self.settings.ready)

    def test_switch_back_to_local_checks_configuration_without_loading(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.settings.refresh()
        self.preference = {'provider': 'local', 'revision': 2}
        self.settings.refresh(force=True)
        self.assertTrue(self.settings.ready)
        self.assertEqual(self.settings.provider, 'local')
        self.local.assert_called_once()
        self.release.assert_called_once()
        self.assertFalse(self.report()['p_local_models_unloaded'])

    def test_return_local_reports_only_real_capabilities_atomically(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.settings.refresh()
        self.local.return_value = ['transcribe']
        self.preference = {'provider': 'local', 'revision': 2}
        self.settings.refresh(force=True)
        self.assertEqual(self.report()['p_provider'], 'local')
        self.assertEqual(self.report()['p_state'], 'ready')
        self.assertEqual(self.report()['p_capabilities'], ['transcribe'])
        runner = Runner(self.gateway, Mock(), self.settings)
        self.assertEqual(runner.current_capabilities(), ['transcribe'])

    def test_capability_changes_in_same_revision_invalidate_status(self):
        self.settings.refresh()
        self.local.return_value = ['transcribe']
        self.clock.return_value += 10
        self.assertTrue(self.settings.refresh())
        self.assertEqual(self.report()['p_capabilities'], ['transcribe'])

    def test_no_setting_rpc_or_memory_action_while_child_exists(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.assertFalse(self.settings.refresh(busy=True, force=True))
        self.gateway.rpc.assert_not_called()
        self.release.assert_not_called()
        self.assertEqual(self.settings.provider, 'local')

    @patch('atelier_worker.capabilities', return_value=['transcribe'])
    def test_cancelled_child_is_joined_before_groq_memory_confirmation(self, _caps):
        self.settings.refresh()
        runner = Runner(self.gateway, Mock(), self.settings)
        child = Mock()
        child.is_alive.return_value = True
        runner.child = child
        runner.receiver = Mock()
        runner.receiver.poll.return_value = True
        runner.receiver.recv.return_value = ({'text': 'Fin de la dictée annulée'}, None)
        runner.job = {'id': 'cancelled-job', 'lease': 'old-lease'}
        timeline = Mock()
        timeline.attach_mock(child.join, 'join_child')
        timeline.attach_mock(self.release, 'release_model')
        self.preference = {'provider': 'groq', 'revision': 1}
        self.settings.refresh(busy=runner.child is not None, force=True)
        self.release.assert_not_called()
        # worker_finish returns None here: the result was cancelled server-side.
        runner.tick()
        self.assertIsNone(runner.child)
        self.settings.refresh(busy=runner.child is not None, force=True)
        self.assertTrue(self.settings.ready)
        self.assertEqual([call[0] for call in timeline.mock_calls], ['join_child', 'release_model'])

    def test_revision_race_does_not_authorize_a_claim(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.accept_report = False
        self.settings.refresh()
        self.assertFalse(self.settings.ready)
        self.assertEqual(self.settings.state, 'pending')
        runner = Runner(self.gateway, Mock(), self.settings)
        self.gateway.rpc.reset_mock()
        runner.tick()
        self.gateway.rpc.assert_not_called()
        # Refetch immediately, even before the normal ten-second interval.
        self.preference = {'provider': 'local', 'revision': 2}
        self.accept_report = True
        self.settings.refresh()
        self.assertTrue(self.settings.ready)
        self.assertEqual(self.settings.provider, 'local')

    def test_missing_008_uses_only_legacy_local_protocol(self):
        self.gateway.rpc.side_effect = HTTPError('https://test', 404, 'Missing', {}, io.BytesIO())
        self.settings.refresh()
        self.assertFalse(self.settings.supported)
        self.assertTrue(self.settings.ready)
        self.assertEqual(self.settings.provider, 'local')
        self.assertEqual(self.settings.claim_arguments(['search']), {'p_capabilities': ['search']})
        self.release.assert_not_called()

    def test_later_missing_rpc_cannot_fall_back_from_groq(self):
        self.preference = {'provider': 'groq', 'revision': 1}
        self.settings.refresh()
        self.gateway.rpc.side_effect = HTTPError('https://test', 404, 'Missing', {}, io.BytesIO())
        self.settings.refresh(force=True)
        self.assertFalse(self.settings.ready)
        self.assertEqual(self.settings.provider, 'groq')
        self.assertTrue(self.settings.supported)

    def test_unknown_settings_and_transport_errors_fail_closed(self):
        for value in [{'provider': 'other', 'revision': 1}, {'provider': 'groq', 'revision': True}, None]:
            self.gateway.rpc.side_effect = None
            self.gateway.rpc.return_value = value
            self.settings.refresh(force=True)
            self.assertFalse(self.settings.ready)
        self.gateway.rpc.side_effect = RuntimeError('private-token')
        self.settings.refresh(force=True)
        self.assertFalse(self.settings.ready)
        self.assertNotIn('private-token', self.settings.error)
        self.release.assert_not_called()

    def test_local_without_any_capability_is_blocked(self):
        self.local.return_value = []
        self.settings.refresh()
        self.assertFalse(self.settings.ready)
        self.assertEqual(self.report()['p_state'], 'blocked')


class OllamaReleaseTests(unittest.TestCase):
    def test_only_configured_model_is_unloaded_and_absence_is_verified(self):
        other = {'name': 'unrelated-model:latest'}
        request = Mock(side_effect=[{'models': [{'name': 'qwen3.5:4b'}, other]}, {'done': True}, {'models': [other]}])
        self.assertTrue(release_ollama_model(request, 'http://127.0.0.1:11434', 'qwen3.5:4b'))
        self.assertEqual([c.args[0].rsplit('/', 1)[-1] for c in request.call_args_list], ['ps', 'generate', 'ps'])
        self.assertEqual(request.call_args_list[1].args[1], {'model': 'qwen3.5:4b', 'keep_alive': 0, 'stream': False})

    def test_already_unloaded_model_causes_no_generate_or_reload(self):
        request = Mock(return_value={'models': [{'name': 'other:latest'}]})
        self.assertTrue(release_ollama_model(request, 'http://127.0.0.1', 'qwen'))
        self.assertTrue(all(c.args[0].endswith('/api/ps') for c in request.call_args_list))

    def test_latest_alias_is_recognized_without_touching_other_models(self):
        request = Mock(side_effect=[{'models': [{'model': 'qwen:latest'}]}, {}, {'models': []}])
        self.assertTrue(release_ollama_model(request, 'http://127.0.0.1', 'qwen'))
        self.assertEqual(request.call_args_list[1].args[1]['model'], 'qwen')

    def test_still_loaded_or_malformed_or_unreachable_never_claims_success(self):
        for request in [Mock(return_value={'models': [{'name': 'qwen:latest'}]}),
                        Mock(return_value={'models': 'malformed'}), Mock(side_effect=RuntimeError('private-secret'))]:
            with self.assertRaises(AssistantConfigurationError) as error:
                release_ollama_model(request, 'http://127.0.0.1', 'qwen')
            self.assertNotIn('private-secret', str(error.exception))

    def test_no_configured_model_has_no_ollama_side_effect(self):
        request = Mock()
        self.assertTrue(release_ollama_model(request, 'http://127.0.0.1', ''))
        request.assert_not_called()


class ProviderRoutingTests(unittest.TestCase):
    def setUp(self):
        self.pipe = Mock()
        self.job = {'kind': 'summarize', 'input': {'text': 'Bonjour'}}

    @patch('atelier_worker.GroqProvider')
    @patch('atelier_worker.request', return_value={'message': {'content': 'Résumé local'}})
    def test_legacy_job_defaults_local_even_when_cloud_key_exists(self, request, engine):
        with patch.dict(os.environ, {'ATELIER_MODEL': 'qwen', 'ATELIER_GROQ_API_KEY': 'key'}):
            execute(self.job, self.pipe)
        self.pipe.send.assert_called_once_with(({'text': 'Résumé local'}, None))
        engine.assert_not_called()
        self.assertTrue(request.call_args.args[0].endswith('/api/chat'))

    @patch('atelier_worker.GroqProvider')
    @patch('atelier_worker.request')
    def test_groq_summary_never_contacts_or_validates_local_engine(self, request, factory):
        factory.return_value.chat.return_value = 'Résumé distant'
        with patch.dict(os.environ, {'ATELIER_OLLAMA_URL': 'invalid', 'ATELIER_CONTEXT': 'invalid'}):
            execute({**self.job, 'provider': 'groq'}, self.pipe, 'groq')
        self.pipe.send.assert_called_once_with(({'text': 'Résumé distant'}, None))
        request.assert_not_called()
        self.assertFalse(factory.return_value.chat.call_args.kwargs['json_output'])

    @patch('atelier_worker.GroqProvider')
    @patch('atelier_worker.request')
    def test_groq_audio_does_not_import_faster_whisper(self, request, factory):
        factory.return_value.transcribe.return_value = 'Dictée distante'
        job = {'kind': 'transcribe', 'provider': 'groq', 'input': {
            'mime': 'audio/webm', 'audio_base64': base64.b64encode(b'test audio').decode()}}
        with patch.dict('sys.modules', {'faster_whisper': None}):
            execute(job, self.pipe, 'groq')
        self.pipe.send.assert_called_once_with(({'text': 'Dictée distante'}, None))
        request.assert_not_called()
        factory.return_value.transcribe.assert_called_once()

    @patch('atelier_worker.GroqProvider')
    @patch('atelier_worker.request')
    def test_provider_mismatch_cannot_trigger_any_engine(self, request, factory):
        for actual, expected in [('groq', 'local'), ('local', 'groq'), ('unexpected', 'unexpected')]:
            self.pipe.reset_mock()
            execute({**self.job, 'provider': actual}, self.pipe, expected)
            self.assertIn('fournisseur', self.pipe.send.call_args.args[0][1])
        request.assert_not_called()
        factory.assert_not_called()

    @patch('atelier_worker.GroqProvider')
    def test_groq_search_filters_unknown_identifiers_and_requests_json(self, factory):
        factory.return_value.chat.return_value = '{"matches":[{"id":"invented"},{"id":"a","reason":"Jetson"}]}'
        job = {'kind': 'search', 'provider': 'groq', 'input': {'query': 'Jetson', 'documents': [{'id': 'a', 'title': 'Jetson', 'content': 'Déployer'}]}}
        execute(job, self.pipe, 'groq')
        self.assertEqual(self.pipe.send.call_args.args[0][0]['matches'], [{'id': 'a', 'reason': 'Jetson'}])
        self.assertTrue(factory.return_value.chat.call_args.kwargs['json_output'])

    @patch('atelier_worker.GroqProvider')
    def test_safe_groq_error_is_forwarded_and_unexpected_error_is_hidden(self, factory):
        factory.side_effect = GroqError('Quota Groq atteint.')
        execute({**self.job, 'provider': 'groq'}, self.pipe, 'groq')
        self.pipe.send.assert_called_once_with((None, 'Quota Groq atteint.'))
        self.pipe.reset_mock()
        factory.side_effect = RuntimeError('private-key')
        execute({**self.job, 'provider': 'groq'}, self.pipe, 'groq')
        self.assertNotIn('private-key', self.pipe.send.call_args.args[0][1])

    @patch('atelier_worker.request')
    def test_groq_capabilities_never_probe_ollama(self, request):
        with patch.dict(os.environ, {'ATELIER_GROQ_API_KEY': 'key'}):
            self.assertEqual(set(capabilities('groq')), {'summarize', 'rewrite', 'search', 'transcribe'})
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(capabilities('groq'), [])
        request.assert_not_called()

    @patch('atelier_worker.capabilities', side_effect=lambda provider: [provider])
    def test_capabilities_cache_invalidates_when_provider_changes(self, _caps):
        settings = Mock(ready=True, provider='local')
        settings.supported = False
        runner = Runner(Mock(), Mock(), settings)
        self.assertEqual(runner.current_capabilities(), ['local'])
        settings.provider = 'groq'
        settings.capabilities = ['transcribe']
        self.assertEqual(runner.current_capabilities(), ['groq'])
        settings.ready = False
        self.assertEqual(runner.current_capabilities(), [])

    @patch('atelier_worker.capabilities', return_value=['transcribe'])
    def test_runner_passes_acknowledged_provider_to_rpc_and_child(self, _caps):
        gateway = Mock()
        gateway.rpc.return_value = {'kind': 'transcribe', 'id': 'job', 'provider': 'groq'}
        settings = AssistantSettings(gateway, Mock(), Mock())
        settings.ready = True
        settings.supported = True
        settings.provider = 'groq'
        settings.capabilities = ['transcribe']
        ctx = Mock()
        receiver, sender = Mock(), Mock()
        ctx.Pipe.return_value = (receiver, sender)
        runner = Runner(gateway, ctx, settings)
        runner.tick()
        gateway.rpc.assert_called_once_with('worker_poll', {'p_capabilities': ['transcribe'], 'p_provider': 'groq'})
        self.assertEqual(ctx.Process.call_args.kwargs['args'][2], 'groq')


if __name__ == '__main__':
    unittest.main()
