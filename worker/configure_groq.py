#!/usr/bin/env python3
"""Save a Groq key privately on this PC, without displaying or testing it."""
import getpass
import os
from pathlib import Path
import re
import tempfile

CONFIG = Path.home()/'.config/atelier/worker.env'


def save_key(key, path=CONFIG):
    # A narrow alphabet also makes the value literal in systemd EnvironmentFile.
    if not isinstance(key, str) or not re.fullmatch(r'gsk_[A-Za-z0-9_-]{12,500}', key):
        raise ValueError('Clé invalide. Copiez la clé Groq complète, qui commence par gsk_.')
    if path.is_symlink() or path.parent.resolve()!=path.parent or not path.is_file():
        raise ValueError('Le fichier privé worker.env doit déjà exister, sans lien symbolique.')
    metadata=path.stat()
    if metadata.st_uid!=os.getuid() or metadata.st_mode&0o077:
        raise ValueError('worker.env doit appartenir à votre compte et avoir les permissions 600.')
    content=path.read_text()
    lines=[line for line in content.splitlines() if not re.match(r'^\s*ATELIER_GROQ_API_KEY\s*=',line)]
    lines.append('ATELIER_GROQ_API_KEY='+key)
    fd, temporary=tempfile.mkstemp(prefix='.groq-', dir=path.parent)
    try:
        with os.fdopen(fd,'w') as dest:
            dest.write('\n'.join(lines)+'\n')
            dest.flush();os.fsync(dest.fileno())
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def main():
    if os.getuid()==0:
        raise SystemExit('Lancez ce script avec votre compte habituel, sans sudo.')
    try:
        key=getpass.getpass('Collez votre clé Groq (saisie invisible), puis appuyez sur Entrée : ')
        save_key(key)
    except (ValueError,OSError):
        raise SystemExit('Enregistrement refusé. Vérifiez la clé gsk_ et le fichier privé ~/.config/atelier/worker.env (permissions 600).') from None
    except (EOFError,KeyboardInterrupt):
        raise SystemExit('\nAnnulé. Aucun changement.') from None
    print('Clé enregistrée sur ce PC, sans envoi réseau. Redémarrez le service Atelier pour la charger.')
    print('Le choix du moteur se fait ensuite dans Atelier → Assistant PC → Groq.')


if __name__=='__main__':main()
