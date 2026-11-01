"""One Codex session in the exact repository explicitly selected by the owner."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import tomllib
import uuid
from codex_models import ModelCatalog, validate_selection

ROOT = Path(__file__).resolve().parent
CONFIG = Path.home() / '.config/atelier/repositories.json'
STATE = Path.home() / '.local/share/atelier/executions'
REMOTE_CONFIG = STATE / 'web-repositories.json'
MODEL_CATALOG = ModelCatalog()
FEATURES = ('apps','plugins','remote_plugin','hooks','multi_agent','browser_use','browser_use_external',
            'browser_use_full_cdp_access','computer_use','shell_snapshot','image_generation',
            'skill_mcp_dependency_install','skill_search')
SCHEMA = {'type':'object','additionalProperties':False,'required':['summary','tests','limitations'],
          'properties':{'summary':{'type':'string'},'tests':{'type':'array','items':{'type':'string'}},
                        'limitations':{'type':'array','items':{'type':'string'}}}}

class ExecutionError(Exception): pass

def available_models():
    try:
        return MODEL_CATALOG.get(codex_binary, clean_env())
    except ExecutionError:
        return []

def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.'+path.name)
    try:
        with os.fdopen(fd, 'w') as f: json.dump(value, f, ensure_ascii=False, indent=2)
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)

def clean_env():
    # Preserve the real user identity for ChatGPT login, never inherit service credentials.
    allowed = ('HOME','USER','LOGNAME','LANG','LC_ALL','TERM','XDG_RUNTIME_DIR')
    env = {k:os.environ[k] for k in allowed if k in os.environ}
    env['PATH'] = '/usr/local/bin:/usr/bin:/bin'
    return env

def git(repo, *args, timeout=30):
    env=clean_env()
    env.update({'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_TERMINAL_PROMPT':'0'})
    base=['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','submodule.recurse=false','-C',str(repo)]
    # Checkout filters can execute arbitrary programs before Codex starts. Disable every
    # configured driver (including included local config), not just hooks/fsmonitor.
    config=subprocess.run([*base,'config','--name-only','--get-regexp',r'^filter\..*\.(smudge|process|clean|required)$'],
                          env=env,capture_output=True,text=True,timeout=min(10,timeout))
    if config.returncode not in (0,1):raise ExecutionError('Configuration Git illisible')
    overrides=[]
    for name in {line.rsplit('.',1)[0] for line in config.stdout.splitlines()}:
        overrides += ['-c',name+'.process=','-c',name+'.smudge=cat','-c',name+'.clean=cat','-c',name+'.required=false']
    r = subprocess.run([*base,*overrides,*args], env=env,capture_output=True,text=True,timeout=timeout)
    if r.returncode: raise ExecutionError('Commande Git refusée. Vérifiez le dépôt local et ses objets disponibles hors ligne.')
    return r.stdout.strip()

def read_registry(path=CONFIG, include_web=True):
    if path.is_symlink(): raise ExecutionError('Le registre ne doit pas être un lien symbolique')
    if path.exists() and path.stat().st_mode & 0o077: raise ExecutionError('Le registre doit être privé : chmod 600 repositories.json')
    rows = json.loads(path.read_text()) if path.exists() else []
    if path==CONFIG and include_web:
        rows += read_registry(REMOTE_CONFIG,include_web=False)
    if not isinstance(rows,list) or len(rows)>50: raise ExecutionError('Registre invalide')
    seen=set()
    for row in rows:
        key = str(uuid.UUID(row['id']))
        p = Path(row['path'])
        if key in seen or not p.is_absolute() or p.resolve()!=p or not row['label'].strip(): raise ExecutionError('Registre invalide')
        seen.add(key)
    return rows

def add_repository(path, label, config=CONFIG):
    repo = Path(path).expanduser().resolve(strict=True)
    if str(repo) != git(repo,'rev-parse','--show-toplevel'): raise ExecutionError('Choisissez la racine du dépôt Git')
    if repo in (Path('/'),Path.home()) or STATE==repo or STATE.is_relative_to(repo): raise ExecutionError('Chemin trop large')
    rows=read_registry(config,include_web=False)
    existing=next((r for r in rows if r['path']==str(repo)),None)
    if existing: return existing
    row={'id':str(uuid.uuid4()),'label':label[:100] or repo.name,'path':str(repo)}
    rows.append(row);private_json(config,rows)
    return row

def git_identity(repo):
    """Read only the configured author identity, never expose other Git settings."""
    identity={}
    for key,suffix in [('user.name','NAME'),('user.email','EMAIL')]:
        result=subprocess.run(['git','-C',str(repo),'config','--get',key],env=clean_env(),capture_output=True,text=True,timeout=5)
        value=result.stdout.strip() if result.returncode==0 else ''
        if value and len(value)<=300 and not any(ord(c)<32 for c in value):
            identity['GIT_AUTHOR_'+suffix]=value
            identity['GIT_COMMITTER_'+suffix]=value
    return identity

def policy(worktree, scratch, common_git=None, runtime_binary=None, identity=None):
    fs={':root':'deny',':minimal':'read',':tmpdir':'deny',':slash_tmp':'deny',str(scratch):'write'}
    # The owner authorizes branches and commits in this exact repository.
    # Keep Git configuration/hooks read-only: neither operation needs to change them.
    for metadata in {worktree/'.git',common_git} - {None}:
        fs[str(metadata)]='read' if metadata.is_file() else 'write'
        if metadata.is_dir():
            fs[str(metadata/'config')]='read'
            fs[str(metadata/'hooks')]='read'
    fs[str(worktree/'.env')]='deny'
    # Never let an automatic ticket rewrite the trusted receiver/executor itself.
    if ROOT.is_relative_to(worktree):
        fs[str(ROOT)]='read'
        fs[str(ROOT.parent/'.codex')]='read'
    # Exact deny roots remain protected even when a user registers a broad parent folder.
    fs[str(Path.home()/'.config/atelier')]='deny'
    fs[str(Path.home()/'.codex')]='deny'
    fs[str(Path.home()/'.ssh')]='deny'
    # The standalone CLI can live under ~/.codex and must re-enter its own
    # executable after bubblewrap starts. Expose this exact binary only, not
    # the surrounding credentials, sessions, configuration or plugins.
    if runtime_binary: fs[str(Path(runtime_binary).resolve())]='read'
    options={
        'approval_policy':'never','default_permissions':'atelier','allow_login_shell':False,
        'web_search':'disabled','project_doc_max_bytes':0,
        'permissions.atelier.extends':':workspace',
        'permissions.atelier.network.enabled':False,
        'shell_environment_policy.inherit':'none','shell_environment_policy.experimental_use_profile':False,
        # Without PATH the sandbox helper cannot locate distro bwrap and uses
        # its bundled helper, which lacks Ubuntu's /usr/bin/bwrap profile.
        'shell_environment_policy.set':{'PATH':'/usr/local/bin:/usr/bin:/bin',
            'GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'core.hooksPath','GIT_CONFIG_VALUE_0':'/dev/null',
            'GIT_CONFIG_KEY_1':'core.fsmonitor','GIT_CONFIG_VALUE_1':'false',**(identity or {})},
        'projects':{str(worktree):{'trust_level':'untrusted'}},
        'permissions.atelier.filesystem':fs,
        'mcp_servers':{},
    }
    options.update({f'features.{k}':False for k in FEATURES})
    # Codex splits override keys on dots; quoted path segments are not TOML keys
    # there. Use inline TOML tables so .git, dotted/quoted paths and MCP names
    # remain intact. Replacing the whole MCP table also avoids creating invalid
    # disabled server entries without a transport when user config is ignored.
    def toml_value(value):
        if isinstance(value,dict):
            return '{'+', '.join(json.dumps(k,ensure_ascii=False)+' = '+toml_value(v) for k,v in value.items())+'}'
        return json.dumps(value,ensure_ascii=False)
    args=[]
    for k,v in options.items(): args += ['-c', k+'='+toml_value(v)]
    return args

def codex_binary():
    p=shutil.which('codex')
    if not p: raise ExecutionError('Codex CLI absent. Installez-le et connectez-vous avec codex login.')
    source=Path(p).resolve()
    # A standalone installation under the denied credentials directory cannot
    # re-enter its executable inside bubblewrap. Use an identical private copy
    # outside ~/.codex; never reopen the credentials directory to solve this.
    if source.is_relative_to(Path.home()/'.codex'):
        return str(runtime_binary(source))
    return str(source)

def runtime_binary(source, root=STATE/'runtime'):
    def digest(path):
        with path.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
    expected=digest(source)
    folder=root/expected
    if root.is_symlink() or folder.is_symlink(): raise ExecutionError('Le cache Codex ne doit pas être un lien symbolique.')
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    # Standalone releases contain a tool host and execution server beside Codex.
    # Copy only these known executables, never configuration or credentials.
    sources={'codex':source}
    for name in ('codex-code-mode-host','codex-exec-server'):
        helper=source.parent/name
        if helper.is_file(): sources[name]=helper
    for name,original in sources.items():
        target=folder/name
        if target.is_symlink(): raise ExecutionError('Le binaire Codex privé ne doit pas être un lien symbolique.')
        checksum=expected if name=='codex' else digest(original)
        if target.exists() and digest(target)==checksum:
            target.chmod(0o500)
            continue
        fd,temporary=tempfile.mkstemp(prefix='.'+name+'-',dir=folder)
        try:
            with os.fdopen(fd,'wb') as dest, original.open('rb') as src:
                shutil.copyfileobj(src,dest)
                os.fchmod(dest.fileno(),0o500)
            if digest(Path(temporary))!=checksum: raise ExecutionError('Le binaire Codex a changé pendant sa préparation. Relancez le diagnostic.')
            os.replace(temporary,target)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    return folder/'codex'

def preflight(binary=None):
    """Real, non-inference sandbox probe, with a harmless private canary."""
    binary=binary or codex_binary()
    with tempfile.TemporaryDirectory(prefix='atelier-check-') as parent:
        base=Path(parent);work=base/'work';work.mkdir();scratch=work/'tmp';scratch.mkdir()
        secret=base/'private-canary';secret.write_text('not-a-real-secret')
        (work/'.git').mkdir();(work/'.git/config').write_text('canary')
        (work/'.env').write_text('not-a-real-secret')
        script="""import pathlib,socket,sys
