import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, it, expect } from 'vitest'
const A = '10000000-0000-4000-8000-000000000001',
  B = '10000000-0000-4000-8000-000000000002'
const p = crypto.randomUUID(),
  other = crypto.randomUUID(),
  foreign = crypto.randomUUID()
const a = crypto.randomUUID(),
  b = crypto.randomUUID(),
  c = crypto.randomUUID(),
  d = crypto.randomUUID(),
  legacy = crypto.randomUUID()
let db: PGlite
async function as(owner: string, aal = 'aal2') {
  await db.exec('reset role')
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
    [owner, JSON.stringify({ aal })],
  )
  await db.exec('set role authenticated')
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;insert into auth.users values('${A}'),('${B}');`)
  for (const name of ['001_atelier.sql', '002_connected_workspace.sql'])
    await db.exec(
      await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'),
    )
  await db.exec(`insert into private.atelier_owners(user_id) values('${A}'),('${B}');`)
  await as(A)
  await db.query('insert into projects(id,name) values($1,$3),($2,$3)', [p, other, 'Projet'])
  await db.query(
    "insert into tickets(id,project_id,title) values($1,$5,'A'),($2,$5,'B'),($3,$5,'C'),($4,$5,'D')",
    [a, b, c, d, p],
  )
  await db.query(
    "insert into tickets(id,project_id,title,depends_on_id) values($1,$2,'Ancien ticket',$3)",
    [legacy, p, a],
  )
  await as(B)
  await db.query("insert into projects(id,name) values($1,'Privé')", [foreign])
  await db.exec('reset role')
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/003_ticket_relations.sql', import.meta.url),
      'utf8',
    ),
  )
  await as(A)
}, 30000)
afterAll(async () => {
  await db.close()
})
it('migrates legacy links and stores multiple prerequisites atomically through sync_write', async () => {
  expect(
    (
      await db.query<{ prerequisite_ids: string[] }>(
        'select prerequisite_ids from tickets where id=$1',
        [legacy],
      )
    ).rows[0].prerequisite_ids,
  ).toEqual([a])
  const id = crypto.randomUUID()
  const r = await db.query<{ r: any }>('select public.sync_write($1,$2,$3,null,false,$4) r', [
    crypto.randomUUID(),
    'tickets',
    id,
    {
      project_id: p,
      title: 'Nouveau',
      description: '',
      status: 'todo',
      priority: 'high',
      difficulty: 'easy',
      parent_id: a,
      prerequisite_ids: [b, c],
    },
  ])
  expect(r.rows[0].r.row).toMatchObject({
    parent_id: a,
    prerequisite_ids: [b, c],
    depends_on_id: b,
  })
  await db.query('delete from tickets where id=$1', [id])
})
it('rejects dependency and parent cycles but accepts shared prerequisites', async () => {
  await db.query('update tickets set prerequisite_ids=$2 where id=any($1)', [[b, c], [a]])
  await db.query('update tickets set prerequisite_ids=$2 where id=$1', [d, [b, c]])
  await expect(
    db.query('update tickets set prerequisite_ids=$2 where id=$1', [a, [d]]),
  ).rejects.toThrow('boucle')
  await db.query('update tickets set parent_id=$2 where id=$1', [b, a])
  await db.query('update tickets set parent_id=$2 where id=$1', [c, b])
  await expect(db.query('update tickets set parent_id=$2 where id=$1', [a, c])).rejects.toThrow(
    'boucle',
  )
  await expect(
    db.query('update tickets set prerequisite_ids=$2 where id=$1', [a, [b, b]]),
  ).rejects.toThrow('distincts')
})
it('enforces project, owner and MFA boundaries on every relationship', async () => {
  const x = crypto.randomUUID(),
    y = crypto.randomUUID()
  await db.query("insert into tickets(id,project_id,title) values($1,$2,'Autre')", [x, other])
  await expect(db.query('update tickets set parent_id=$2 where id=$1', [a, x])).rejects.toThrow()
  await expect(
    db.query('update tickets set prerequisite_ids=$2 where id=$1', [a, [x]]),
  ).rejects.toThrow('même projet')
  await as(B)
  await db.query("insert into tickets(id,project_id,title) values($1,$2,'Privé')", [y, foreign])
  await as(A)
  await expect(db.query('update tickets set parent_id=$2 where id=$1', [a, y])).rejects.toThrow()
  await expect(
    db.query('update tickets set prerequisite_ids=$2 where id=$1', [a, [y]]),
  ).rejects.toThrow('même projet')
  await as(A, 'aal1')
  await expect(
    db.query("select public.sync_write(gen_random_uuid(),'tickets',$1,null,false,'{}')", [a]),
  ).rejects.toThrow('Accès refusé')
  await as(A)
})
it('keeps multi-links on legacy title updates and refuses their silent truncation', async () => {
  await db.query("update tickets set title='Titre récent' where id=$1", [d])
  await expect(db.query('update tickets set depends_on_id=$2 where id=$1', [d, a])).rejects.toThrow(
    'Actualisez',
  )
  expect(
    (await db.query<any>('select prerequisite_ids from tickets where id=$1', [d])).rows[0]
      .prerequisite_ids,
  ).toEqual([b, c])
})
it('cleans parent and prerequisite references on deletion, including project cascades', async () => {
  await db.query('delete from tickets where id=$1', [b])
  expect(
    (await db.query<any>('select parent_id,prerequisite_ids from tickets where id=$1', [c]))
      .rows[0],
  ).toEqual({ parent_id: null, prerequisite_ids: [a] })
  expect(
    (await db.query<any>('select prerequisite_ids,depends_on_id from tickets where id=$1', [d]))
      .rows[0],
  ).toEqual({ prerequisite_ids: [c], depends_on_id: c })
  await db.query('delete from projects where id=$1', [p])
  expect((await db.query('select * from tickets where project_id=$1', [p])).rows).toEqual([])
})
