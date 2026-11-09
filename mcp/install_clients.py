#!/usr/bin/env python3
"""Register the reviewed stdio launcher, backing up existing client files first."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tomllib
import uuid

ROOT = Path(__file__).resolve().parent


def client_spec(name, home):
    launcher = str(ROOT / 'launch.sh')
    if name == 'codex':
        path = Path(os.environ.get('CODEX_HOME', str(home / '.codex'))) / 'config.toml'
        command = ['codex', 'mcp', 'add', 'atelier', '--', '/bin/bash', launcher]
    elif name == 'claude':
        if os.environ.get('CLAUDE_CONFIG_DIR'):
            raise ValueError('CLAUDE_CONFIG_DIR personnalisé : utilisez la configuration fournie après vérification manuelle.')
        path = home / '.claude.json'
        command = ['claude', 'mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'atelier', '--', '/bin/bash', launcher]
    else:
        if os.environ.get('VIBE_HOME') or os.environ.get('VIBE_CONFIG'):
            raise ValueError('Configuration Vibe personnalisée : utilisez le fragment fourni après vérification manuelle.')
        path = home / '.vibe/config.toml'
        command = ['vibe', 'mcp', 'add', 'atelier', '--transport', 'stdio', '--command', '/bin/bash', '--arg', launcher]
    return path, command


def existing_entry(name, path):
    if path.is_symlink() or (path.parent.exists() and path.parent.resolve() != path.parent):
        raise ValueError('Configuration client liée symboliquement ; aucun changement automatique.')
    if not path.exists(): return None
    if path.is_symlink() or path.resolve() != path or path.stat().st_uid != os.getuid():
        raise ValueError('Configuration client non standard ; aucun changement automatique.')
    content = path.read_text()
    config = json.loads(content) if name == 'claude' else tomllib.loads(content)
    if name == 'claude': return config.get('mcpServers', {}).get('atelier')
    if name == 'codex': return config.get('mcp_servers', {}).get('atelier')
    matches = [item for item in config.get('mcp_servers', []) if item.get('name') == 'atelier']
    if len(matches) > 1: raise ValueError('Plusieurs serveurs Atelier déclarés dans Vibe. Aucun changement.')
    return matches[0] if matches else None


def install(name, *, home=None, dry_run=False, run=subprocess.run):
    home = Path.home() if home is None else Path(home)
    path, command = client_spec(name, home)
    entry = existing_entry(name, path)
    if entry is not None:
        if entry.get('command') == '/bin/bash' and entry.get('args') == [str(ROOT / 'launch.sh')]:
            return name + ' : Atelier déjà configuré, aucun changement.'
        raise ValueError(name + ' : une entrée Atelier différente existe déjà ; aucun remplacement automatique.')
    if dry_run: return shlex.join(command)
    if not (ROOT / 'dist/server.js').is_file():
        raise ValueError('Construisez le serveur : npm ci --prefix mcp puis npm run build --prefix mcp.')
    if not shutil.which(name): return name + ' : client absent, configuration disponible dans mcp/configs/.'
    if path.exists():
        destination = home / '.config/atelier/client-backups'
        destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        if destination.resolve() != destination or destination.stat().st_mode & 0o077:
            raise ValueError('Dossier de sauvegarde non privé ou lien symbolique ; aucun changement.')
        fd = os.open(destination / (name + '-' + uuid.uuid4().hex + path.suffix), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as backup: backup.write(path.read_bytes())
    completed = run(command, capture_output=True, text=True, timeout=30)
    if completed.returncode:
        raise ValueError(name + ' : installation refusée par le client. La sauvegarde éventuelle est dans ~/.config/atelier/client-backups/.')
    return name + ' : Atelier ajouté (compte Supabase configuré séparément).'


def main():
    parser = argparse.ArgumentParser(description='Ajouter Atelier aux clients MCP, sans secret dans leurs configurations.')
    parser.add_argument('--client', choices=['all', 'codex', 'claude', 'vibe'], default='all')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    failed = False
    for name in (['codex', 'claude', 'vibe'] if args.client == 'all' else [args.client]):
        try: print(install(name, dry_run=args.dry_run))
        except (ValueError, OSError, subprocess.SubprocessError):
            failed = True
            print(name + ' : configuration existante non modifiée volontairement ou commande refusée. Consultez mcp/README.md et les sauvegardes privées.')
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__': main()
