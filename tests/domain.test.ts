import { describe, expect, it } from 'vitest'
import {
  dependencyOptions,
  isBlocked,
  matchesSearch,
  validateProject,
  validateTicket,
  nestedTickets,
  prerequisiteIds,
  sortTickets,
  unlinkTicket,
  type Ticket,
  type TicketInput,
} from '../src/domain'

const make = (id: string, dependency: string | null = null, project = 'project'): Ticket => ({
  id,
  depends_on_id: dependency,
  project_id: project,
  number: 1,
  title: id,
  description: '',
  status: 'todo',
  priority: 'medium',
  difficulty: 'easy',
  owner_id: 'owner',
  created_at: '',
  updated_at: '',
})
describe('Parent tickets and multiple prerequisites', () => {
  it('accepts a shared prerequisite and a diamond without confusing it with a cycle', () => {
    const a = make('a'),
      b = { ...make('b'), prerequisite_ids: ['a'] },
      c = { ...make('c'), prerequisite_ids: ['a'] }
    const d = { ...make('d'), prerequisite_ids: ['b', 'c'] }
    expect(() => validateTicket(d, [a, b, c, d], 'd')).not.toThrow()
    expect(() => validateTicket({ ...a, prerequisite_ids: ['d'] }, [a, b, c, d], 'a')).toThrow(
      'boucle',
    )
    expect(isBlocked(d, [a, { ...b, status: 'done' }, c, d])).toBe(true)
    expect(isBlocked(d, [a, { ...b, status: 'done' }, { ...c, status: 'done' }, d])).toBe(false)
  })
  it('separates parent hierarchy from prerequisites and rejects hierarchy cycles', () => {
    const a = make('a'),
      b = { ...make('b'), parent_id: 'a' },
      c = { ...make('c'), parent_id: 'b' }
    expect(isBlocked(b, [a, b, c])).toBe(false)
    expect(() => validateTicket({ ...a, parent_id: 'c' }, [a, b, c], 'a')).toThrow('boucle')
    expect(nestedTickets([c, b, a]).map((r) => [r.ticket.id, r.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
    expect(nestedTickets([c]).map((r) => r.depth)).toEqual([0])
  })
  it('unlinks deleted tickets while preserving the other prerequisites and legacy data', () => {
    const t = { ...make('t', 'a'), parent_id: 'a', prerequisite_ids: ['a', 'b'] }
    expect(unlinkTicket(t, 'a')).toMatchObject({
      parent_id: null,
      depends_on_id: 'b',
      prerequisite_ids: ['b'],
    })
    expect(prerequisiteIds(make('legacy', 'a'))).toEqual(['a'])
    expect(() =>
      validateTicket({ ...t, prerequisite_ids: ['a', 'a'] }, [make('a'), make('b'), t], 't'),
    ).toThrow('distincts')
  })
  it('sorts recent edits by instant rather than string timezone representation', () => {
    const a = { ...make('a'), priority: 'urgent' as const, updated_at: '2026-11-01T10:00:00+01:00' }
    const b = { ...make('b'), updated_at: '2026-11-01T09:30:00Z' }
    expect(sortTickets([a, b], 'recent').map((t) => t.id)).toEqual(['b', 'a'])
    expect(sortTickets([b, a], 'priority').map((t) => t.id)).toEqual(['a', 'b'])
  })
})
const input = (dependency: string | null): TicketInput => ({
  project_id: 'project',
  title: 'Ticket',
  description: '',
  status: 'todo',
  priority: 'high',
  difficulty: 'medium',
  depends_on_id: dependency,
})

describe('Ticket dependencies', () => {
  it('rejects self references and indirect cycles', () => {
    const tickets = [make('a'), make('b', 'a'), make('c', 'b')]
    expect(() => validateTicket(input('a'), tickets, 'a')).toThrow('boucle')
    expect(() => validateTicket(input('c'), tickets, 'a')).toThrow('boucle')
    expect(dependencyOptions(tickets, 'project', 'a')).toEqual([])
  })
  it('only accepts dependencies in the same project', () => {
    expect(() => validateTicket(input('x'), [make('x', null, 'other')])).toThrow('ce projet')
    expect(() => validateTicket(input('missing'), [])).toThrow('ce projet')
    expect(() => validateTicket(input('a'), [make('a')], 'b')).not.toThrow()
  })
  it('shows unresolved dependencies without preventing status changes', () => {
    const a = make('a'),
      b = make('b', 'a')
    expect(isBlocked(b, [a, b])).toBe(true)
    expect(() => validateTicket({ ...input('a'), status: 'done' }, [a, b], 'b')).not.toThrow()
    expect(isBlocked(b, [{ ...a, status: 'done' }, b])).toBe(false)
  })
})
describe('User input', () => {
  it('rejects empty names and oversized data', () => {
    expect(() => validateProject({ name: '  ', description: '', color: 'sage' })).toThrow()
    expect(() => validateTicket({ ...input(null), title: 'x'.repeat(161) }, [])).toThrow()
    expect(() => validateTicket({ ...input(null), description: 'x'.repeat(12001) }, [])).toThrow()
  })
  it('searches French text without requiring accents or case', () => {
    expect(matchesSearch('  idee ', 'Une belle idée')).toBe(true)
    expect(matchesSearch('MOBILE', 'Navigation mobile')).toBe(true)
    expect(matchesSearch('autre', 'Navigation mobile')).toBe(false)
  })
})