w=pathlib.Path.cwd()
(w/'allowed').write_text('ok')
(w/'.git/HEAD').write_text('branch-canary')
for path in [sys.argv[1],str(w/'.env'),str(w/'.git/config')]:
 try:
  if path==str(w/'.git/config'): pathlib.Path(path).write_text('forbidden')
  else: pathlib.Path(path).read_text()
 except (OSError,PermissionError): pass
 else: raise SystemExit(21)
try:
 with socket.socket() as s:
  s.settimeout(1)
  s.connect(('127.0.0.1',int(sys.argv[2])))
except OSError:pass
else:raise SystemExit(22)
print('ATELIER_SANDBOX_OK')
"""
        # A loopback-only canary proves the host endpoint is reachable before checking
        # that sandbox commands cannot reach it. Internet outages cannot yield a false pass.
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen(2)
            port=listener.getsockname()[1]
            with socket.create_connection(('127.0.0.1',port),timeout=1):pass
            cmd=[binary,'sandbox','-P','atelier','-C',str(work),*policy(work,scratch,runtime_binary=binary),'/usr/bin/python3','-c',script,str(secret),str(port)]
            try:
                r=subprocess.run(cmd,env=clean_env(),capture_output=True,text=True,timeout=20)
            except subprocess.TimeoutExpired:
                raise ExecutionError('Isolation Codex indisponible : le contrôle dépasse 20 secondes. Run reste désactivé.') from None
        if r.returncode or 'ATELIER_SANDBOX_OK' not in r.stdout:
            # Do not copy raw CLI output/configuration (potential credentials) to
            # service logs or callers. Report a useful, fixed diagnostic instead.
            reason=f'le contrôle a échoué (code {r.returncode})'
            if 'invalid transport' in r.stderr or 'filesystem path' in r.stderr:
                reason='la configuration transmise à Codex est invalide ; le script doit être corrigé'
            elif 'bwrap: execvp' in r.stderr:
                reason='un exécutable requis est inaccessible dans le profil d’isolation'
            elif 'bwrap:' in r.stderr and ('Operation not permitted' in r.stderr or 'Permission denied' in r.stderr):
                reason='Ubuntu refuse bubblewrap ; vérifiez le chargement du profil AppArmor'
            elif r.returncode==21:
                reason='la protection des fichiers privés ou des métadonnées Git a échoué'
            elif r.returncode==22:
                reason='le réseau des commandes reste accessible'
            raise ExecutionError(f'Isolation Codex indisponible : {reason}. Run reste désactivé.')
    return True

class ProcessLock:
    def __init__(self,path):
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.file=path.open('a');os.chmod(path,0o600)
        try:fcntl.flock(self.file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.file.close();raise ExecutionError('Une session Atelier utilise déjà ce PC.')
    def close(self):self.file.close()

class TicketExecutor:
    def __init__(self,gateway,registry=CONFIG,state=STATE):
        self.gateway=gateway;self.registry=registry;self.state=state
        self.process=None;self.job=None;self.folder=None;self.log=None;self.lock=None
        self.phase='Examen du dépôt';self.completed=None;self.last_pulse=0;self.last_contact=0
        self.watch_stop=threading.Event();self.watchdog=None;self.watchdog_tripped=False

    def start(self,job):
        if self.process: raise ExecutionError('Une session Codex est déjà active')
        model=job.get('codex_model');effort=job.get('reasoning_effort')
        if not validate_selection(available_models(),model,effort):
            raise ExecutionError('Modèle ou effort Codex indisponible. Actualisez Atelier et choisissez à nouveau avant Run.')
        rid=str(uuid.UUID(job['id']))
        repo=next((r for r in read_registry(self.registry) if r['id']==job['repository_id']),None)
        if not repo:raise ExecutionError('Dépôt absent du registre local')
        source=Path(repo['path'])
        if source.resolve()!=source or not source.is_dir(): raise ExecutionError('Le chemin autorisé a changé')
        initializing=repo.get('initialize',False) and not (source/'.git').exists()
        if not initializing and ((source/'.git').is_symlink() or not (source/'.git').is_dir()):
            raise ExecutionError('Le dépôt doit posséder son propre dossier .git, sans lien symbolique.')
        if not initializing and git(source,'rev-parse','--show-toplevel')!=str(source): raise ExecutionError('Le chemin autorisé a changé')
        binary=codex_binary();preflight(binary)
        self.lock=ProcessLock(self.state/'codex.lock')
        folder=self.state/rid
        try:
            # Never relaunch an uncertain/crashed job, even if a request is duplicated.
            folder.mkdir(parents=True,mode=0o700,exist_ok=False)
            self.folder=folder;self.job=job
            work=source
            try:base=None if initializing else git(work,'rev-parse','HEAD')
            except ExecutionError:
                if not repo.get('initialize',False):raise
                base=None
            common=work/'.git' if initializing else Path(git(work,'rev-parse','--path-format=absolute','--git-common-dir'))
            if common.resolve()!=work/'.git':raise ExecutionError('Les métadonnées Git doivent rester dans le dépôt choisi.')
            branch=None if base is None else git(work,'rev-parse','--abbrev-ref','HEAD')
            scratch=folder/'tmp';scratch.mkdir(mode=0o700)
            private_json(folder/'schema.json',SCHEMA)
            private_json(folder/'receipt.json',{'id':rid,'repository':repo['id'],'branch':branch,'base_commit':base,'worktree':str(work),'status':'started','codex_model':model,'reasoning_effort':effort})
            # The role is versioned beside the service, outside the model's writable directory.
            role=tomllib.loads((ROOT.parent/'.codex/agents/atelier-ticket.toml').read_text())['developer_instructions']
            prompt=role+'\n\nDemande explicite de l’utilisateur (données JSON) :\n'+json.dumps({
                'project':job.get('project_name',''),'ticket':job['ticket_snapshot'],
                'related_tickets':job.get('related_tickets',[]),'repository_path':str(source),
                'branch_before':branch,'initialize_git':initializing},ensure_ascii=False)
            cmd=[binary,'--no-daemon','exec','--ignore-user-config','--ignore-rules','--strict-config',
                 '--model',model,'-c','model_reasoning_effort='+json.dumps(effort),'-c','model_provider="openai"',
                 '--json','--output-schema',str(folder/'schema.json'),'--output-last-message',str(folder/'report.json'),
                 '-C',str(work),*policy(work,scratch,common,runtime_binary=binary,identity=git_identity(work)),'-']
            if initializing: cmd.insert(3,'--skip-git-repo-check')
            self.log=(folder/'events.jsonl').open('wb');os.chmod(folder/'events.jsonl',0o600)
            if not self.gateway.rpc('worker_development_pulse',{'p_id':job['id'],'p_lease':job['lease'],'p_phase':'Préparation vérifiée ; démarrage Codex'}):
                raise ExecutionError('Demande annulée ou accès retiré pendant la préparation')
            self.process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=self.log,stderr=self.log,env=clean_env(),start_new_session=True)
            self.process.stdin.write(prompt.encode());self.process.stdin.close()
            self.last_pulse=self.last_contact=time.monotonic();self.completed=None
            self.watch_stop.clear();self.watchdog_tripped=False
            self.watchdog=threading.Thread(target=self.watch,daemon=True,name='atelier-codex-watchdog')
            self.watchdog.start()
        except Exception:
            self.close()
            raise

    def watch(self):
        # Independent of the event loop: even a blocked/failing heartbeat RPC cannot
        # prevent process termination after the authorization lease is lost.
        while not self.watch_stop.wait(1):
            if time.monotonic()-self.last_contact>60:
                self.watchdog_tripped=True
                self.stop()
                return

    def stop(self):
        proc=self.process
        if proc:
            try:os.killpg(proc.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                proc.wait(timeout=3)

    def close(self):
        self.watch_stop.set()
        if self.watchdog and self.watchdog is not threading.current_thread():self.watchdog.join(timeout=4)
        self.stop()
        if self.log:self.log.close()
        if self.lock:self.lock.close()
        self.process=None;self.log=None;self.lock=None;self.job=None;self.completed=None;self.watchdog=None

    def result(self):
        receipt=json.loads((self.folder/'receipt.json').read_text())
        report={'summary':'La session s’est arrêtée sans compte rendu valide. Consultez les journaux sur le PC.','tests':[],'limitations':[]}
        error=None
        try:
            p=self.folder/'report.json'
            if p.stat().st_size>30000:raise ValueError()
            value=json.loads(p.read_text())
            if set(value)!=set(SCHEMA['required']) or not isinstance(value['summary'],str) or len(value['summary'])>8000:raise ValueError()
            for key in ('tests','limitations'):
                if not isinstance(value[key],list) or len(value[key])>40 or any(not isinstance(x,str) or len(x)>2000 for x in value[key]):raise ValueError()
            if len(json.dumps(value).encode())>25000:raise ValueError()
            report=value
            if self.process.returncode: error='Codex a terminé en erreur. Vérifiez le compte rendu et le travail local.'
        except (OSError,ValueError,KeyError):error='La session Codex ne fournit pas de résultat vérifiable.'
        report.update({k:receipt[k] for k in ('branch','worktree','base_commit','codex_model','reasoning_effort')})
        work=Path(receipt['worktree'])
        try:
            report['branch']=git(work,'rev-parse','--abbrev-ref','HEAD')
            report['changes']=git(work,'status','--short')
            if receipt['base_commit']:
                report['changes']+='\n'+git(work,'diff','--stat',receipt['base_commit'])
            report['changes']=report['changes'][:4000]
        except ExecutionError:
            report['changes']='État Git indisponible ; vérifiez le dépôt local.'
        if report.get('branch') is None:report.pop('branch',None)
        private_json(self.folder/'delivery.json',{'result':report,'error':error})
        return report,error

    def tick(self):
        if not self.process:return False
        now=time.monotonic()
        if self.watchdog_tripped or now-self.last_contact>60:
            self.stop();self.close();raise ExecutionError('Connexion perdue : session arrêtée ; travail local conservé.')
        if now-self.last_pulse>=10:
            self.last_pulse=now
            ok=self.gateway.rpc('worker_development_pulse',{'p_id':self.job['id'],'p_lease':self.job['lease'],'p_phase':self.phase})
            self.last_contact=now
            if not ok:self.close();return True
        if self.process.poll() is None:
            # Fixed public phase; raw tool output stays local, never copied into notifications.
            self.phase='Codex travaille et vérifie les changements'
            if self.folder and (self.folder/'events.jsonl').stat().st_size>20_000_000:
                self.stop()
            else:return False
        if self.completed is None:self.completed=self.result()
        result,error=self.completed
        self.gateway.rpc('worker_development_finish',{'p_id':self.job['id'],'p_lease':self.job['lease'],'p_result':result,'p_error':error})
        self.close();return True

def main():
    p=argparse.ArgumentParser(description='Dépôts autorisés pour Atelier ; aucune clé API IA nécessaire.')
    sub=p.add_subparsers(dest='command',required=True)
    add=sub.add_parser('add');add.add_argument('path');add.add_argument('--label',default='')
    remove=sub.add_parser('remove');remove.add_argument('id')
    sub.add_parser('list');sub.add_parser('doctor')
    args=p.parse_args()
    try:
        if args.command=='add':print(json.dumps(add_repository(args.path,args.label),ensure_ascii=False,indent=2))
        elif args.command=='list':print(json.dumps(read_registry(),ensure_ascii=False,indent=2))
        elif args.command=='remove':
            for registry in (CONFIG,REMOTE_CONFIG):
                if registry.exists():private_json(registry,[r for r in read_registry(registry,include_web=False) if r['id']!=str(uuid.UUID(args.id))])
            print('Dépôt retiré. Le service actualisera son registre.')
        else:
            print(subprocess.run([codex_binary(),'--version'],capture_output=True,text=True,check=True).stdout.strip())
            preflight();print('Isolation vérifiée : branches et commits autorisés, secrets et configuration Git protégés, réseau des commandes bloqué.')
    except (ExecutionError,ValueError,OSError,subprocess.SubprocessError) as e:
        print(str(e));raise SystemExit(1)

if __name__=='__main__':main()
