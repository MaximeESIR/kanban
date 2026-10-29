import { describe, expect, it } from 'vitest'
import {
  dependencyOptions,
  isBlocked,
  matchesSearch,
  validateProject,
  validateTicket,
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
