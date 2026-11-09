import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, it, expect } from 'vitest'

const A = crypto.randomUUID(),
  B = crypto.randomUUID(),
  W = crypto.randomUUID()
const M = crypto.randomUUID(),
  N = crypto.randomUUID(),
  P = crypto.randomUUID()
const Q = crypto.randomUUID(),
  OTHER = crypto.randomUUID(),
  R = crypto.randomUUID()
let db: PGlite
async function as(id: string, aal = 'aal1') {
  await db.exec('reset role')
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id, JSON.stringify({ aal })],
  )
  await db.exec('set role authenticated')
}
async function rpc(name: string, args: unknown[] = []) {
  return (
    await db.query<any>(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`,
      args,
    )
  ).rows[0].result
}
async function create(values: Record<string, unknown> = {}, project = P) {
  await as(M)
  return (
    await rpc('agent_create_ticket', [
      crypto.randomUUID(),
      project,
      { title: 'Installer Jetson', ...values },
    ])
  ).ticket
}
async function read(ticket: string) {
  return (await rpc('agent_get_ticket', [ticket])).ticket
}
const report = { summary: 'Modification relue', tests: ['Vérification réussie'], limitations: [] }

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;
    insert into auth.users values('${A}'),('${B}'),('${W}'),('${M}'),('${N}');`)
  for (const name of [
    '001_atelier',
    '002_connected_workspace',
    '003_ticket_relations',
    '004_worker_heartbeat',
    '005_ticket_execution',
    '006_codex_selection',
    '007_repository_paths',
    '009_ticket_agents',
  ])
    await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'))
  await db.exec(`insert into private.atelier_owners(user_id) values('${A}'),('${B}');
    insert into private.workers(user_id,owner_id) values('${W}','${A}');
    insert into public.projects(id,owner_id,name) values('${P}','${A}','Autorisé'),('${Q}','${A}','Privé'),('${OTHER}','${B}','Autre propriétaire');
    insert into public.notes(owner_id,title,content) values('${A}','Secret personnel','Ne pas exposer');
    insert into private.ticket_agents(user_id,owner_id,label) values('${M}','${A}','Codex'),('${N}','${A}','Claude');
    insert into private.ticket_agent_projects(agent_id,owner_id,project_id) values('${M}','${A}','${P}'),('${N}','${A}','${P}');`)
  await as(W)
  await rpc('worker_repository_sync', [
    [
      {
        id: R,
        label: 'Dépôt local',
        path: '/test/repo',
        enabled: true,
        codex_models: [
          { id: 'gpt-6.1-sol', label: 'Codex', efforts: ['high'], default_effort: 'high' },
        ],
      },
    ],
  ])
  await rpc('worker_heartbeat', [[]])
  await as(A, 'aal2')
  await rpc('bind_project_repository', [P, R])
}, 30000)
afterAll(async () => {
  await db.close()
})

it('installs 009 without 008 and scopes all reads to the explicit agent projects', async () => {
  const t = await create({ description: 'Le moteur Jetson' })
  const projects = await rpc('agent_list_projects')
  expect(projects.projects.map((p: any) => p.id)).toEqual([P])
  expect(projects.projects[0].repository).toEqual({
    local_path: '/test/repo',
    label: 'Dépôt local',
    enabled: true,
  })
  expect((await rpc('agent_list_tickets', [P])).tickets).toContainEqual(t)
  expect(
    (await rpc('agent_search_tickets', ['moteur JETSON'])).tickets.map((x: any) => x.id),
  ).toEqual([t.id])
  expect((await rpc('agent_search_tickets', ['%'])).tickets).toEqual([])
  expect((await rpc('agent_get_ticket', [t.id])).claim).toBeNull()
  for (const project of [Q, OTHER]) {
    await expect(rpc('agent_list_tickets', [project])).rejects.toThrow('non autorisé')
    await expect(rpc('agent_search_tickets', ['Jetson', project])).rejects.toThrow('non autorisé')
    await expect(
      rpc('agent_create_ticket', [crypto.randomUUID(), project, { title: 'Interdit' }]),
    ).rejects.toThrow('non autorisé')
  }
  for (const table of [
    'projects',
    'tickets',
    'notes',
    'worker_repositories',
    'development_runs',
    'agent_ticket_claims',
    'ticket_description_history',
  ])
    expect((await db.query(`select * from public.${table}`)).rows).toEqual([])
  await expect(db.query('select * from private.workers')).rejects.toThrow('permission denied')
  await expect(rpc('worker_poll', [])).rejects.toThrow()
  await expect(rpc('worker_development_claim', [[R]])).rejects.toThrow('Worker non autorisé')
  await expect(rpc('ticket_agent_activity', [t.id])).rejects.toThrow('double authentification')
  await as(M, 'aal2')
  await expect(
    rpc('approve_agent_review', [crypto.randomUUID(), t.id, crypto.randomUUID(), t.updated_at]),
  ).rejects.toThrow('double authentification')
  await as(A, 'aal2')
  expect(await rpc('atelier_schema_version')).toBe(9)
  await expect(rpc('agent_list_projects')).rejects.toThrow('non autorisé')
  await as(W)
  await expect(rpc('agent_list_projects')).rejects.toThrow('non autorisé')
})

