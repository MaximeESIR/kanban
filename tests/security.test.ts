import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const A = '10000000-0000-4000-8000-000000000001'
const B = '10000000-0000-4000-8000-000000000002'
const C = '10000000-0000-4000-8000-000000000003'
const P = '20000000-0000-4000-8000-000000000001'
const Q = '20000000-0000-4000-8000-000000000002'
const R = '20000000-0000-4000-8000-000000000003'
const T = '30000000-0000-4000-8000-000000000001'
const U = '30000000-0000-4000-8000-000000000002'
let db: PGlite
async function as(user: string | null, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || ''])
  await db.exec(`set role ${role}`)
}
async function ticket(id: string, dependency: string | null = null, project = P) {
  return db.query(
    'insert into public.tickets(id, project_id, title, depends_on_id) values ($1,$2,$3,$4) returning *',
    [id, project, 'Mon ticket', dependency],
  )
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}'), ('${C}');`)
  await db.exec(
    await readFile(new URL('../supabase/migrations/001_atelier.sql', import.meta.url), 'utf8'),
  )
  await db.exec(`insert into private.atelier_owners(user_id) values ('${A}'),('${B}');`)
}, 30000)

beforeEach(async () => {
  await db.exec(
    'reset role; truncate public.projects, public.tickets, public.notes restart identity cascade;',
  )
  await db.exec(`insert into private.atelier_owners(user_id) values ('${A}') on conflict do nothing;
    insert into public.projects(id,owner_id,name) values ('${P}','${A}','Projet A'),('${Q}','${B}','Projet B'),('${R}','${A}','Autre projet A');
    insert into public.notes(owner_id,title,content) values ('${A}','Note privée','SECRET A'),('${B}','Note B','SECRET B');`)
  await as(A)
})
afterAll(async () => {
  await db.close()
})

describe('Database authorization, with real PostgreSQL RLS', () => {
  it('denies every anonymous data operation', async () => {
    await as(null, 'anon')
    for (const table of ['projects', 'tickets', 'notes']) {
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow('permission denied')
      await expect(db.query(`delete from public.${table}`)).rejects.toThrow('permission denied')
    }
    await expect(db.query("insert into public.notes(title) values ('attack')")).rejects.toThrow(
      'permission denied',
    )
  })
  it('requires the admin allowlist even after successful authentication', async () => {
    await as(C)
    expect(
      (await db.query<{ allowed: boolean }>('select public.can_access_atelier() as allowed'))
        .rows[0].allowed,
    ).toBe(false)
    for (const table of ['projects', 'tickets', 'notes'])
      expect((await db.query(`select * from public.${table}`)).rows).toEqual([])
    await expect(db.query("insert into public.projects(name) values ('attack')")).rejects.toThrow(
      'row-level security',
    )
    await expect(db.query("insert into public.notes(content) values ('attack')")).rejects.toThrow(
      'row-level security',
    )
  })
  it('isolates even two separately authorized accounts', async () => {
    await ticket(T)
    await as(B)
    expect((await db.query('select * from public.tickets')).rows).toEqual([])
    expect(
      (await db.query<{ name: string }>('select name from public.projects')).rows.map(
        (r) => r.name,
      ),
    ).toEqual(['Projet B'])
    expect(
      (await db.query<{ content: string }>('select content from public.notes')).rows.map(
        (r) => r.content,
      ),
    ).toEqual(['SECRET B'])
    expect(
      (await db.query('update public.tickets set title=$1 where id=$2 returning id', ['attack', T]))
        .rows,
    ).toEqual([])
    expect(
      (await db.query('delete from public.projects where id=$1 returning id', [P])).rows,
    ).toEqual([])
  })
  it('blocks identity spoofing and cross-owner project references', async () => {
    await expect(
      db.query('insert into public.notes(owner_id,content) values ($1,$2)', [B, 'attack']),
    ).rejects.toThrow('row-level security')
    await expect(
      db.query('update public.projects set owner_id=$1 where id=$2', [B, P]),
    ).rejects.toThrow()
    await expect(ticket(T, null, Q)).rejects.toThrow('foreign key')
  })
  it('prevents self-authorization, truncate, and direct private access', async () => {
    await expect(
      db.query('insert into private.atelier_owners(user_id) values ($1)', [C]),
    ).rejects.toThrow('permission denied')
    await expect(db.query('select * from private.atelier_owners')).rejects.toThrow(
      'permission denied',
    )
    await expect(db.exec('truncate public.notes')).rejects.toThrow('permission denied')
  })
  it('revokes access immediately when the owner is removed', async () => {
    await db.exec('reset role')
    await db.query('delete from private.atelier_owners where user_id=$1', [A])
    await as(A)
    expect((await db.query('select * from public.projects')).rows).toEqual([])
    await expect(db.query("insert into public.notes(title) values ('blocked')")).rejects.toThrow(
      'row-level security',
    )
  })
  it('allows the owner to create, edit, and delete their own records', async () => {
    await ticket(T)
    expect(
      (
        await db.query<{ status: string }>(
          "update public.tickets set status='done' where id=$1 returning status",
          [T],
        )
      ).rows[0].status,
    ).toBe('done')
    expect(
      (await db.query('delete from public.tickets where id=$1 returning id', [T])).rows,
    ).toHaveLength(1)
    const note = await db.query<{ id: string }>(
      "insert into public.notes(title,content) values ('New','Hello') returning id",
    )
    await db.query("update public.notes set content='Updated' where id=$1", [note.rows[0].id])
    expect(
      (await db.query('delete from public.notes where id=$1 returning id', [note.rows[0].id])).rows,
    ).toHaveLength(1)
  })
})

describe('Database ticket consistency', () => {
  it('rejects self references and dependency cycles', async () => {
    await ticket(T)
    await ticket(U, T)
    await expect(
      db.query('update public.tickets set depends_on_id=$1 where id=$2', [U, T]),
    ).rejects.toThrow('boucle')
    await expect(
      db.query('update public.tickets set depends_on_id=id where id=$1', [T]),
    ).rejects.toThrow()
  })
  it('rejects dependencies on another project, including another owner', async () => {
    await ticket(T)
    await expect(ticket(U, T, R)).rejects.toThrow('foreign key')
    await as(B)
    await expect(ticket(U, T, Q)).rejects.toThrow('foreign key')
  })
  it('clears deleted dependencies and cascades deleted projects', async () => {
    await ticket(T)
    await ticket(U, T)
    await db.query('delete from public.tickets where id=$1', [T])
    expect(
      (
        await db.query<{ depends_on_id: string | null }>(
          'select depends_on_id from public.tickets where id=$1',
          [U],
        )
      ).rows[0].depends_on_id,
    ).toBeNull()
    await db.query('delete from public.projects where id=$1', [P])
    expect((await db.query('select * from public.tickets')).rows).toEqual([])
  })
  it('validates input even if the browser is bypassed', async () => {
    await ticket(T)
    await expect(
      db.query("update public.tickets set status='invalid' where id=$1", [T]),
    ).rejects.toThrow('check constraint')
    await expect(
      db.query("update public.tickets set title='   ' where id=$1", [T]),
    ).rejects.toThrow('check constraint')
    await expect(
      db.query('update public.tickets set project_id=$1 where id=$2', [R, T]),
    ).rejects.toThrow('ne peuvent pas')
  })
})
