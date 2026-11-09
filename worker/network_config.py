"""Persist only proxy settings for systemd, never the whole shell environment."""
import json
import os
from pathlib import Path
import tempfile

KEYS = ('http_proxy','https_proxy','wss_proxy','ws_proxy','no_proxy',
        'HTTP_PROXY','HTTPS_PROXY','WSS_PROXY','WS_PROXY','NO_PROXY')

def save_network_config(path, environ=None):
    environ = os.environ if environ is None else environ
    values = {key: environ[key] for key in KEYS if key in environ}
    if not values:
        return False  # Preserve an existing explicitly configured network file.
    if any(not isinstance(v,str) or len(v)>8192 or any(ord(c)<32 for c in v) for v in values.values()):
        raise ValueError('Configuration proxy invalide ; aucune valeur affichée.')
    bypass = values.get('no_proxy',values.get('NO_PROXY',''))
    bypass = ','.join(dict.fromkeys([v for v in bypass.split(',') if v]+['localhost','127.0.0.1','::1']))
    values['no_proxy']=values['NO_PROXY']=bypass
    path=Path(path)
    if path.is_symlink() or path.parent.resolve()!=path.parent or path.parent.stat().st_uid!=os.getuid():
        raise ValueError('Dossier réseau non autorisé.')
    fd,name=tempfile.mkstemp(prefix='.network-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as output:
            for key,value in sorted(values.items()):
                output.write(key+'='+json.dumps(value,ensure_ascii=False)+'\n')
            output.flush();os.fsync(output.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
    return True