it('validates fields, query bounds, relationships and forbids agent Done/direct writes', async () => {
  const t = await create()
  for (const values of [
    { status: 'done' },
    { owner_id: B },
    { title: '' },
    { priority: 'root' },
    { difficulty: null },
    { description: 'x'.repeat(12001) },
    { prerequisite_ids: [false] },
    { parent_id: 2 },
  ])
    await expect(
      rpc('agent_update_ticket', [crypto.randomUUID(), t.id, t.updated_at, values]),
    ).rejects.toThrow()
  for (const args of [
    [P, null, 0, 0],
    [P, null, 101, 0],
    [P, 'unknown', 50, 0],
    [P, null, 50, -1],
  ])
    await expect(rpc('agent_list_tickets', args)).rejects.toThrow('invalide')
  await expect(rpc('agent_search_tickets', [''])).rejects.toThrow('invalide')
  await expect(rpc('agent_search_tickets', ['x', null, 51])).rejects.toThrow('invalide')
  await expect(
    rpc('agent_append_ticket', [crypto.randomUUID(), t.id, t.updated_at, '']),
  ).rejects.toThrow('invalide')
  expect(
    (await db.query("update public.tickets set status='done' where id=$1 returning id", [t.id]))
      .rows,
  ).toEqual([])
  await expect(
    db.query('insert into public.tickets(project_id,title) values($1,$2)', [P, 'Direct']),
  ).rejects.toThrow('row-level security')
  await expect(
    rpc('agent_update_ticket', [
      crypto.randomUUID(),
      t.id,
      t.updated_at,
      { prerequisite_ids: [t.id] },
    ]),
  ).rejects.toThrow()
  await as(A, 'aal2')
  const foreign = (
    await db.query<any>('insert into tickets(project_id,title) values($1,$2) returning id', [
      Q,
      'Privé',
    ])
  ).rows[0].id
  await as(M)
  await expect(rpc('agent_get_ticket', [foreign])).rejects.toThrow('inaccessible')
  await expect(
    rpc('agent_update_ticket', [crypto.randomUUID(), t.id, t.updated_at, { parent_id: foreign }]),
  ).rejects.toThrow()
})

it('is idempotent across retries, rejects different payload and rechecks revocation before replay', async () => {
  await as(M)
  const id = crypto.randomUUID(),
    values = { title: 'Idempotent' }
  const a = await rpc('agent_create_ticket', [id, P, values])
  expect(await rpc('agent_create_ticket', [id, P, values])).toEqual(a)
  await expect(rpc('agent_create_ticket', [id, P, { title: 'Autre' }])).rejects.toThrow(
    'déjà utilisé',
  )
  await db.exec('reset role')
  await db.query('update private.ticket_agents set enabled=false where user_id=$1', [M])
  await as(M)
  await expect(rpc('agent_create_ticket', [id, P, values])).rejects.toThrow('non autorisé')
  await db.exec('reset role')
  await db.query('update private.ticket_agents set enabled=true where user_id=$1', [M])
  await db.query('delete from private.ticket_agent_projects where agent_id=$1', [M])
  await as(M)
  await expect(rpc('agent_create_ticket', [id, P, values])).rejects.toThrow('non autorisé')
  await db.exec('reset role')
  await db.query('insert into private.ticket_agent_projects values($1,$2,$3)', [M, P, A])
})

