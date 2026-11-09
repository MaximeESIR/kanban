import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server.js'
import { PublicError } from '../src/config.js'
import type { RpcGateway, RpcName } from '../src/gateway.js'

const id = '11111111-1111-4111-8111-111111111111'
const project = '22222222-2222-4222-8222-222222222222'
const request = '33333333-3333-4333-8333-333333333333'
const version = '2026-11-09T10:11:12.123456+00:00'
const base = { request_id: request, ticket_id: id, version }

async function session(gateway: RpcGateway) {
  const server = createServer(gateway)
  const client = new Client({ name: 'atelier-tests', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, close: async () => { await client.close(); await server.close() } }
}

test('SDK discovery and workflow require no account, connection, model or shell', async () => {
  let calls = 0
  const s = await session({ rpc: async () => { calls++; throw new Error('should not run') } })
  try {
    const tools = await s.client.listTools()
    assert.equal(tools.tools.length, 10)
    assert.ok(tools.tools.every(t => !/shell|exec|done|delete/i.test(t.name)))
    assert.equal(tools.tools.find(t => t.name === 'atelier_get_ticket')?.annotations?.readOnlyHint, true)
    const prompt = await s.client.getPrompt({ name: 'atelier_ticket_workflow', arguments: { ticket_id: id } })
    const text = JSON.stringify(prompt)
    assert.match(text, /branche.*modifications existantes/)
    assert.match(text, /Ne jamais le passer Done/)
    assert.equal(calls, 0)
  } finally { await s.close() }
})

test('all ten SDK tools translate validated fields to only the scoped RPC contract', async () => {
  const calls: { name: RpcName; args: Record<string, unknown> }[] = []
  const s = await session({ rpc: async (name, args) => { calls.push({ name, args }); return { ok: true } } })
  const cases: [string, Record<string, unknown>, string, Record<string, unknown>][] = [
    ['atelier_list_projects', {}, 'agent_list_projects', {}],
    ['atelier_list_tickets', { project_id: project }, 'agent_list_tickets', { p_project: project, p_status: null, p_limit: 50, p_offset: 0 }],
    ['atelier_get_ticket', { ticket_id: id }, 'agent_get_ticket', { p_ticket: id }],
    ['atelier_search_tickets', { query: 'Jetson' }, 'agent_search_tickets', { p_query: 'Jetson', p_project: null, p_limit: 20 }],
    ['atelier_create_ticket', { request_id: request, project_id: project, values: { title: 'Feature' } }, 'agent_create_ticket', { p_request: request, p_project: project, p_values: { title: 'Feature' } }],
    ['atelier_update_ticket', { ...base, values: { priority: 'high' } }, 'agent_update_ticket', { p_request: request, p_ticket: id, p_version: version, p_values: { priority: 'high' } }],
    ['atelier_append_ticket', { ...base, text: 'Vérifications en cours' }, 'agent_append_ticket', { p_request: request, p_ticket: id, p_version: version, p_text: 'Vérifications en cours' }],
    ['atelier_edit_body', { ...base, description: 'Corps corrigé' }, 'agent_edit_body', { p_request: request, p_ticket: id, p_version: version, p_description: 'Corps corrigé' }],
    ['atelier_claim_ticket', base, 'agent_claim_ticket', { p_request: request, p_ticket: id, p_version: version }],
    ['atelier_finish_review', { ...base, claim_id: project, report: { summary: 'Fait', tests: ['npm test'], limitations: [] } }, 'agent_finish_review', { p_request: request, p_ticket: id, p_version: version, p_claim: project, p_report: { summary: 'Fait', tests: ['npm test'], limitations: [] } }],
  ]
  try {
    for (const [name, args, rpc, expected] of cases) {
      const result = await s.client.callTool({ name, arguments: args })
      assert.ok(!result.isError, JSON.stringify(result))
      assert.deepEqual(calls.at(-1), { name: rpc, args: expected })
    }
  } finally { await s.close() }
})

test('protocol validation rejects Done, injection fields, missing version and oversized input before RPC', async () => {
  let calls = 0
  const s = await session({ rpc: async () => { calls++; return {} } })
  const cases: [string, Record<string, unknown>][] = [
    ['atelier_update_ticket', { ...base, values: { status: 'done' } }],
    ['atelier_update_ticket', { ...base, values: {} }],
    ['atelier_update_ticket', { request_id: request, ticket_id: id, values: { title: 'x' } }],
    ['atelier_claim_ticket', { ...base, command: 'rm -rf /' }],
    ['atelier_get_ticket', { ticket_id: '../../other' }],
    ['atelier_list_tickets', { project_id: project, limit: 101 }],
    ['atelier_search_tickets', { query: 'x'.repeat(501) }],
    ['atelier_create_ticket', { request_id: request, project_id: project, values: { title: 'x', prerequisite_ids: [id, id] } }],
    ['atelier_edit_body', { ...base, description: 'x'.repeat(12001) }],
    ['atelier_finish_review', { ...base, claim_id: id, report: { summary: 'x', tests: ['x'.repeat(2001)], limitations: [] } }],
  ]
  try {
    for (const [name, args] of cases) {
      try {
        const result = await s.client.callTool({ name, arguments: args })
        assert.equal(result.isError, true, name)
      } catch (error) { assert.ok(error instanceof Error) }
    }
    assert.equal(calls, 0)
  } finally { await s.close() }
})

test('errors are public and mutations retain the caller request UUID for idempotent retry', async () => {
  const calls: unknown[] = []
  const s = await session({ rpc: async (_name, args) => {
    calls.push(args)
    if (calls.length === 1) throw new PublicError('Le ticket a changé.')
    throw new Error('PRIVATE_PASSWORD Bearer SECRET_TOKEN')
  } })
  try {
    const first = await s.client.callTool({ name: 'atelier_claim_ticket', arguments: base })
    assert.match(JSON.stringify(first), /ticket a changé/)
    const second = await s.client.callTool({ name: 'atelier_claim_ticket', arguments: base })
    assert.equal(second.isError, true)
    assert.doesNotMatch(JSON.stringify(second), /PRIVATE_PASSWORD|SECRET_TOKEN/)
    assert.deepEqual(calls[0], calls[1])
  } finally { await s.close() }
})

test('real SDK stdio subprocess starts without secrets and gives actionable lazy-auth error', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', root + '/src/server.ts'], cwd: root,
    env: { ATELIER_MCP_CONFIG: '/nonexistent/atelier-mcp-test-config.json' }, stderr: 'pipe' })
  const client = new Client({ name: 'stdio-test', version: '1.0.0' })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += String(chunk) })
  try {
    await client.connect(transport)
    assert.equal((await client.listTools()).tools.length, 10)
    const result = await client.callTool({ name: 'atelier_list_projects', arguments: {} })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /setup.py/)
    assert.doesNotMatch(stderr, /password|token|Bearer/i)
  } finally { await client.close() }
})
