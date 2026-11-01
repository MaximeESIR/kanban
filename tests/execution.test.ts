import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, it, expect } from 'vitest'
const A = '10000000-0000-4000-8000-000000000001',
  B = '10000000-0000-4000-8000-000000000002',
  W = '10000000-0000-4000-8000-000000000003'
const P = crypto.randomUUID(),
  R = crypto.randomUUID()
let db: PGlite
async function as(id: string, aal = 'aal2') {
  await db.exec('reset role')
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id, JSON.stringify({ aal })],
  )
  await db.exec('set role authenticated')
}
async function rpc(name: string, values: any[] = []) {
  return (
    await db.query<any>(
      `select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) result`,
      values,
    )
  ).rows[0].result
}
async function ticket() {
  await as(A)
  return (
    await db.query<any>('insert into public.tickets(project_id,title) values($1,$2) returning *', [
      P,
      'Installer Jetson',
    ])
  ).rows[0]
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema public,auth to anon,authenticated;insert into auth.users values('${A}'),('${B}'),('${W}');`,
  )
  for (const name of [
    '001_atelier',
    '002_connected_workspace',
    '003_ticket_relations',
    '004_worker_heartbeat',
    '005_ticket_execution',
  ])
    await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'))
  await db.exec(
    `insert into private.atelier_owners(user_id) values('${A}'),('${B}');insert into private.workers(user_id,owner_id) values('${W}','${A}');insert into public.projects(id,owner_id,name) values('${P}','${A}','Projet');`,
  )
  await as(W, 'aal1')
  await rpc('worker_repository_sync', [
    [{ id: R, label: 'Projet local', path: '/test/repo', enabled: true }],
  ])
  await rpc('worker_heartbeat', [[]])
  await as(A)
  await rpc('bind_project_repository', [P, R])
}, 30000)
afterAll(async () => {
  await db.close()
})
it('isolates repositories, runs and notifications; no worker credentials confer owner access', async () => {
  await as(B)
  for (const table of [
    'worker_repositories',
    'project_repositories',
    'development_runs',
    'atelier_events',
  ])
    expect((await db.query(`select * from ${table}`)).rows).toEqual([])
  await as(A, 'aal1')
  await expect(rpc('bind_project_repository', [P, R])).rejects.toThrow('Accès refusé')
  await as(W, 'aal1')
  expect((await db.query('select * from worker_repositories')).rows).toEqual([])
  await expect(
    rpc('submit_development', [crypto.randomUUID(), crypto.randomUUID(), new Date().toISOString()]),
  ).rejects.toThrow('Accès refusé')
  await expect(db.query("update public.development_runs set status='approved'")).rejects.toThrow(
    'permission denied',
  )
})
it('claims once, enters in_progress, only human approval marks Done', async () => {
  const t = await ticket(),
    id = crypto.randomUUID()
  expect(await rpc('submit_development', [id, t.id, t.updated_at])).toBe(id)
  expect(await rpc('submit_development', [id, t.id, t.updated_at])).toBe(id)
  await as(W, 'aal1')
  const j = await rpc('worker_development_claim', [[R]])
  expect(j.id).toBe(id)
  expect(await rpc('worker_development_claim', [[R]])).toBe(null)
  expect(
    (await db.query<any>('select kind from atelier_events')).rows.every((x) => x.kind === 'jobs'),
  ).toBe(true)
  expect(await rpc('worker_development_pulse', [id, crypto.randomUUID(), 'forged'])).toBe(false)
  expect(await rpc('worker_development_pulse', [id, j.lease, 'Tests'])).toBe(true)
  await as(A)
  await expect(db.query("update tickets set status='done' where id=$1", [t.id])).rejects.toThrow(
    'session Codex',
  )
  await as(W, 'aal1')
  await expect(
    rpc('worker_development_finish', [id, j.lease, { summary: 'Bad', tests: 'wrong' }, null]),
  ).rejects.toThrow('Vérifications invalides')
  expect(
    await rpc('worker_development_finish', [
      id,
      j.lease,
      { summary: 'Implémenté', tests: ['2 tests OK'] },
      null,
    ]),
  ).toBe(true)
  await expect(rpc('approve_development', [id, j.ticket_version])).rejects.toThrow('Accès refusé')
  await as(A)
  expect(
    (await db.query<any>('select status from tickets where id=$1', [t.id])).rows[0].status,
  ).toBe('in_progress')
  expect(
    (await db.query<any>('select status from development_runs where id=$1', [id])).rows[0].status,
  ).toBe('review')
  await rpc('approve_development', [id, j.ticket_version])
  expect(
    (await db.query<any>('select status from tickets where id=$1', [t.id])).rows[0].status,
  ).toBe('done')
})
it('rejects stale and blocked tickets, cancels queued/running and rejects late completion', async () => {
  const t = await ticket(),
    id = crypto.randomUUID()
  await expect(rpc('submit_development', [id, t.id, '2000-01-01T00:00:00Z'])).rejects.toThrow(
    'Actualisez',
  )
  await rpc('submit_development', [id, t.id, t.updated_at])
  await as(W)
  const j = await rpc('worker_development_claim', [[R]])
  await as(A)
  await rpc('cancel_development', [id])
  await as(W)
  expect(await rpc('worker_development_pulse', [id, j.lease, 'Tests'])).toBe(false)
  expect(await rpc('worker_development_finish', [id, j.lease, { summary: 'Late' }, null])).toBe(
    false,
  )
  const blocker = await ticket(),
    child = await ticket()
  const changed = (
    await db.query<any>('update tickets set prerequisite_ids=$1 where id=$2 returning *', [
      [blocker.id],
      child.id,
    ])
  ).rows[0]
  await expect(
    rpc('submit_development', [crypto.randomUUID(), child.id, changed.updated_at]),
  ).rejects.toThrow('prérequis')
})
it('does not run silently when a queued ticket changes and does not accept revoked workers', async () => {
  const t = await ticket(),
    id = crypto.randomUUID()
  await rpc('submit_development', [id, t.id, t.updated_at])
  await db.query("update tickets set title='Changed' where id=$1", [t.id])
  await as(W)
  expect(await rpc('worker_development_claim', [[R]])).toBe(null)
  await as(A)
  expect(
    (await db.query<any>('select status from development_runs where id=$1', [id])).rows[0].status,
  ).toBe('failed')
  await db.exec(`reset role;update private.workers set enabled=false where user_id='${W}'`)
  await as(W)
  await expect(rpc('worker_development_claim', [[R]])).rejects.toThrow('non autorisé')
  expect((await db.query('select * from atelier_events')).rows).toEqual([])
  await db.exec(`reset role;update private.workers set enabled=true where user_id='${W}'`)
})

it('expires abandoned sessions during heartbeat without replaying them; manual Done acknowledges review', async () => {
  const t = await ticket(),
    id = crypto.randomUUID()
  await rpc('submit_development', [id, t.id, t.updated_at])
  await as(W)
  const job = await rpc('worker_development_claim', [[R]])
  await db.exec('reset role')
  await db.query(
    "update development_runs set heartbeat_at=now()-interval '100 seconds' where id=$1",
    [id],
  )
  await as(W)
  await rpc('worker_heartbeat', [[]])
  expect(await rpc('worker_development_finish', [id, job.lease, { summary: 'Late' }, null])).toBe(
    false,
  )
  await as(A)
  expect(
    (await db.query<any>('select status from development_runs where id=$1', [id])).rows[0].status,
  ).toBe('failed')
  const t2 = await ticket(),
    id2 = crypto.randomUUID()
  await rpc('submit_development', [id2, t2.id, t2.updated_at])
  await as(W)
  const j2 = await rpc('worker_development_claim', [[R]])
  await rpc('worker_development_finish', [
    id2,
    j2.lease,
    { summary: 'Ready', tests: [], limitations: [] },
    null,
  ])
  await as(A)
  await db.query("update tickets set status='done' where id=$1", [t2.id])
  expect(
    (await db.query<any>('select status from development_runs where id=$1', [id2])).rows[0].status,
  ).toBe('approved')
})

it('allows account deletion cascades without re-creating orphan notifications', async () => {
  await db.exec('reset role')
  await db.query('delete from auth.users where id=$1', [A])
  expect((await db.query('select * from atelier_events where owner_id=$1', [A])).rows).toEqual([])
})
