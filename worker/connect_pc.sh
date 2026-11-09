#!/usr/bin/env bash
# Install only the reviewed Atelier unit. The worker itself runs as the user.
set -euo pipefail
if [[ "$(id -u)" == 0 ]]; then
  echo 'Lance cette commande sans sudo ; le script le demandera uniquement pour installer le service.' >&2
  exit 1
fi
atelier_worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 "$atelier_worker_dir/ticket_executor.py" doctor
python3 "$atelier_worker_dir/install_service.py" --system
echo 'Ubuntu demande ton mot de passe administrateur pour installer le service Atelier.'
sudo -v
if systemctl --user cat atelier-worker.service >/dev/null 2>&1; then
  systemctl --user disable --now atelier-worker.service
fi
sudo install -m 0644 "$HOME/.config/atelier/atelier-worker-system.service" /etc/systemd/system/atelier-worker.service
sudo systemctl daemon-reload
sudo systemctl enable atelier-worker.service
if ! sudo systemctl restart atelier-worker.service; then
  sudo journalctl -u atelier-worker.service --no-pager -n 25
  exit 1
fi
systemctl is-active atelier-worker.service
echo 'Service Atelier démarré et configuré pour les prochains démarrages du PC.'
python3 "$atelier_worker_dir/connection_status.py" "$(systemctl show atelier-worker.service -p MainPID --value)"
echo 'Reviens dans ton projet : la demande de dossier en attente va être reprise automatiquement.'
echo 'Attends le message « Chemin vérifié et associé au projet ». Ne recrée pas la demande.'
