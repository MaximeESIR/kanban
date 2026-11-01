"""Validate a human's exact path; no model, shell command, clone or worktree here."""
import os
from pathlib import Path
import subprocess
import time
import uuid
from urllib.error import HTTPError
from ticket_executor import CONFIG, REMOTE_CONFIG, STATE, ExecutionError, git, private_json, read_registry


def check_path(value, create=False):
    if not isinstance(value,str) or not value or len(value)>1000 or any(ord(c)<32 for c in value):
        raise ExecutionError('Chemin invalide : saisissez le chemin complet du dossier sur le PC.')
    if value.startswith('~/'): value=str(Path.home()/value[2:])
    path=Path(value)
    if not path.is_absolute() or '..' in path.parts:
        raise ExecutionError('Utilisez un chemin absolu, sans « .. ».')
    if path.resolve()!=path:
        raise ExecutionError('Ce chemin traverse un lien symbolique. Saisissez le chemin réel du dépôt.')
    if create and not (path/'.git').exists() and any((parent/'.git').exists() for parent in path.parents):
        raise ExecutionError('Choisissez un dossier en dehors des dépôts existants pour créer ce nouveau projet.')
    home=Path.home()
    protected=[home/'.ssh',home/'.codex',home/'.config',home/'.local',home/'.cache',Path('/etc'),Path('/proc'),Path('/sys'),Path('/dev'),Path('/root')]
    if path in (Path('/'),home) or any(path.is_relative_to(p) or p.is_relative_to(path) for p in protected):
        raise ExecutionError('Ce dossier contient des données privées ou système. Choisissez le dossier précis du projet.')
    if path.exists():
        if not path.is_dir() or path.stat().st_uid!=os.getuid():
            raise ExecutionError('Le dossier doit appartenir au compte utilisateur du PC.')
        if create and not (path/'.git').exists():
            if any(path.iterdir()): raise ExecutionError('Pour créer un projet, choisissez un dossier vide ou inexistant.')
            return path,True
    elif create:
        if not path.parent.is_dir() or path.parent.stat().st_uid!=os.getuid():
            raise ExecutionError('Le dossier parent doit déjà exister et appartenir à votre compte PC.')
        return path,True
    else:
        raise ExecutionError('Ce dossier n’existe pas sur le PC. Vérifiez le chemin ou choisissez « Nouveau dossier ».')
    metadata=path/'.git'
    if not metadata.is_dir() or metadata.is_symlink() or metadata.stat().st_uid!=os.getuid():
        raise ExecutionError('Choisissez la racine d’un dépôt Git local, avec son propre dossier .git.')
    try:
        if git(path,'rev-parse','--show-toplevel',timeout=5)!=str(path):
            raise ExecutionError('Choisissez la racine du dépôt Git.')
        git(path,'rev-parse','--verify','HEAD',timeout=5)
    except (ExecutionError,subprocess.SubprocessError):
        raise ExecutionError('Ce dépôt Git est illisible ou ne possède aucun commit. Vérifiez-le sur le PC.') from None
    return path,False


def register_path(job, config=REMOTE_CONFIG, existing=None):
    path,initialize=check_path(job['requested_path'],job.get('create_if_missing',False))
    rows=read_registry(config,include_web=False)
    existing=read_registry() if existing is None else existing
    row=next((r for r in existing+rows if r['path']==str(path)),None)
    if row:return row
    if len({r['id'] for r in existing+rows})>=50: raise ExecutionError('Limite de 50 dépôts atteinte sur le PC.')
    # Only explicit "Nouveau dossier" can create a leaf; never overwrite any file.
    if initialize:
        path.mkdir(mode=0o700,exist_ok=True)
        if any(path.iterdir()): raise ExecutionError('Le nouveau dossier n’est plus vide ; aucun fichier modifié.')
    row={'id':str(uuid.uuid5(uuid.UUID(job['worker_id']),str(path))),
         'path':str(path),'label':job.get('label',path.name)[:100] or path.name,'initialize':initialize}
    rows.append(row);private_json(config,rows)
    return row


class RepositoryRequests:
    def __init__(self,gateway):
        self.gateway=gateway;self.supported=True;self.retry_at=0

    def due(self): return bool(self.retry_at and time.monotonic()>=self.retry_at)

    def tick(self, models, ready):
        if not self.supported:return False
        self.retry_at=time.monotonic()+65
        try:
            job=self.gateway.rpc('worker_repository_claim',{})
        except HTTPError as error:
            if error.code==404:
                self.supported=False;self.retry_at=0
                print('Ajout de chemins disponible après migration 007 et redémarrage. Notes et tickets existants restent disponibles.',flush=True)
                return False
            raise
        if not job:
            self.retry_at=0
            return False
        if 'retry_after' in job:return False
        row=None;message=None
        try:
            row=register_path(job)
        except ExecutionError as error:
            message=str(error)
        except (OSError,subprocess.SubprocessError,ValueError):
            message='Le PC ne peut pas ouvrir ou créer ce dossier. Vérifiez son chemin et ses permissions.'
        if row and message is None:
            self.gateway.rpc('worker_repository_sync',{'p_repositories':[
                {**r,'enabled':ready and bool(models),'codex_models':models} for r in read_registry()]})
        self.gateway.rpc('worker_repository_finish',{'p_id':job['id'],'p_lease':job['lease'],
            'p_repository':row['id'] if row else None,'p_error':message})
        self.retry_at=0
        return True
