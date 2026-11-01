"""Outbound-only Supabase Realtime. Notifications wake durable RPC queue consumers."""
import json
import threading
import time
from urllib.parse import urlencode

class RealtimeEvents:
    def __init__(self, gateway_factory, wake):
        self.gateway_factory = gateway_factory
        self.wake = wake
        self.connected = threading.Event()
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name='atelier-events')
        self.socket = None

    @staticmethod
    def join(token):
        return {'topic': 'realtime:atelier-worker', 'event': 'phx_join', 'ref': '1',
                'payload': {'access_token': token, 'config': {
                    'broadcast': {'ack': False, 'self': False}, 'presence': {'enabled': False},
                    'postgres_changes': [{'event': '*', 'schema': 'public', 'table': 'atelier_events', 'filter': 'kind=eq.jobs'}]}}}

    def receive(self, message):
        event = message.get('event')
        payload = message.get('payload', {})
        if event in ('phx_error', 'phx_close') or (event == 'system' and payload.get('status') == 'error'):
            raise ConnectionError('Realtime subscription refused')
        if event == 'phx_reply' and message.get('ref') == '1':
            if payload.get('status') != 'ok' or not payload.get('response', {}).get('postgres_changes'):
                raise ConnectionError('Realtime subscription unavailable')
            self.connected.set()
            self.wake.set()  # Drain AFTER subscribing, on every reconnect.
        if event == 'postgres_changes' and self.connected.is_set():
            self.wake.set()

    def run(self):
        from websockets.sync.client import connect
        delay = 1
        while not self.stopped.is_set():
            try:
                gateway = self.gateway_factory()
                gateway.auth()
                url = gateway.url.replace('https://', 'wss://', 1) + '/realtime/v1/websocket?' + urlencode({'apikey': gateway.key, 'vsn': '1.0.0'})
                with connect(url, open_timeout=15, close_timeout=2, max_size=65536, proxy=None) as sock:
                    self.socket = sock
                    sock.send(json.dumps(self.join(gateway.token)))
                    joined_at = time.monotonic()
                    last_ping = joined_at
                    pending_ping = None
                    seq = 2
                    while not self.stopped.is_set():
                        now = time.monotonic()
                        if not self.connected.is_set() and now - joined_at > 15:
                            raise TimeoutError('Realtime join timeout')
                        if pending_ping and now - last_ping > 10:
                            raise TimeoutError('Realtime heartbeat timeout')
                        if now - last_ping > 25:
                            pending_ping = str(seq); seq += 1
                            sock.send(json.dumps({'topic': 'phoenix', 'event': 'heartbeat', 'payload': {}, 'ref': pending_ping}))
                            last_ping = now
                        previous = gateway.token
                        gateway.auth()
                        if gateway.token != previous:
                            sock.send(json.dumps({'topic': 'realtime:atelier-worker', 'event': 'access_token', 'payload': {'access_token': gateway.token}, 'ref': str(seq)}))
                            seq += 1
                        try:
                            message = json.loads(sock.recv(timeout=1))
                        except TimeoutError:
                            continue
                        if message.get('event') == 'phx_reply' and message.get('ref') == pending_ping:
                            pending_ping = None
                        self.receive(message)
                        if self.connected.is_set(): delay = 1
            except Exception:
                # Never log the URL, JWT, password, or incoming payload.
                if not self.stopped.is_set():
                    print('Liaison événementielle indisponible ; reconnexion automatique.', flush=True)
            finally:
                self.socket = None
                self.connected.clear()
            self.stopped.wait(delay)
            delay = min(30, delay * 2)

    def start(self): self.thread.start()
    def close(self):
        self.stopped.set()
        if self.socket:
            try: self.socket.close()
            except Exception: pass
        self.thread.join(timeout=4)
