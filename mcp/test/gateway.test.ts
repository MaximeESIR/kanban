import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Gateway, type RpcName } from '../src/gateway.js'
import { readConfig, type Config } from '../src/config.js'

const config: Config = { supabase_url: 'https://exampletestproject.supabase.co', publishable_key: 'sb_publishable_PUBLIC_TEST_KEY', agent_email: 'agent@example.com', agent_password: 'PRIVATE_PASSWORD' }
const session = { access_token: 'SECRET_TOKEN', refresh_token: 'PRIVATE_REFRESH', expires_in: 3600 }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }) }

test('gateway lazily authenticates only against configured HTTPS then uses scoped RPC', async () => {
  const requests: [string, RequestInit | undefined][] = []
  let loads = 0
  const transport: typeof fetch = async (url, init) => {
    requests.push([String(url), init])
    return requests.length === 1 ? json(session) : json({ projects: [] })
  }
  const gateway = new Gateway(() => { loads++; return config }, transport)
  assert.equal(loads, 0)
  await gateway.rpc('agent_list_projects', {})
  await gateway.rpc('agent_list_projects', {})
  assert.equal(requests.length, 3)
  assert.equal(loads, 1)
  assert.equal(requests[0]?.[0], config.supabase_url + '/auth/v1/token?grant_type=password')
  assert.deepEqual(JSON.parse(String(requests[0]?.[1]?.body)), { email: config.agent_email, password: config.agent_password })
  assert.equal(requests[1]?.[0], config.supabase_url + '/rest/v1/rpc/agent_list_projects')
  assert.equal((requests[1]?.[1]?.headers as Record<string, string>).Authorization, 'Bearer SECRET_TOKEN')
  assert.ok(requests.every(([, r]) => r?.redirect === 'error' && r.signal))
})

test('parallel calls share one authentication and expired sessions refresh only in memory', async () => {
  const requests: string[] = []
  let now = 0
  const transport: typeof fetch = async url => {
    requests.push(String(url))
    await new Promise(resolve => setTimeout(resolve, 5))
    return String(url).includes('/auth/') ? json(session) : json({ projects: [] })
  }
  const gateway = new Gateway(() => config, transport, () => now)
  await Promise.all([gateway.rpc('agent_list_projects', {}), gateway.rpc('agent_list_projects', {})])
  assert.equal(requests.filter(url => url.includes('/auth/')).length, 1)
  now = 3600 * 1000
  await gateway.rpc('agent_list_projects', {})
  assert.equal(requests.filter(url => url.includes('grant_type=refresh_token')).length, 1)
})

test('server SQL codes become useful errors without reflecting private response bodies', async () => {
  for (const [code, phrase] of [['42501', 'Accès refusé'], ['40001', 'ticket a changé'], ['22023', 'Arguments refusés'], ['55000', 'Ticket indisponible']]) {
    let calls = 0
    const gateway = new Gateway(() => config, async () => ++calls === 1 ? json(session) : json({ code, message: 'PRIVATE_PASSWORD SECRET_TOKEN' }, 400))
    await assert.rejects(gateway.rpc('agent_get_ticket', {}), error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, new RegExp(phrase!))
      assert.doesNotMatch(error.message, /PRIVATE_PASSWORD|SECRET_TOKEN/)
      return true
    })
    assert.equal(calls, 2)
  }
})

test('unknown RPC, insecure destination and service key are rejected before networking', async () => {
  let calls = 0
  const transport: typeof fetch = async () => { calls++; return json({}) }
  await assert.rejects(new Gateway(() => config, transport).rpc('arbitrary_shell' as RpcName, {}))
  for (const invalid of [
    { ...config, supabase_url: 'https://evil.example' },
    { ...config, supabase_url: config.supabase_url + '/redirect' },
    { ...config, supabase_url: 'http://exampletestproject.supabase.co' },
    { ...config, publishable_key: 'sb_secret_PRIVATE_PASSWORD' },
  ]) await assert.rejects(new Gateway(() => invalid, transport).rpc('agent_list_projects', {}))
  assert.equal(calls, 0)
})

test('timeouts, invalid JSON and oversized responses never retry a mutation or reveal secrets', async () => {
  for (const response of [() => { throw new Error('PRIVATE_PASSWORD') },
    () => new Response('invalid PRIVATE_PASSWORD'), () => new Response('x'.repeat(2_000_001)), () => json(null)]) {
    let calls = 0
    const gateway = new Gateway(() => config, async () => ++calls === 1 ? json(session) : response())
    await assert.rejects(gateway.rpc('agent_claim_ticket', {}), error => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /PRIVATE_PASSWORD|SECRET_TOKEN/)
      return true
    })
    assert.equal(calls, 2)
  }
})

test('credential file must be owned, private, bounded and not a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'atelier-mcp-'))
  const path = join(root, 'config.json')
  try {
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
    assert.deepEqual(readConfig(path), config)
    chmodSync(path, 0o644)
    assert.throws(() => readConfig(path), /setup.py/)
    chmodSync(path, 0o600)
    const link = join(root, 'link.json'); symlinkSync(path, link)
    assert.throws(() => readConfig(link), /setup.py/)
    writeFileSync(path, 'x'.repeat(16385))
    assert.throws(() => readConfig(path), /setup.py/)
  } finally { rmSync(root, { recursive: true }) }
})