it('serializes concurrent writers with exact versions and retains microseconds inside one transaction', async () => {
  let t = await create()
  const attempts = await Promise.allSettled([
    rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'A']),
    rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'B']),
  ])
  expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1)
  t = await read(t.id)
  await db.exec('begin')
  try {
    const a = await rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'C'])
    const b = await rpc('agent_append_ticket', [
      crypto.randomUUID(),
      t.id,
      a.ticket.updated_at,
      'D',
    ])
    expect(b.ticket.description).toBe('C\n\nD')
    expect(a.ticket.updated_at).not.toBe(t.updated_at)
    expect(b.ticket.updated_at).not.toBe(a.ticket.updated_at)
    await db.exec('commit')
  } catch (e) {
    await db.exec('rollback')
    throw e
  }
})

it('keeps twenty prior bodies and permits reversible human restoration only with MFA/current version', async () => {
  let t = await create({ description: 'initial' })
  for (let i = 1; i <= 22; i++)
    t = (await rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, `version ${i}`]))
      .ticket
  await as(A)
  await expect(rpc('ticket_agent_activity', [t.id])).rejects.toThrow('double authentification')
  await as(A, 'aal2')
  const activity = await rpc('ticket_agent_activity', [t.id])
  expect(activity.history).toHaveLength(20)
  expect(activity.history[0].description).toBe('version 21')
  expect(activity.history[19].description).toBe('version 2')
  const h = activity.history[0]
  await expect(
    rpc('restore_ticket_description', [crypto.randomUUID(), t.id, h.id, h.previous_version]),
  ).rejects.toThrow('changé')
  const request = crypto.randomUUID()
  const restored = await rpc('restore_ticket_description', [request, t.id, h.id, t.updated_at])
  expect(restored.ticket.description).toBe('version 21')
  expect(await rpc('restore_ticket_description', [request, t.id, h.id, t.updated_at])).toEqual(
    restored,
  )
  const undo = (await rpc('ticket_agent_activity', [t.id])).history[0]
  expect(undo).toMatchObject({ description: 'version 22', agent_label: 'Restauration humaine' })
  expect(
    (
      await rpc('restore_ticket_description', [
        crypto.randomUUID(),
        t.id,
        undo.id,
        restored.ticket.updated_at,
      ])
    ).ticket.description,
  ).toBe('version 22')
  await as(B, 'aal2')
  await expect(rpc('ticket_agent_activity', [t.id])).rejects.toThrow('inaccessible')
})

it('preserves inline/reference/data images while allowing append and human edits', async () => {
  for (const body of [
    '![preuve](https://example.test/a.png)',
    '![preuve](data:image/png;base64,YQ==)',
    '![preuve][img]\n\n[img]: https://example.test/a.png',
  ]) {
    let t = await create({ description: body })
    await expect(
      rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'Image retirée']),
    ).rejects.toThrow('image')
    await expect(
      rpc('agent_update_ticket', [
        crypto.randomUUID(),
        t.id,
        t.updated_at,
        { description: body.replace('a.png', 'b.png').replace('YQ==', 'Yg==') },
      ]),
    ).rejects.toThrow('image')
    t = (await rpc('agent_append_ticket', [crypto.randomUUID(), t.id, t.updated_at, 'Commentaire']))
      .ticket
    expect(t.description).toContain(body)
    await as(A, 'aal2')
    await db.query('update public.tickets set description=$1 where id=$2', [
      'Suppression humaine',
      t.id,
    ])
  }
})

