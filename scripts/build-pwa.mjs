import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}
const files = (await walk('dist')).filter((p) => !p.endsWith('/sw.js')).sort()
const hash = createHash('sha256')
for (const f of files) hash.update(await readFile(f))
const version = hash.digest('hex').slice(0, 16)
// Only the application shell/assets are cached. Auth, API, notes, jobs and audio never enter this cache.
await writeFile(
  'dist/sw.js',
  `
const CACHE='atelier-shell-${version}';
const ASSETS=${JSON.stringify(files.map((f) => './' + f.slice(5)))};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('atelier-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url),base=new URL(self.registration.scope);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
 if(e.request.mode==='navigate'){e.respondWith(caches.open(CACHE).then(c=>c.match(new URL('index.html',base).href,{ignoreVary:true})).then(r=>r||fetch(e.request)));return;}
 if(ASSETS.some(a=>new URL(a,base).href===url.href))e.respondWith(caches.open(CACHE).then(c=>c.match(e.request,{ignoreVary:true})).then(r=>r||fetch(e.request)));
});
`,
)
console.log(`PWA: ${files.length} static assets, version ${version}`)
