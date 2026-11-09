#!/usr/bin/env python3
"""Interactive local credential setup. No network and no client-config edits."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid
import warnings

DEFAULT_URL = 'https://szutxqgfapqsmkixvvwy.supabase.co'
DEFAULT_PATH = Path.home() / '.config/atelier/mcp.json'


def validate(value):
    if set(value) != {'supabase_url', 'publishable_key', 'agent_email', 'agent_password'}:
        raise ValueError('Configuration incomplète.')
    if not re.fullmatch(r'https://[a-z0-9-]{3,63}\.supabase\.co', value['supabase_url']):
        raise ValueError('URL du projet Supabase invalide.')
    if not re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]{10,500}', value['publishable_key']):
        raise ValueError('Utilisez uniquement une clé publique sb_publishable_.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value['agent_email']) or len(value['agent_email']) > 254:
        raise ValueError('Adresse du compte agent invalide.')
    if not isinstance(value['agent_password'], str) or not 1 <= len(value['agent_password']) <= 1024:
        raise ValueError('Mot de passe du compte agent requis.')


def save_config(value, path=DEFAULT_PATH, replace=False):
    validate(value)
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent.stat()
    if path.parent.resolve() != path.parent or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('Le dossier ~/.config/atelier doit vous appartenir, être privé (700) et sans lien symbolique.')
    backup = None
    if path.is_symlink():
        raise ValueError('Le fichier de configuration ne doit pas être un lien symbolique.')
    if path.exists():
        metadata = path.stat()
        if not path.is_file() or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077 or metadata.st_size > 16384:
            raise ValueError('Le fichier existant doit vous appartenir et être privé (600).')
        if not replace:
            raise ValueError('Configuration déjà présente. Utilisez --replace pour la remplacer avec sauvegarde privée.')
        backup = path.with_name('mcp.backup-' + uuid.uuid4().hex + '.json')
        fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(path.read_bytes())
    fd, temporary = tempfile.mkstemp(prefix='.mcp-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return backup


def main():
    parser = argparse.ArgumentParser(description='Configurer le compte agent MCP privé, sans envoi réseau.')
    parser.add_argument('--replace', action='store_true', help='Remplacer le fichier existant avec sauvegarde privée.')
    args = parser.parse_args()
    if os.getuid() == 0 or not sys.stdin.isatty():
        raise SystemExit('Lancez ce script dans un terminal interactif avec votre compte habituel, sans sudo.')
    if DEFAULT_PATH.exists() and not args.replace:
        raise SystemExit('Configuration déjà présente. Aucun changement. Utilisez --replace pour une nouvelle configuration avec sauvegarde.')
    try:
        url = input(f'URL du projet Supabase [Entrée = {DEFAULT_URL}] : ').strip() or DEFAULT_URL
        key = input('Clé publique Supabase sb_publishable_ : ').strip()
        email = input('Adresse du NOUVEAU compte agent [Entrée = atelier-agent@example.com] : ').strip() or 'atelier-agent@example.com'
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('Mot de passe de ce compte agent (saisie invisible), puis Entrée : ')
        backup = save_config({'supabase_url': url, 'publishable_key': key, 'agent_email': email, 'agent_password': password}, replace=args.replace)
    except (ValueError, OSError, getpass.GetPassWarning):
        raise SystemExit('Enregistrement refusé. Vérifiez URL, clé publique, compte agent et permissions du dossier privé. Aucun secret affiché.') from None
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('\nConfiguration annulée.') from None
    print('Compte agent enregistré localement. Aucun test réseau effectué. Relancez la connexion MCP du client.')
    if backup: print('Ancienne configuration sauvegardée dans un fichier privé à côté de mcp.json.')


if __name__ == '__main__': main()