it('requires explicit claim, excludes other agents, keeps review in progress and approves only as human', async () => {
  let t = await create()
  const request = crypto.randomUUID(),
    initial = t.updated_at
  let claimed = await rpc('agent_claim_ticket', [request, t.id, initial])
  expect(claimed.ticket.status).toBe('in_progress')
  expect(claimed.claim).toMatchObject({ state: 'running', agent_label: 'Codex', report: null })
  expect(await rpc('agent_claim_ticket', [request, t.id, initial])).toEqual(claimed)
  t = claimed.ticket
  await as(N)
  await expect(
    rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'Intrus']),
  ).rejects.toThrow('réservé')
  await expect(
    rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, t.updated_at]),
  ).rejects.toThrow('réservé')
  await as(A, 'aal2')
  await expect(db.query("update tickets set status='done' where id=$1", [t.id])).rejects.toThrow(
    'travaille encore',
  )
  await expect(
    rpc('approve_agent_review', [crypto.randomUUID(), t.id, claimed.claim.id, t.updated_at]),
  ).rejects.toThrow('compte rendu')
  await as(M)
  for (const bad of [
    { ...report, tests: [false] },
    { ...report, summary: '' },
    { ...report, extra: true },
    { ...report, limitations: ['x'.repeat(2001)] },
  ])
    await expect(
      rpc('agent_finish_review', [crypto.randomUUID(), t.id, t.updated_at, claimed.claim.id, bad]),
    ).rejects.toThrow('invalide')
  claimed = await rpc('agent_finish_review', [
    crypto.randomUUID(),
    t.id,
    t.updated_at,
    claimed.claim.id,
    report,
  ])
  expect(claimed.ticket.status).toBe('in_progress')
  expect(claimed.claim).toMatchObject({ state: 'review', report })
  await expect(
    rpc('agent_edit_body', [crypto.randomUUID(), t.id, claimed.ticket.updated_at, 'Tard']),
  ).rejects.toThrow('validation humaine')
  await as(A, 'aal2')
  const done = await rpc('approve_agent_review', [
    crypto.randomUUID(),
    t.id,
    claimed.claim.id,
    claimed.ticket.updated_at,
  ])
  expect(done.ticket.status).toBe('done')
  expect(done.claim.state).toBe('approved')
  await as(M)
  await expect(
    rpc('agent_update_ticket', [
      crypto.randomUUID(),
      t.id,
      done.ticket.updated_at,
      { title: 'Tard' },
    ]),
  ).rejects.toThrow('terminé')
})

it('checks prerequisites, permits human cancellation and cannot approve an absent claim', async () => {
  const prerequisite = await create()
  let t = await create({ prerequisite_ids: [prerequisite.id] })
  await expect(
    rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, t.updated_at]),
  ).rejects.toThrow('prérequis')
  await as(A, 'aal2')
  await expect(
    rpc('approve_agent_review', [crypto.randomUUID(), t.id, null, t.updated_at]),
  ).rejects.toThrow('absente')
  await db.query("update tickets set status='done' where id=$1", [prerequisite.id])
  await as(M)
  const claimed = await rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, t.updated_at])
  await as(A, 'aal2')
  const cancelled = await rpc('cancel_agent_claim', [
    crypto.randomUUID(),
    t.id,
    claimed.claim.id,
    claimed.ticket.updated_at,
  ])
  expect(cancelled.claim.state).toBe('cancelled')
  expect(cancelled.ticket.status).toBe('in_progress')
  await as(M)
  await expect(
    rpc('agent_finish_review', [
      crypto.randomUUID(),
      t.id,
      cancelled.ticket.updated_at,
      claimed.claim.id,
      report,
    ]),
  ).rejects.toThrow('annulée')
  const next = await rpc('agent_claim_ticket', [
    crypto.randomUUID(),
    t.id,
    cancelled.ticket.updated_at,
  ])
  expect(next.claim.id).not.toBe(claimed.claim.id)
  const reviewed = await rpc('agent_finish_review', [
    crypto.randomUUID(),
    t.id,
    next.ticket.updated_at,
    next.claim.id,
    report,
  ])
  await as(A, 'aal2')
  await db.query("update tickets set status='done' where id=$1", [t.id])
  expect((await rpc('ticket_agent_activity', [t.id])).claim).toMatchObject({
    id: reviewed.claim.id,
    state: 'approved',
  })
})

