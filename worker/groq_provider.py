"""Experimental Groq adapters. Credentials stay in the PC service environment.

No SDK, configurable destination, redirects, quota retries, or local/cloud fallback.
"""
import json
import os
from pathlib import Path
import socket
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

CHAT_MODEL = 'openai/gpt-oss-20b'
AUDIO_MODEL = 'whisper-large-v3-turbo'
MAX_INPUT_BYTES = 5_500
MAX_COMPLETION_TOKENS = 2_048
MAX_AUDIO_BYTES = 4_000_000
MAX_RESPONSE_BYTES = 512_000
MAX_OUTPUT_CHARACTERS = 200_000
TIMEOUT_SECONDS = 90
API_ROOT = 'https://api.groq.com/openai/v1/'


class GroqError(Exception):
    """Only fixed, user-safe French messages may be exposed to Atelier."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise GroqError('Redirection Groq refusée. Aucun autre serveur n’a été contacté.')


# HTTPS verifies the server certificate using the standard Python trust store.
# Do not inherit an environment HTTP proxy or redirect credentials to another host.
OPENER = build_opener(ProxyHandler({}), NoRedirect())


def _api_key():
    value = os.environ.get('ATELIER_GROQ_API_KEY', '')
    if (not value or len(value) > 512 or
            any(not ('!' <= character <= '~') for character in value)):
        raise GroqError('Clé Groq absente ou invalide dans la configuration privée du PC.')
    return value


def is_configured():
    """Local configuration check only; this does not promise API availability."""
    try:
        _api_key()
        return True
    except GroqError:
        return False


def _response_text(value):
    if (not isinstance(value, str) or not value.strip() or
            len(value) > MAX_OUTPUT_CHARACTERS):
        raise GroqError('Réponse Groq vide ou invalide. Aucune modification appliquée.')
    return value


class GroqProvider:
    def __init__(self):
        self._key = _api_key()

    def _post(self, route, body, content_type):
        if route not in ('chat/completions', 'audio/transcriptions'):
            raise GroqError('Opération Groq non autorisée.')
        req = Request(API_ROOT + route, data=body, method='POST', headers={
            'Content-Type': content_type,
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + self._key,
        })
        try:
            with OPENER.open(req, timeout=TIMEOUT_SECONDS) as response:
                if response.getcode() != 200:
                    raise GroqError('Réponse Groq inattendue. Vous pouvez réessayer plus tard.')
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise GroqError('Réponse Groq trop volumineuse. Réduisez la demande.')
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise GroqError('Réponse Groq invalide. Aucune modification appliquée.')
                return result
        except GroqError:
            raise
        except HTTPError as error:
            code = error.code
            error.close()  # Never read or expose the error response body.
            if code in (401, 403):
                message = 'Accès Groq refusé. Vérifiez la clé et les droits du compte sur le PC.'
            elif code == 429:
                message = 'Quota Groq atteint. Réessayez plus tard ou choisissez Local dans Atelier.'
            elif code in (408, 504):
                message = 'Groq n’a pas répondu à temps. Vous pouvez réessayer plus tard.'
            elif code in (400, 413, 422):
                message = 'Groq a refusé la demande. Réduisez sa taille ou vérifiez le format.'
            elif 300 <= code < 400:
                message = 'Redirection Groq refusée. Aucun autre serveur n’a été contacté.'
            else:
                message = 'Groq est momentanément indisponible. Vous pouvez réessayer plus tard.'
            raise GroqError(message) from None
        except (TimeoutError, socket.timeout):
            raise GroqError('Groq n’a pas répondu à temps. Vous pouvez réessayer plus tard.') from None
        except URLError as error:
            if isinstance(error.reason, (TimeoutError, socket.timeout)):
                raise GroqError('Groq n’a pas répondu à temps. Vous pouvez réessayer plus tard.') from None
            raise GroqError('Connexion sécurisée à Groq impossible. Vérifiez le réseau du PC.') from None
        except (ValueError, UnicodeError, TypeError):
            raise GroqError('Réponse Groq invalide. Aucune modification appliquée.') from None
        except Exception:
            # Do not expose exception text, API bodies, prompts or credentials.
            raise GroqError('Échec du traitement Groq. Vérifiez la connexion et réessayez.') from None

    def chat(self, system, user, *, json_output=False):
        if not isinstance(system, str) or not isinstance(user, str):
            raise GroqError('Texte invalide pour Groq.')
        try:
            size = len(system.encode('utf-8')) + len(user.encode('utf-8'))
        except UnicodeError:
            raise GroqError('Texte invalide pour Groq.') from None
        if not user.strip():
            raise GroqError('Le texte à envoyer à Groq est vide.')
        # A byte bound is deliberately more conservative than counting characters.
        # Leave room below 8k TPM for completion/reasoning and message framing.
        # Other requests on this account may still consume the shared quota.
        if size > MAX_INPUT_BYTES:
            raise GroqError('Texte trop long pour ce prototype Groq (5 500 octets UTF-8, instructions comprises). Réduisez la note ou la recherche, ou choisissez Local dans Atelier.')
        payload = {
            'model': CHAT_MODEL,
            'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            'stream': False,
            'reasoning_effort': 'low',
            'include_reasoning': False,
            'max_completion_tokens': MAX_COMPLETION_TOKENS,
        }
        if json_output:
            payload['response_format'] = {'type': 'json_object'}
        result = self._post('chat/completions', json.dumps(payload, ensure_ascii=False).encode('utf-8'), 'application/json')
        choices = result.get('choices')
        if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
            raise GroqError('Réponse Groq invalide. Aucune modification appliquée.')
        choice = choices[0]
        if choice.get('finish_reason') != 'stop':
            raise GroqError('Réponse Groq incomplète ou refusée. Réduisez la demande ; aucun texte partiel n’a été appliqué.')
        message = choice.get('message')
        if not isinstance(message, dict) or message.get('tool_calls') or message.get('refusal'):
            raise GroqError('Réponse Groq invalide ou refusée. Aucune modification appliquée.')
        return _response_text(message.get('content'))

    def transcribe(self, path):
        source = Path(path)
        suffix = source.suffix.lower()
        mime = {'.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
                '.ogg': 'audio/ogg', '.wav': 'audio/wav'}.get(suffix)
        if mime is None:
            raise GroqError('Format audio non pris en charge par ce prototype Groq.')
        try:
            with source.open('rb') as audio_file:
                audio = audio_file.read(MAX_AUDIO_BYTES + 1)
        except OSError:
            raise GroqError('Enregistrement audio inaccessible sur le PC.') from None
        if not 0 < len(audio) <= MAX_AUDIO_BYTES:
            raise GroqError('Enregistrement vide ou trop long (4 Mo maximum).')
        boundary = 'atelier-' + uuid.uuid4().hex
        while boundary.encode() in audio:
            boundary = 'atelier-' + uuid.uuid4().hex
        parts = []
        for name, value in (('model', AUDIO_MODEL), ('language', 'fr'),
                            ('response_format', 'json'), ('temperature', '0')):
            parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode())
        # Fixed filename: do not disclose or interpolate local paths in headers.
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="dictation{suffix}"\r\nContent-Type: {mime}\r\n\r\n').encode())
        parts.extend((audio, f'\r\n--{boundary}--\r\n'.encode()))
        result = self._post('audio/transcriptions', b''.join(parts), 'multipart/form-data; boundary=' + boundary)
        return _response_text(result.get('text'))
