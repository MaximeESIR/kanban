"""Apply the owner's assistant preference only between completed child processes."""
import time
from urllib.error import HTTPError
from groq_provider import is_configured


class AssistantConfigurationError(Exception):
    """A safe message describing a blocked local configuration change."""


def release_ollama_model(request, endpoint, model):
    """Unload only Atelier's configured model and verify it disappeared from /ps.

    No inference, deletion, server shutdown or command execution. The caller has
    already joined its Whisper/text child before reaching this function.
    """
    if not model:
        return True

    def normalized(name):
        return name if ':' in name.rsplit('/', 1)[-1] else name + ':latest'

    def present():
        data = request(endpoint + '/api/ps', timeout=3)
        if not isinstance(data, dict) or not isinstance(data.get('models'), list):
            raise AssistantConfigurationError('Ollama ne confirme pas la mémoire utilisée.')
        for row in data['models']:
            if not isinstance(row, dict) or not isinstance(row.get('name', row.get('model')), str):
                raise AssistantConfigurationError('Ollama ne confirme pas la mémoire utilisée.')
            if normalized(row.get('name', row.get('model'))) == normalized(model):
                return True
        return False

    try:
        if present():
            request(endpoint + '/api/generate', {'model': model, 'keep_alive': 0, 'stream': False}, timeout=10)
        if present():
            raise AssistantConfigurationError('Le modèle local Atelier reste chargé. Réessayez après la fin de ses autres utilisations.')
        return True
    except AssistantConfigurationError:
        raise
    except Exception:
        raise AssistantConfigurationError('Impossible de confirmer le déchargement du modèle Atelier. Vérifiez Ollama sur le PC.') from None


class AssistantSettings:
    """An acknowledged preference is required before the worker can claim a job."""
    def __init__(self, gateway, local_capabilities, release_local, clock=time.monotonic):
        self.gateway = gateway
        self.local_capabilities = local_capabilities
        self.release_local = release_local
        self.clock = clock
        self.provider = 'local'
        self.revision = 0
        self.supported = None
        self.state = 'pending'
        self.ready = False
        self.error = None
        self.local_models_unloaded = False
        self.groq_configured = False
        self.capabilities = []
        self.checked_at = float('-inf')

    def _snapshot(self):
        return (self.provider, self.revision, self.supported, self.ready,
                self.state, self.local_models_unloaded, self.groq_configured, self.error,
                tuple(self.capabilities))

    def refresh(self, *, busy=False, force=False):
        """No effects at all while an audio/text child still exists, even cancelled."""
        now = self.clock()
        if busy or (not force and now - self.checked_at < 10):
            return False
        before = self._snapshot()
        self.checked_at = now
        try:
            try:
                settings = self.gateway.rpc('worker_assistant_settings', {})
            except HTTPError as error:
                if error.code != 404 or self.supported is True:
                    raise
                # Only an old server that has never acknowledged 008 may fall back.
                # A missing/failed RPC after a Groq selection never means consent to local.
                error.close()
                self.supported = False
                self.provider = 'local'
                self.revision = 0
                self.state = 'ready'
                self.ready = True
                self.error = None
                self.local_models_unloaded = False
                self.groq_configured = is_configured()
                self.capabilities = []  # Legacy mode retains Runner's local discovery.
                return before != self._snapshot()
            if (not isinstance(settings, dict) or settings.get('provider') not in ('local', 'groq') or
                    type(settings.get('revision')) is not int or settings['revision'] < 0):
                raise AssistantConfigurationError('Préférence de l’assistant invalide. Aucun traitement lancé.')
            changed = (self.provider, self.revision) != (settings['provider'], settings['revision'])
            self.supported = True
            self.provider, self.revision = settings['provider'], settings['revision']
            self.ready = False  # Report must acknowledge this revision before any claim.
            self.capabilities = []
            self.error = None
            self.groq_configured = is_configured()
            if changed:
                self.local_models_unloaded = False
            if self.provider == 'groq':
                if not self.local_models_unloaded:
                    try:
                        self.local_models_unloaded = self.release_local() is True
                    except AssistantConfigurationError as error:
                        self.error = str(error)
                    except Exception:
                        self.error = 'Impossible de confirmer le déchargement des modèles locaux.'
                if not self.local_models_unloaded:
                    self.error = self.error or 'Le déchargement des modèles locaux reste à vérifier.'
                elif not self.groq_configured:
                    self.error = 'Clé Groq absente ou invalide dans la configuration privée du PC.'
                else:
                    self.capabilities = ['summarize', 'rewrite', 'search', 'transcribe']
            else:
                self.local_models_unloaded = False
                self.capabilities = self.local_capabilities()
                if not self.capabilities:
                    self.error = 'Aucun moteur local prêt. Vérifiez les modèles installés sur le PC.'
            self.state = 'blocked' if self.error else 'ready'
            accepted = self.gateway.rpc('worker_assistant_report', {
                'p_revision': self.revision,
                'p_provider': self.provider,
                'p_state': self.state,
                'p_groq_configured': self.groq_configured,
                'p_local_models_unloaded': self.local_models_unloaded,
                'p_error': self.error,
                'p_capabilities': self.capabilities if self.state == 'ready' else [],
            })
            if accepted is True:
                self.ready = self.state == 'ready'
            else:
                # The owner changed the preference during the RPC or local unload.
                self.state = 'pending'
                self.capabilities = []
                self.error = None
                self.checked_at = float('-inf')
        except AssistantConfigurationError as error:
            self.ready = False
            self.capabilities = []
            self.state = 'blocked'
            self.error = str(error)
        except Exception:
            self.ready = False
            self.capabilities = []
            self.state = 'pending'
            self.error = 'Préférence de l’assistant inaccessible. Aucun nouveau traitement lancé.'
        return before != self._snapshot()

    def claim_arguments(self, capabilities):
        result = {'p_capabilities': capabilities}
        if self.supported is True:
            result['p_provider'] = self.provider
        return result
