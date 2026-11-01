import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest'
const A = '10000000-0000-4000-8000-000000000001'
const B = '10000000-0000-4000-8000-000000000002'
const W = '10000000-0000-4000-8000-000000000003'
const W2 = '10000000-0000-4000-8000-000000000004'
let db: PGlite
async function as(id: string, aal = 'aal2') {
  await db.exec('reset role')
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id, JSON.stringify({ aal })],
  )
  await db.exec('set role authenticated')
}
async function rpc(name: string, values: unknown[] = []) {
  return (
    await db.query<{ result: any }>(
      `select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) result`,
      values,
    )
  ).rows[0].result
}
async function report(
  provider = 'local',
  revision = 0,
  configured = false,
  unloaded = false,
  state = 'ready',
) {
  await as(W, 'aal1')
  return rpc('worker_assistant_report', [
    revision,
    provider,
    state,
    configured,
    unloaded,
    null,
    state === 'ready' ? ['rewrite', 'transcribe', 'search', 'summarize'] : [],
  ])
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema public,auth to anon,authenticated;insert into auth.users values('${A}'),('${B}'),('${W}'),('${W2}');`,
  )
  for (const name of [
    '001_atelier',
    '002_connected_workspace',
    '003_ticket_relations',
    '004_worker_heartbeat',
    '005_ticket_execution',
    '006_codex_selection',
    '007_repository_paths',
    '008_assistant_providers',
  ])
    await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'))
  await db.exec(
    `insert into private.atelier_owners(user_id) values('${A}'),('${B}');insert into private.workers(user_id,owner_id) values('${W}','${A}'),('${W2}','${A}');`,
  )
}, 30000)
beforeEach(async () => {
  await db.exec(
    "reset role;delete from public.ai_jobs;delete from private.assistant_preferences;update private.workers set enabled=true,capabilities=array['rewrite','transcribe','search','summarize'],last_seen=now(),assistant_provider=null,assistant_revision=-1,assistant_state='pending',groq_configured=false,local_models_unloaded=false,assistant_error=null;",
  )
})
afterAll(async () => {
  await db.close()
})
it('publishes new capabilities atomically when returning from Groq to audio-only local', async () => {
  await as(A)
  await rpc('set_assistant_provider', ['groq'])
  await report('groq', 1, true, true)
  await as(A)
  await rpc('set_assistant_provider', ['local'])
  await as(W, 'aal1')
  expect(
    await rpc('worker_assistant_report', [2, 'local', 'ready', true, false, null, ['transcribe']]),
  ).toBe(true)
  await as(A)
  await expect(
    rpc('submit_job', [crypto.randomUUID(), 'summarize', { text: 'Do not queue this' }, 'local']),
  ).rejects.toThrow('indisponible')
  expect(await rpc('submit_job', [crypto.randomUUID(), 'transcribe', {}, 'local'])).toBeTruthy()
})
it('requires MFA for provider changes, separates workers, and keeps preferences private', async () => {
  await as(A, 'aal1')
  await expect(rpc('set_assistant_provider', ['groq'])).rejects.toThrow('Accès refusé')
  await expect(rpc('assistant_settings')).rejects.toThrow('Accès refusé')
  await as(W, 'aal1')
  await expect(rpc('set_assistant_provider', ['groq'])).rejects.toThrow('Accès refusé')
  await expect(db.query('select * from private.assistant_preferences')).rejects.toThrow(
    'permission denied',
  )
  await as(B)
  expect((await rpc('assistant_settings')).pcs).toEqual([])
  await expect(rpc('worker_assistant_settings')).rejects.toThrow('non autorisé')
  await as(A)
  await rpc('set_assistant_provider', ['groq'])
  await as(B)
  expect((await rpc('assistant_settings')).provider).toBe('local')
})
it('defaults to local and only advertises capabilities after worker confirmation', async () => {
  await as(A)
  expect((await rpc('assistant_settings')).provider).toBe('local')
  expect(
    (await db.query<any>('select * from public.pc_status()')).rows.every(
      (p) => p.capabilities.length === 0,
    ),
  ).toBe(true)
  expect(await report()).toBe(true)
  await as(A)
  const id = crypto.randomUUID()
  expect(await rpc('submit_job', [id, 'rewrite', { text: 'Private note' }])).toBe(id)
  await as(W, 'aal1')
  const j = await rpc('worker_poll', [['rewrite']])
  expect(j.provider).toBe('local')
  expect(j.id).toBe(id)
})
it('requires no outstanding requests before changing destination and rejects stale acknowledgements', async () => {
  await report()
  await as(A)
  const id = crypto.randomUUID()
  await rpc('submit_job', [id, 'rewrite', { text: 'Keep local' }, 'local'])
  await expect(rpc('set_assistant_provider', ['groq'])).rejects.toThrow('annulez')
  await as(W, 'aal1')
  await rpc('worker_poll', [['rewrite'], 'local'])
  await as(A)
  await expect(rpc('set_assistant_provider', ['groq'])).rejects.toThrow('annulez')
  await rpc('cancel_job', [id])
  await rpc('set_assistant_provider', ['groq'])
  expect(await report()).toBe(false)
  await as(A)
  const prefs = await rpc('assistant_settings')
  expect(prefs.provider).toBe('groq')
  expect(prefs.revision).toBe(1)
  expect(prefs.pcs.every((p: any) => p.state === 'pending')).toBe(true)
  await expect(rpc('submit_job', [crypto.randomUUID(), 'rewrite', {}, 'groq'])).rejects.toThrow(
    'en attente',
  )
})
it('never silently upgrades old local clients to cloud or accepts forged readiness', async () => {
  await as(A)
  await rpc('set_assistant_provider', ['groq'])
  await expect(report('groq', 1, false, true)).rejects.toThrow('clé configurée')
  await expect(report('groq', 1, true, false)).rejects.toThrow('déchargés')
  expect(await report('groq', 1, false, true, 'blocked')).toBe(true)
  await as(A)
  await expect(rpc('submit_job', [crypto.randomUUID(), 'rewrite', {}, 'groq'])).rejects.toThrow(
    'indisponible',
  )
  await report('groq', 1, true, true)
  await as(A)
  await expect(
    rpc('submit_job', [crypto.randomUUID(), 'rewrite', { text: 'old client' }]),
  ).rejects.toThrow('moteur a changé')
})
it('pins the destination to each job and only allows a ready matching worker to claim it', async () => {
  await as(A)
  await rpc('set_assistant_provider', ['groq'])
  await report('groq', 1, true, true)
  await as(A)
  const id = crypto.randomUUID()
  await rpc('submit_job', [id, 'rewrite', { text: 'Cloud allowed' }, 'groq'])
  expect(await rpc('submit_job', [id, 'rewrite', { text: 'retry' }, 'groq'])).toBe(id)
  await expect(rpc('submit_job', [id, 'rewrite', {}, 'local'])).rejects.toThrow('autre moteur')
  await as(W2, 'aal1')
  expect(await rpc('worker_poll', [['rewrite'], 'groq'])).toBe(null)
  await as(W, 'aal1')
  expect(await rpc('worker_poll', [['rewrite']])).toBe(null)
  const job = await rpc('worker_poll', [['rewrite'], 'groq'])
  expect(job.id).toBe(id)
  expect(job.provider).toBe('groq')
  expect(await rpc('worker_poll', [['rewrite'], 'groq'])).toBe(null)
  expect(await rpc('worker_finish', [id, job.lease, { text: 'Ready' }, null])).toBe(true)
})
it('returns to local without reusing cloud readiness and preserves the recorded destination', async () => {
  await as(A)
  await rpc('set_assistant_provider', ['groq'])
  await report('groq', 1, true, true)
  await as(A)
  const id = crypto.randomUUID()
  await rpc('submit_job', [id, 'rewrite', { text: 'Cloud allowed' }, 'groq'])
  await as(W, 'aal1')
  const job = await rpc('worker_poll', [['rewrite'], 'groq'])
  await rpc('worker_finish', [id, job.lease, { text: 'Ready' }, null])
  await as(A)
  await rpc('set_assistant_provider', ['local'])
  expect(await report('groq', 1, true, true)).toBe(false)
  expect(await report('local', 2, true, false)).toBe(true)
  await as(A)
  expect(
    (await db.query<any>('select provider from ai_jobs where id=$1', [id])).rows[0].provider,
  ).toBe('groq')
  await rpc('submit_job', [crypto.randomUUID(), 'rewrite', { text: 'Local again' }, 'local'])
})
it('does not loop realtime notifications for identical reports and cannot report after revocation', async () => {
  await report()
  await as(A)
  const before = (await db.query<any>("select revision from atelier_events where kind='jobs'"))
    .rows[0].revision
  await report()
  await as(A)
  expect(
    (await db.query<any>("select revision from atelier_events where kind='jobs'")).rows[0].revision,
  ).toBe(before)
  const event = (await db.query<any>("select * from atelier_events where kind='jobs'")).rows[0]
  expect(Object.keys(event).sort()).toEqual(['kind', 'owner_id', 'revision'])
  await db.exec(`reset role;update private.workers set enabled=false where user_id='${W}'`)
  await expect(report()).rejects.toThrow('non autorisé')
})