it('mutually excludes Run and MCP claims in both directions, including worker claim guard', async () => {
  let t = await create()
  const claimed = await rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, t.updated_at])
  await as(A, 'aal2')
  await expect(
    rpc('submit_development', [
      crypto.randomUUID(),
      t.id,
      claimed.ticket.updated_at,
      'gpt-6.1-sol',
      'high',
    ]),
  ).rejects.toThrow('MCP')
  const cancelled = await rpc('cancel_agent_claim', [
    crypto.randomUUID(),
    t.id,
    claimed.claim.id,
    claimed.ticket.updated_at,
  ])
  const run = crypto.randomUUID()
  await rpc('submit_development', [run, t.id, cancelled.ticket.updated_at, 'gpt-6.1-sol', 'high'])
  await as(M)
  await expect(
    rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, cancelled.ticket.updated_at]),
  ).rejects.toThrow('Run est active')
  await as(W)
  const job = await rpc('worker_development_claim', [[R]])
  expect(job.id).toBe(run)
  expect(job.status).toBe('running')
  await as(M)
  t = await read(t.id)
  await expect(
    rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'Interférence']),
  ).rejects.toThrow('Run est active')
  await as(A, 'aal2')
  await rpc('cancel_development', [run])
  await as(M)
  const mcp = await rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, t.updated_at])
  // Simulate inconsistent legacy data under administrator privileges: the
  // database guard must still reject a worker transition into running.
  await db.exec('reset role')
  await expect(
    db.query("update development_runs set status='running',lease=gen_random_uuid() where id=$1", [
      run,
    ]),
  ).rejects.toThrow('MCP')
  await as(A, 'aal2')
  await rpc('cancel_agent_claim', [crypto.randomUUID(), t.id, mcp.claim.id, mcp.ticket.updated_at])
})

it('revokes helper and anonymous execution privileges and isolates account roles', async () => {
  await db.exec('reset role')
  const functions = (
    await db.query<{ name: string; anon: boolean; authenticated: boolean }>(`
    select n.nspname||'.'||p.proname name,
      has_function_privilege('anon',p.oid,'execute') anon,
      has_function_privilege('authenticated',p.oid,'execute') authenticated
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and (p.proname like '%agent%' or p.proname='require_ticket_agent'))
       or (n.nspname='public' and (p.proname like 'agent_%' or p.proname in
         ('ticket_agent_activity','restore_ticket_description','approve_agent_review','cancel_agent_claim')))
  `)
  ).rows
  expect(functions.length).toBeGreaterThan(20)
  for (const fn of functions) {
    expect(fn.anon, fn.name).toBe(false)
    expect(fn.authenticated, fn.name).toBe(fn.name.startsWith('public.'))
  }
  await db.query('insert into private.workers(user_id,owner_id) values($1,$2)', [N, A])
  await as(N)
  await expect(rpc('agent_list_projects')).rejects.toThrow('non autorisé')
  await db.exec('reset role')
  await db.query('delete from private.workers where user_id=$1', [N])
  await db.exec('set role anon')
  await expect(rpc('agent_list_projects')).rejects.toThrow('permission denied')
})

it('blocks restoration during work, emits workspace events and rolls back failed body edits', async () => {
  let t = await create({ description: 'Version initiale' })
  t = (await rpc('agent_edit_body', [crypto.randomUUID(), t.id, t.updated_at, 'Version agent']))
    .ticket
  const c = await rpc('agent_claim_ticket', [crypto.randomUUID(), t.id, t.updated_at])
  await as(A, 'aal2')
  const h = (await rpc('ticket_agent_activity', [t.id])).history[0]
  await expect(
    rpc('restore_ticket_description', [crypto.randomUUID(), t.id, h.id, c.ticket.updated_at]),
  ).rejects.toThrow('Annulez')
  const before = (
    await db.query<any>(
      "select revision from atelier_events where owner_id=$1 and kind='workspace'",
      [A],
    )
  ).rows[0].revision
  const cancelled = await rpc('cancel_agent_claim', [
    crypto.randomUUID(),
    t.id,
    c.claim.id,
    c.ticket.updated_at,
  ])
  const after = (
    await db.query<any>(
      "select revision from atelier_events where owner_id=$1 and kind='workspace'",
      [A],
    )
  ).rows[0].revision
  expect(Number(after)).toBeGreaterThan(Number(before))
  await as(M)
  await expect(
    rpc('agent_edit_body', [
      crypto.randomUUID(),
      t.id,
      cancelled.ticket.updated_at,
      'x'.repeat(12001),
    ]),
  ).rejects.toThrow()
  expect((await read(t.id)).description).toBe('Version agent')
  await as(A, 'aal2')
  expect((await rpc('ticket_agent_activity', [t.id])).history).toHaveLength(1)
})

