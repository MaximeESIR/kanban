"""Offline contract tests: every HTTP request is intercepted; no real API key."""
import io
import json
import os
from email import policy
from email.parser import BytesParser
from pathlib import Path
import tempfile
import traceback
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import groq_provider as groq


SECRET = 'gsk_test_secret_never_use_a_real_key'
PRIVATE_TEXT = 'Texte privé à ne pas exposer dans une erreur'


def completion(text='Voici le résumé.', finish='stop'):
    return {'choices': [{'finish_reason': finish, 'message': {'content': text}}]}


class GroqProviderTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'ATELIER_GROQ_API_KEY': SECRET}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.transport = patch.object(groq, 'OPENER')
        self.opener = self.transport.start()
        self.addCleanup(self.transport.stop)
        self.response = Mock()
        self.response.getcode.return_value = 200
        self.response.read.return_value = json.dumps(completion()).encode()
        self.opener.open.return_value.__enter__.return_value = self.response
        self.engine = groq.GroqProvider()
        # A test that accidentally escapes the mocked transport cannot use a network.
        self.network = patch('socket.socket.connect', side_effect=AssertionError('Network forbidden in unit tests'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def request(self):
        self.opener.open.assert_called_once()
        return self.opener.open.call_args.args[0]

    def public_error(self, operation):
        with self.assertRaises(groq.GroqError) as caught:
            operation()
        rendered = ''.join(traceback.format_exception(caught.exception))
        self.assertNotIn(SECRET, rendered)
        self.assertNotIn(PRIVATE_TEXT, rendered)
        return str(caught.exception)

    def test_chat_sends_authenticated_fixed_https_request_and_bounded_reasoning(self):
        self.assertEqual(self.engine.chat('Réponds en français.', PRIVATE_TEXT), 'Voici le résumé.')
        request = self.request()
        self.assertEqual(request.full_url, 'https://api.groq.com/openai/v1/chat/completions')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + SECRET)
        self.assertEqual(self.opener.open.call_args.kwargs['timeout'], 90)
        payload = json.loads(request.data)
        self.assertEqual(payload['model'], 'openai/gpt-oss-20b')
        self.assertEqual(payload['reasoning_effort'], 'low')
        self.assertEqual(payload['max_completion_tokens'], 2048)
        self.assertFalse(payload['include_reasoning'])
        self.assertNotIn('tools', payload)
        self.assertNotIn('response_format', payload)
        self.assertEqual(payload['messages'][1]['content'], PRIVATE_TEXT)
        self.response.read.assert_called_once_with(groq.MAX_RESPONSE_BYTES + 1)

    def test_search_requests_json_mode(self):
        self.response.read.return_value = json.dumps(completion('{"matches":[]}')).encode()
        self.assertEqual(self.engine.chat('Réponds en JSON.', 'Question', json_output=True), '{"matches":[]}')
        self.assertEqual(json.loads(self.request().data)['response_format'], {'type': 'json_object'})

    def test_missing_or_header_unsafe_key_never_sends_request(self):
        for key in ('', '   ', 'key\r\nInjected: true', 'é', 'x' * 513):
            with self.subTest(key=repr(key)), patch.dict(os.environ, {'ATELIER_GROQ_API_KEY': key}):
                self.assertFalse(groq.is_configured())
                self.assertIn('Clé Groq', self.public_error(groq.GroqProvider))
        self.opener.open.assert_not_called()

    def test_configured_check_does_not_contact_groq(self):
        self.assertTrue(groq.is_configured())
        self.opener.open.assert_not_called()

    def test_unknown_route_cannot_redirect_credentials(self):
        self.public_error(lambda: self.engine._post('https://evil.example/', b'', 'text/plain'))
        self.opener.open.assert_not_called()

    def test_redirect_handler_refuses_other_host(self):
        self.public_error(lambda: groq.NoRedirect().redirect_request(None, None, 302, 'Redirect', {}, 'https://evil.example/'))
        self.opener.open.assert_not_called()

    def test_input_byte_limit_counts_accents_and_system_instructions(self):
        self.assertIn('trop long', self.public_error(lambda: self.engine.chat('s', 'é' * 2750)))
        self.assertIn('trop long', self.public_error(lambda: self.engine.chat('s' * 5500, 'u')))
        self.opener.open.assert_not_called()

    def test_input_at_limit_is_not_truncated(self):
        content = 'é' * 2749
        self.engine.chat('ss', content)
        self.assertEqual(json.loads(self.request().data)['messages'][1]['content'], content)

    def test_empty_or_invalid_text_never_contacts_api(self):
        for system, user in [('s', ''), ('s', '  '), (None, 'u'), ('s', []), ('s', '\ud800')]:
            with self.subTest(user=repr(user)):
                self.public_error(lambda: self.engine.chat(system, user))
        self.opener.open.assert_not_called()

    def test_http_errors_do_not_echo_private_response_or_retry(self):
        for status, phrase in [(401, 'Accès Groq refusé'), (403, 'Accès Groq refusé'),
                               (429, 'Quota Groq atteint'), (408, 'pas répondu à temps'),
                               (504, 'pas répondu à temps'), (413, 'refusé la demande'),
                               (500, 'indisponible'), (307, 'Redirection Groq refusée')]:
            with self.subTest(status=status):
                body = io.BytesIO((SECRET + PRIVATE_TEXT).encode())
                self.opener.open.reset_mock()
                self.opener.open.side_effect = HTTPError('https://api.groq.com', status, SECRET, {}, body)
                self.assertIn(phrase, self.public_error(lambda: self.engine.chat('s', PRIVATE_TEXT)))
                self.opener.open.assert_called_once()
                self.assertTrue(body.closed)

    def test_timeouts_network_and_unexpected_exceptions_are_sanitized(self):
        for error, phrase in [(TimeoutError(SECRET), 'pas répondu à temps'),
                              (URLError(TimeoutError(SECRET)), 'pas répondu à temps'),
                              (URLError(SECRET), 'Connexion sécurisée'),
                              (RuntimeError(SECRET + PRIVATE_TEXT), 'Échec du traitement')]:
            with self.subTest(error=type(error).__name__):
                self.opener.open.reset_mock()
                self.opener.open.side_effect = error
                self.assertIn(phrase, self.public_error(lambda: self.engine.chat('s', PRIVATE_TEXT)))
                self.opener.open.assert_called_once()

    def test_malformed_or_oversized_json_is_rejected(self):
        for response in [b'not json', b'\xff', b'[]', b'null', b'x' * (groq.MAX_RESPONSE_BYTES + 1)]:
            with self.subTest(response_length=len(response)):
                self.response.read.return_value = response
                self.public_error(lambda: self.engine.chat('s', 'u'))

    def test_malformed_chat_payloads_are_rejected(self):
        for payload in [{}, {'choices': 'bad'}, {'choices': []}, {'choices': [None]},
                        {'choices': [{}]}, {'choices': [{'finish_reason': 'stop', 'message': None}]},
                        completion(''), completion([]), completion('x' * (groq.MAX_OUTPUT_CHARACTERS + 1))]:
            with self.subTest(payload_type=type(payload).__name__):
                self.response.read.return_value = json.dumps(payload).encode()
                self.public_error(lambda: self.engine.chat('s', 'u'))

    def test_partial_output_is_never_applied_as_complete(self):
        self.response.read.return_value = json.dumps(completion('Texte tronqué', finish='length')).encode()
        self.assertIn('incomplète', self.public_error(lambda: self.engine.chat('s', 'u')))

    def test_unexpected_tool_call_is_rejected(self):
        payload = completion('Hello')
        payload['choices'][0]['message']['tool_calls'] = [{'name': 'execute'}]
        self.response.read.return_value = json.dumps(payload).encode()
        self.public_error(lambda: self.engine.chat('s', 'u'))

    def test_audio_multipart_uses_french_and_preserves_audio_without_local_path(self):
        self.response.read.return_value = json.dumps({'text': 'Bonjour à tous.'}).encode()
        audio = b'\x00\x01\xffbinary audio\r\n'
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            source = Path(folder) / 'private-recording.webm'
            source.write_bytes(audio)
            self.assertEqual(self.engine.transcribe(source), 'Bonjour à tous.')
            request = self.request()
            self.assertNotIn(str(source).encode(), request.data)
        self.assertEqual(request.full_url, 'https://api.groq.com/openai/v1/audio/transcriptions')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + SECRET)
        message = BytesParser(policy=policy.default).parsebytes(
            ('MIME-Version: 1.0\r\nContent-Type: ' + request.get_header('Content-type') + '\r\n\r\n').encode() + request.data)
        fields = {part.get_param('name', header='content-disposition'): part for part in message.iter_parts()}
        self.assertEqual(fields['model'].get_content(), 'whisper-large-v3-turbo')
        self.assertEqual(fields['language'].get_content(), 'fr')
        self.assertEqual(fields['response_format'].get_content(), 'json')
        self.assertEqual(fields['file'].get_filename(), 'dictation.webm')
        self.assertEqual(fields['file'].get_content_type(), 'audio/webm')
        self.assertEqual(fields['file'].get_payload(decode=True), audio)

    def test_all_current_audio_formats_are_accepted(self):
        self.response.read.return_value = b'{"text":"Bonjour"}'
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            for suffix in ('.m4a', '.mp4', '.ogg', '.wav', '.webm'):
                with self.subTest(suffix=suffix):
                    source = Path(folder) / ('dictation' + suffix)
                    source.write_bytes(b'audio fixture')
                    self.assertEqual(self.engine.transcribe(source), 'Bonjour')

    def test_audio_limits_and_unsupported_format_do_not_send(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            source = Path(folder) / 'audio.webm'
            self.public_error(lambda: self.engine.transcribe(source))  # Missing file.
            source.write_bytes(b'')
            self.public_error(lambda: self.engine.transcribe(source))
            source.write_bytes(b'a' * (groq.MAX_AUDIO_BYTES + 1))
            self.public_error(lambda: self.engine.transcribe(source))
            self.public_error(lambda: self.engine.transcribe(Path(folder) / 'audio.html'))
        self.opener.open.assert_not_called()

    def test_malformed_transcription_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            source = Path(folder) / 'audio.wav'
            source.write_bytes(b'audio fixture')
            for payload in [{}, {'text': None}, {'text': ''}, {'text': ['not a string']}]:
                with self.subTest(payload=payload):
                    self.response.read.return_value = json.dumps(payload).encode()
                    self.public_error(lambda: self.engine.transcribe(source))


if __name__ == '__main__':
    unittest.main()
