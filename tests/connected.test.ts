import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, it, expect } from 'vitest'
const A = '10000000-0000-4000-8000-000000000001',
  B = '10000000-0000-4000-8000-000000000002',
  W = '10000000-0000-4000-8000-000000000003'
let db: PGlite
async function as(id: string, aal = 'aal2') {
  await db.exec('reset role')
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id, JSON.stringify({ aal })],
  )
  await db.exec('set role authenticated')
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema public,auth to anon,authenticated;insert into auth.users values('${A}'),('${B}'),('${W}');`,
  )
  for (const name of ['001_atelier.sql', '002_connected_workspace.sql'])
    await db.exec(
      await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'),
    )
  await db.exec(
    `insert into private.atelier_owners(user_id) values('${A}'),('${B}');insert into private.workers(user_id,owner_id) values('${W}','${A}');`,
  )
}, 30000)
afterAll(async () => {
  await db.close()
})
it('requires MFA for data and denies direct worker access', async () => {
  await as(A, 'aal1')
  expect((await db.query('select public.can_access_atelier() ok')).rows).toEqual([{ ok: false }])
  await expect(db.query("insert into public.notes(content) values('attack')")).rejects.toThrow()
  await as(W)
  expect((await db.query('select * from public.notes')).rows).toEqual([])
  await expect(
    db.query("select public.submit_job(gen_random_uuid(),'rewrite','{}')"),
  ).rejects.toThrow()
})
it('claims only owned jobs and rejects forged completion, unsupported actions and late results', async () => {
  await as(A)
  await expect(
    db.query("select public.submit_job(gen_random_uuid(),'rewrite','{}')"),
  ).rejects.toThrow('indisponible')
  await as(W, 'aal1')
  await db.query("select public.worker_poll(array['rewrite'])")
  await as(A)
  const id = crypto.randomUUID()
  await db.query('select public.submit_job($1,$2,$3)', [
    id,
    'rewrite',
    { text: 'Texte', prompt: 'Court' },
  ])
  await expect(
    db.query("select public.submit_job(gen_random_uuid(),'shell','{}')"),
  ).rejects.toThrow()
  await as(B)
  expect((await db.query('select * from public.ai_jobs')).rows).toHaveLength(0)
  await expect(db.query("select public.worker_poll(array['rewrite'])")).rejects.toThrow()
  await as(W, 'aal1')
  const claimed = (await db.query<{ job: any }>("select public.worker_poll(array['rewrite']) job"))
    .rows[0].job
  expect(claimed.id).toBe(id)
  expect((await db.query("select public.worker_poll(array['rewrite']) job")).rows).toEqual([
    { job: null },
  ])
  expect(
    (
      await db.query('select public.worker_finish($1,$2,$3,null) ok', [
        id,
        crypto.randomUUID(),
        { text: 'bad' },
      ])
    ).rows,
  ).toEqual([{ ok: false }])
  await as(A)
  await db.query('select public.cancel_job($1)', [id])
  await as(W)
  expect(
    (
      await db.query('select public.worker_finish($1,$2,$3,null) ok', [
        id,
        claimed.lease,
        { text: 'late' },
      ])
    ).rows,
  ).toEqual([{ ok: false }])
})
it('delivers a result, wipes request payload and revokes a worker immediately', async () => {
  await as(A)
  const id = crypto.randomUUID()
  await db.query('select public.submit_job($1,$2,$3)', [id, 'rewrite', { text: 'private' }])
  await as(W, 'aal1')
  const job = (await db.query<{ job: any }>("select public.worker_poll(array['rewrite']) job"))
    .rows[0].job
  expect(
    (
      await db.query('select public.worker_finish($1,$2,$3,null) ok', [
        id,
        job.lease,
        { text: 'résultat' },
      ])
    ).rows,
  ).toEqual([{ ok: true }])
  await as(A)
  const result = (await db.query<any>('select * from public.ai_jobs where id=$1', [id])).rows[0]
  expect(result.status).toBe('done')
  expect(result.input).toEqual({})
  expect(result.result.text).toBe('résultat')
  await db.exec('reset role')
  await db.query('update private.workers set enabled=false where user_id=$1', [W])
  await as(W)
  await expect(db.query("select public.worker_poll(array['rewrite'])")).rejects.toThrow()
  await db.exec('reset role')
  await db.query('update private.workers set enabled=true where user_id=$1', [W])
})
it('idempotent offline writes detect conflicts and never spoof another owner', async () => {
  await as(A)
  const id = crypto.randomUUID(),
    req = crypto.randomUUID()
  const call = (request: string, base: string | null, values: any, remove = false) =>
    db.query<{ r: any }>('select public.sync_write($1,$2,$3,$4,$5,$6) r', [
      request,
      'notes',
      id,
      base,
      remove,
      values,
    ])
  const created = (await call(req, null, { title: 'Offline', content: 'local', owner_id: B }))
    .rows[0].r.row
  expect(created.owner_id).toBe(A)
  expect((await call(req, null, { title: 'tamper' })).rows[0].r.row).toEqual(created)
  const updated = (
    await call(crypto.randomUUID(), created.updated_at, {
      title: 'Second device',
      content: 'remote',
    })
  ).rows[0].r.row
  const conflict = (
    await call(crypto.randomUUID(), created.updated_at, {
      title: 'old',
      content: 'do not overwrite',
    })
  ).rows[0].r
  expect(conflict.conflict).toBe(true)
  expect(conflict.remote_version).toBe(updated.updated_at)
  await as(B)
  await expect(
    call(crypto.randomUUID(), null, { title: 'steal', content: 'bad' }),
  ).rejects.toThrow()
  await as(A)
  await call(crypto.randomUUID(), updated.updated_at, {}, true)
  expect(
    (await call(crypto.randomUUID(), updated.updated_at, { title: 'resurrect', content: 'bad' }))
      .rows[0].r.conflict,
  ).toBe(true)
})