it('bounds hourly mutations without breaking a successful retry', async () => {
  await as(N)
  const request = crypto.randomUUID(),
    values = { title: 'Rejouable à la limite' }
  const created = await rpc('agent_create_ticket', [request, P, values])
  await db.exec('reset role')
  await db.query(
    `insert into private.ticket_tool_receipts(actor_id,id,fingerprint,response)
    select $1,gen_random_uuid(),'quota fixture','{}'::jsonb from generate_series(1,120)`,
    [N],
  )
  await as(N)
  expect(await rpc('agent_create_ticket', [request, P, values])).toEqual(created)
  await expect(rpc('agent_create_ticket', [crypto.randomUUID(), P, values])).rejects.toThrow(
    '120 modifications',
  )
})

it('010 allows future projects but only human-selected projects, never cross-owner access', async () => {
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/010_agent_project_selection.sql', 'utf8'))
  await db.exec(
    "update public.agent_ticket_claims set state='cancelled'; delete from private.ticket_tool_receipts;",
  )
  await as(A)
  await expect(rpc('set_agent_project', [Q, true])).rejects.toThrow('MFA')
  await as(M)
  await expect(rpc('set_agent_project', [Q, true])).rejects.toThrow('MFA')
  await as(A, 'aal2')
  await expect(rpc('set_agent_project', [OTHER, true])).rejects.toThrow('inaccessible')
  await rpc('set_agent_project', [Q, true])
  await as(M)
  expect((await rpc('agent_list_projects')).projects.map((p: any) => p.id)).toEqual([Q])
  await expect(rpc('agent_list_tickets', [P])).rejects.toThrow('sélectionné')
  const ticket = (await rpc('agent_create_ticket', [crypto.randomUUID(), Q, { title: 'Chanson' }]))
    .ticket
  expect((await rpc('agent_search_tickets', ['Chanson'])).tickets[0].id).toBe(ticket.id)
  const claimed = await rpc('agent_claim_ticket', [
    crypto.randomUUID(),
    ticket.id,
    ticket.updated_at,
  ])
  await as(A, 'aal2')
  await rpc('set_agent_project', [P, true])
  await as(M)
  expect((await rpc('agent_list_projects')).projects.map((p: any) => p.id).sort()).toEqual(
    [P, Q].sort(),
  )
  await as(A, 'aal2')
  await expect(rpc('set_agent_project', [Q, false])).rejects.toThrow('prise en charge')
  await rpc('cancel_agent_claim', [
    crypto.randomUUID(),
    ticket.id,
    claimed.claim.id,
    claimed.ticket.updated_at,
  ])
  await rpc('set_agent_project', [Q, false])
  await as(M)
  await expect(rpc('agent_get_ticket', [ticket.id])).rejects.toThrow('inaccessible')
  expect((await rpc('agent_search_tickets', ['Chanson'])).tickets).toEqual([])
  await expect(
    rpc('agent_update_ticket', [
      crypto.randomUUID(),
      ticket.id,
      ticket.updated_at,
      { title: 'Non' },
    ]),
  ).rejects.toThrow()
  await as(A, 'aal2')
  await rpc('set_agent_project', [P, false])
  const future = crypto.randomUUID()
  await db.query('insert into public.projects(id,owner_id,name) values($1,$2,$3)', [
    future,
    A,
    'Futur',
  ])
  await rpc('set_agent_project', [future, true])
  await as(N)
  expect((await rpc('agent_list_projects')).projects.map((p: any) => p.id)).toEqual([future])
  await as(A, 'aal2')
  await rpc('set_agent_project', [future, false])
  await as(M)
  expect((await rpc('agent_list_projects')).projects).toEqual([])
})
