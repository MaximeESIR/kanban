"""Install user services/configuration without root or starting an unconfigured worker."""
from pathlib import Path
import json
import os
import subprocess
from ticket_executor import read_registry, STATE, git

def main():
    root=Path(__file__).resolve().parent.parent
    config=Path.home()/'.config/atelier';config.mkdir(parents=True,exist_ok=True,mode=0o700)
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    settings=config/'worker.env'
    if not settings.exists():
        settings.write_text('''# Fill the four Supabase values, then start atelier-worker.service.
ATELIER_SUPABASE_URL=
ATELIER_PUBLISHABLE_KEY=
ATELIER_WORKER_EMAIL=
ATELIER_WORKER_PASSWORD=
ATELIER_OLLAMA_URL=http://127.0.0.1:11434
ATELIER_MODEL=qwen3.5:4b
ATELIER_THINK=false
ATELIER_CONTEXT=8192
ATELIER_WHISPER_DEVICE=cpu
ATELIER_WHISPER_COMPUTE=int8
ATELIER_DICTATION_VOCABULARY="Atelier, Jetson, NVIDIA, inférence, ONNX, TensorRT, Codex, Supabase."
'''+f'ATELIER_WHISPER_MODEL={Path.home()}/.local/share/atelier/models/faster-whisper-small\n')
        settings.chmod(0o600)
    # Canonical paths are inserted as systemd quoted strings, not shell source.
    def quote(p):return json.dumps(str(p).replace('%','%%'))
    writable=[STATE,Path.home()/'.codex']
    for row in read_registry():writable.append(Path(git(Path(row['path']),'rev-parse','--path-format=absolute','--git-common-dir')))
    unit=Path.home()/'.config/systemd/user/atelier-worker.service';unit.parent.mkdir(parents=True,exist_ok=True)
    unit.write_text(f'''[Unit]
Description=Atelier PC event receiver and serial ticket executor
After=network-online.target atelier-ollama.service
[Service]
Type=simple
WorkingDirectory={str(root).replace("%", "%%")}
EnvironmentFile={str(settings).replace("%", "%%")}
Environment=PATH={Path.home()}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart={quote(root/'worker/.venv/bin/python')} {quote(root/'worker/atelier_worker.py')}
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={' '.join(quote(p) for p in writable)}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
TimeoutStopSec=15
[Install]
WantedBy=default.target
''')
    subprocess.run(['systemctl','--user','daemon-reload'],check=True)
    print('Service installé sans démarrage. Renseignez ~/.config/atelier/worker.env, vérifiez doctor, puis systemctl --user enable --now atelier-worker.service.')

if __name__=='__main__':main()
