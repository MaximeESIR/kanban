"""Small, validated model catalogue; never accepts CLI flags from the web."""
import json
import re
import subprocess
import time

# Ultra delegates work automatically, incompatible with Atelier's single-agent contract.
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')

def normalize_catalog(data):
    out=[];seen=set()
    for model in data.get('models', []):
        slug=model.get('slug', '')
        if model.get('visibility') != 'list' or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}', slug) or slug in seen:
            continue
        levels=[e for e in EFFORTS if any(r.get('effort')==e for r in model.get('supported_reasoning_levels', []))]
        if not levels: continue
        default=model.get('default_reasoning_level')
        out.append({'id':slug, 'label':str(model.get('display_name') or slug)[:100],
                    'efforts':levels, 'default_effort':default if default in levels else levels[0]})
        seen.add(slug)
        if len(out)==50: break
    return out

class ModelCatalog:
    def __init__(self):
        self.models=[];self.checked=float('-inf')

    def get(self, binary, env):
        if time.monotonic()-self.checked>=300:
            self.checked=time.monotonic()
            try:
                executable=binary() if callable(binary) else binary
                result=subprocess.run([executable,'--no-daemon','debug','models','-c','model_provider="openai"'],
                    env=env,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
                if result.returncode: raise ValueError('Catalog unavailable')
                self.models=normalize_catalog(json.loads(result.stdout))
            except (OSError, ValueError, TypeError, AttributeError, subprocess.TimeoutExpired):
                self.models=[]
                print('Catalogue Codex indisponible ; Run attend un catalogue valide.',flush=True)
        return self.models

def validate_selection(models, model, effort):
    return isinstance(model,str) and isinstance(effort,str) and any(
        m['id']==model and effort in m['efforts'] for m in models)
