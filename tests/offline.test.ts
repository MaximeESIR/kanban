import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { clear, get } from 'idb-keyval'
import { offlineRepository } from '../src/lib/offline'
import { emptyData, type TicketInput } from '../src/domain'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc } }))
let online = false
beforeEach(async () => {
  await clear()
  online = false
  rpc.mockReset()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      get onLine() {
        return online
      },
      locks: { request: async (_key: string, f: () => unknown) => f() },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: () => true },
  })
})
it('keeps parent/multiple links offline, unlinks only the deleted prerequisite and rejects a stale form', async () => {
  const repo = offlineRepository('A', { load: async () => emptyData() } as any)
  await repo.load()
  const project = await repo.project({ name: 'Jetson', description: '', color: 'sage' })
  const input: TicketInput = {
    project_id: project.id,
    title: 'Travail',
    description: '',
    status: 'todo',
    priority: 'medium',
    difficulty: 'easy',
    depends_on_id: null,
  }
  const a = await repo.ticket(input),
    b = await repo.ticket(input)
  const c = await repo.ticket({ ...input, parent_id: a.id, prerequisite_ids: [a.id, b.id] })
  await expect(repo.ticket({ ...input, title: 'Stale' }, c.id, 'old-version')).rejects.toThrow(
    'a changé',
  )
  await repo.remove('tickets', a.id)
  const reopened = offlineRepository('A', { load: async () => emptyData() } as any)
  const result = (await reopened.load()).tickets.find((t) => t.id === c.id)
  expect(result).toMatchObject({ parent_id: null, prerequisite_ids: [b.id], depends_on_id: b.id })
})
it('persists offline changes through a new repository instance and replays server versions in order', async () => {
  const remote = { load: vi.fn(async () => emptyData()) } as any
  const repo = offlineRepository('A', remote)
  await repo.load()
  const first = await repo.note({ title: 'Draft', content: 'v1' })
  await repo.note({ title: 'Draft', content: 'v2' }, first.id)
  const reopened = offlineRepository('A', remote)
  expect((await reopened.load()).notes[0].content).toBe('v2')
  let count = 0
  rpc.mockImplementation(async (_name, args) => {
    count++
    return {
      data: { row: { ...first, ...args.p_values, updated_at: `server-${count}` } },
      error: null,
    }
  })
  remote.load.mockResolvedValue({
    ...emptyData(),
    notes: [{ ...first, content: 'v2', updated_at: 'server-2' }],
  })
  online = true
  expect((await reopened.load()).notes[0].content).toBe('v2')
  expect(rpc.mock.calls[0][1].p_base).toBeNull()
  expect(rpc.mock.calls[1][1].p_base).toBe('server-1')
  expect(rpc.mock.calls[0][1].p_request).not.toBe(rpc.mock.calls[1][1].p_request)
})
it('keeps local edits when a network write fails and reuses the same idempotency receipt', async () => {
  const remote = { load: async () => emptyData() } as any,
    repo = offlineRepository('A', remote)
  await repo.load()
  await repo.note({ title: 'Important', content: 'Keep me' })
  online = true
  rpc.mockResolvedValue({ error: { message: 'Network fetch failed' } })
  await repo.load()
  const request = rpc.mock.calls[0][1].p_request
  online = false
  expect((await repo.load()).notes[0].content).toBe('Keep me')
  online = true
  await repo.load()
  expect(rpc.mock.calls[1][1].p_request).toBe(request)
})
it('archives a permanently rejected relationship and still synchronizes the next independent edit', async () => {
  const remote = { load: async () => emptyData() } as any
  const repo = offlineRepository('A', remote)
  await repo.load()
  await repo.ticket({
    project_id: 'deleted-project',
    title: 'Travail à conserver',
    description: 'Mon travail',
    status: 'todo',
    priority: 'medium',
    difficulty: 'easy',
    depends_on_id: 'deleted-prerequisite',
  })
  await repo.note({ title: 'Indépendante', content: 'Suite' })
  rpc
    .mockResolvedValueOnce({
      error: {
        code: 'P0001',
        message: 'Les prérequis doivent appartenir au même projet et propriétaire.',
      },
    })
    .mockResolvedValueOnce({ data: { row: { updated_at: 'server-2' } }, error: null })
  online = true
  await repo.load()
  expect(rpc).toHaveBeenCalledTimes(2)
  const state = await get<any>('atelier-private-A')
  expect(state.ops).toHaveLength(0)
  expect(state.conflicts[0].values).toMatchObject({
    title: 'Travail à conserver',
    description: 'Mon travail',
    _rejected: expect.stringContaining('prérequis'),
  })
})
