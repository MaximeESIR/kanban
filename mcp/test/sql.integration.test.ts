import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { Gateway, type RpcName } from '../src/gateway.js'
import { createServer } from '../src/server.js'

// Only the HTTP boundary and Auth issuer are simulated. Every RPC below runs
// its real migration 009 SQL under the authenticated PostgreSQL role.
const signatures: Record<RpcName, string[]> = {
  agent_list_projects: [], agent_list_tickets: ['p_project', 'p_status', 'p_limit', 'p_offset'],
  agent_get_ticket: ['p_ticket'], agent_search_tickets: ['p_query', 'p_project', 'p_limit'],
  agent_create_ticket: ['p_request', 'p_project', 'p_values'],
  agent_update_ticket: ['p_request', 'p_ticket', 'p_version', 'p_values'],
  agent_append_ticket: ['p_request', 'p_ticket', 'p_version', 'p_text'],
  agent_edit_body: ['p_request', 'p_ticket', 'p_version', 'p_description'],
  agent_claim_ticket: ['p_request', 'p_ticket', 'p_version'],
  agent_finish_review: ['p_request', 'p_ticket', 'p_version', 'p_claim', 'p_report'],
}

test('SDK → Gateway → real SQL009: scoped tickets, exact versions, claim, report and human approval', { timeout: 30_000 }, async () => {
  const db = new PGlite()
  const owner = randomUUID(), agent = randomUUID(), project = randomUUID(), forbidden = randomUUID(), worker = randomUUID(), repo = randomUUID()
  let authCalls = 0
  const seenVersions: string[] = []
  async function as(id: string, aal = 'aal1') {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ aal })])
    await db.exec('set role authenticated')
  }
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://test-project.supabase.co')
    assert.equal(options?.method, 'POST')
    assert.equal(options?.redirect, 'error')
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('apikey'), 'sb_publishable_integration_test_only')
    if (url.pathname === '/auth/v1/token') {
      authCalls++
      assert.equal(url.search, '?grant_type=password')
      return Response.json({ access_token: 'test-agent-token', refresh_token: 'test-refresh-token', expires_in: 3600 })
    }
    assert.equal(headers.get('authorization'), 'Bearer test-agent-token')
    const rpc = url.pathname.replace('/rest/v1/rpc/', '') as RpcName
    assert.ok(Object.hasOwn(signatures, rpc))
    const args = JSON.parse(String(options?.body)) as Record<string, unknown>
    const keys = signatures[rpc]
    assert.deepEqual(Object.keys(args).sort(), [...keys].sort())
    if (typeof args.p_version === 'string') seenVersions.push(args.p_version)
    await as(agent)
    try {
      const result = await db.query<{ result: Record<string, unknown> }>(
        `select public.${rpc}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) result`, keys.map(k => args[k]))
      return Response.json(result.rows[0]!.result)
    } catch (error) {
      return Response.json({ code: (error as { code?: string }).code, message: 'PRIVATE DATABASE DETAIL' }, { status: 400 })
    }
  }
  const gateway = new Gateway(() => ({ supabase_url: 'https://test-project.supabase.co',
    publishable_key: 'sb_publishable_integration_test_only', agent_email: 'agent@example.com', agent_password: 'test-only' }), transport)
  const server = createServer(gateway)
  const client = new Client({ name: 'sql-integration', version: '1.0.0' })
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    return result.structuredContent as any
  }
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema public,auth to anon,authenticated;
      insert into auth.users values('${owner}'),('${agent}'),('${worker}');`)
    for (const migration of ['001_atelier', '002_connected_workspace', '003_ticket_relations', '004_worker_heartbeat',
      '005_ticket_execution', '006_codex_selection', '007_repository_paths', '009_ticket_agents']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}.sql`, import.meta.url), 'utf8'))
    }
    await db.exec(`insert into private.atelier_owners(user_id) values('${owner}');
      insert into private.workers(user_id,owner_id) values('${worker}','${owner}');
      insert into public.projects(id,owner_id,name) values('${project}','${owner}','Autorisé'),('${forbidden}','${owner}','Privé');
      insert into private.ticket_agents(user_id,owner_id,label) values('${agent}','${owner}','MCP partagé');
      insert into private.ticket_agent_projects(agent_id,owner_id,project_id) values('${agent}','${owner}','${project}');`)
    await as(worker)
    await db.query('select worker_repository_sync($1)', [[{ id: repo, label: 'Dépôt autorisé', path: '/test/repo', enabled: true,
      codex_models: [{ id: 'gpt-6.1-sol', label: 'Codex', efforts: ['high'], default_effort: 'high' }] }]])
    await db.query('select worker_heartbeat($1)', [[]])
    await as(owner, 'aal2')
    await db.query('select bind_project_repository($1,$2)', [project, repo])
    const [c, s] = InMemoryTransport.createLinkedPair()
    await server.connect(s)
    await client.connect(c)
    assert.equal((await client.listTools()).tools.length, 10)
    assert.equal(authCalls, 0)
    const projects = await call('atelier_list_projects')
    assert.deepEqual(projects.projects.map((p: any) => p.id), [project])
    assert.deepEqual(projects.projects[0].repository, { local_path: '/test/repo', label: 'Dépôt autorisé', enabled: true })
    const request = randomUUID()
    const create = { request_id: request, project_id: project, values: { title: 'Installer Jetson', description: 'Avant développement' } }
    let ticket = (await call('atelier_create_ticket', create)).ticket
    assert.equal(ticket.status, 'todo')
    assert.deepEqual((await call('atelier_create_ticket', create)).ticket, ticket)
    const list = await call('atelier_list_tickets', { project_id: project })
    assert.equal(list.total, 1)
    assert.equal(list.tickets[0].id, ticket.id)
    assert.equal((await call('atelier_search_tickets', { query: 'jetson' })).tickets[0].id, ticket.id)
    const get = await call('atelier_get_ticket', { ticket_id: ticket.id })
    assert.equal(get.claim, null)
    assert.equal(get.project.repository.local_path, '/test/repo')
    const originalVersion = ticket.updated_at
    ticket = (await call('atelier_update_ticket', { request_id: randomUUID(), ticket_id: ticket.id, version: ticket.updated_at, values: { priority: 'high' } })).ticket
    const conflict = await client.callTool({ name: 'atelier_edit_body', arguments: { request_id: randomUUID(), ticket_id: ticket.id, version: originalVersion, description: 'Écrasement interdit' } })
    assert.equal(conflict.isError, true)
    assert.match(JSON.stringify(conflict), /ticket a changé/)
    assert.doesNotMatch(JSON.stringify(conflict), /PRIVATE DATABASE/)
    const claimArgs = { request_id: randomUUID(), ticket_id: ticket.id, version: ticket.updated_at }
    const claimed = await call('atelier_claim_ticket', claimArgs)
    assert.deepEqual(await call('atelier_claim_ticket', claimArgs), claimed)
    assert.equal(claimed.claim.state, 'running')
    ticket = claimed.ticket
    assert.equal(ticket.status, 'in_progress')
    const secondClaim = await client.callTool({ name: 'atelier_claim_ticket', arguments: { request_id: randomUUID(), ticket_id: ticket.id, version: ticket.updated_at } })
    assert.equal(secondClaim.isError, true)
    const versionBeforeEdit = ticket.updated_at
    ticket = (await call('atelier_edit_body', { request_id: randomUUID(), ticket_id: ticket.id, version: versionBeforeEdit, description: 'Implémentation vérifiée' })).ticket
    assert.ok(seenVersions.includes(versionBeforeEdit))
    ticket = (await call('atelier_append_ticket', { request_id: randomUUID(), ticket_id: ticket.id, version: ticket.updated_at, text: 'Tests réussis' })).ticket
    assert.equal(ticket.description, 'Implémentation vérifiée\n\nTests réussis')
    const report = { summary: 'Fonction livrée', tests: ['Test PostgreSQL complet'], limitations: ['Pas de compte distant utilisé'] }
    const finish = await call('atelier_finish_review', { request_id: randomUUID(), ticket_id: ticket.id, version: ticket.updated_at, claim_id: claimed.claim.id, report })
    assert.equal(finish.ticket.status, 'in_progress')
    assert.equal(finish.claim.state, 'review')
    assert.deepEqual(finish.claim.report, report)
    const denied = await client.callTool({ name: 'atelier_list_tickets', arguments: { project_id: forbidden } })
    assert.equal(denied.isError, true)
    assert.match(JSON.stringify(denied), /Accès refusé/)
    assert.equal(authCalls, 1)
    await as(owner, 'aal2')
    const approved = await db.query<{ result: any }>('select approve_agent_review($1,$2,$3,$4) result', [randomUUID(), ticket.id, claimed.claim.id, finish.ticket.updated_at])
    assert.equal(approved.rows[0]!.result.ticket.status, 'done')
    assert.equal(approved.rows[0]!.result.claim.state, 'approved')
  } finally {
    await client.close()
    await server.close()
    await db.close()
  }
})
