import { describe, it, expect, vi, afterEach } from 'vitest'
import { duplicateTicket, ticketMarkdown } from '../src/lib/ticketTools'
import { sortTickets, validateTicket, type Ticket } from '../src/domain'
import {
  readAssistantPrompt,
  writeAssistantPrompt,
  clearAssistantPrompt,
} from '../src/lib/assistantPrompt'

const source: Ticket = {
  id: 'source',
  owner_id: 'owner',
  project_id: 'project',
  number: 4,
  title: 'Déployer',
  description: '## Étapes\nTester.',
  status: 'done',
  priority: 'high',
  difficulty: 'hard',
  parent_id: 'parent',
  prerequisite_ids: ['first', 'second'],
  depends_on_id: 'first',
  position: 7,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
}
afterEach(() => vi.unstubAllGlobals())
describe('ticket reuse', () => {
  it('duplicates as fresh Todo work and removes project-specific relationships across projects', () => {
    const copied = duplicateTicket(source, 'other')
    expect(copied).toMatchObject({
      project_id: 'other',
      status: 'todo',
      parent_id: null,
      prerequisite_ids: [],
      depends_on_id: null,
      description: source.description,
      position: 0,
    })
    for (const field of ['id', 'number', 'owner_id', 'created_at', 'updated_at', 'run', 'report'])
      expect(copied).not.toHaveProperty(field)
    expect(() => validateTicket(copied, [])).not.toThrow()
    expect(source.status).toBe('done')
    expect(source.prerequisite_ids).toEqual(['first', 'second'])
  })
  it('preserves same-project relationships without sharing mutable prerequisite arrays', () => {
    const copy = duplicateTicket(source, source.project_id)
    expect(copy).toMatchObject({
      parent_id: 'parent',
      prerequisite_ids: ['first', 'second'],
      depends_on_id: 'first',
      status: 'todo',
    })
    copy.prerequisite_ids!.push('third')
    expect(source.prerequisite_ids).toEqual(['first', 'second'])
  })
  it('exports meaningful Markdown and never resolves a relation from another project', () => {
    const markdown = ticketMarkdown(source, 'Jetson', [
      { ...source, id: 'parent', number: 1, title: 'Groupe' },
      { ...source, id: 'first', number: 2, title: 'Préparer' },
      { ...source, id: 'second', project_id: 'other', number: 3, title: 'Privé autre projet' },
    ])
    expect(markdown).toContain('# Ticket #4 — Déployer')
    expect(markdown).toContain('Statut : Done')
    expect(markdown).toContain('Parent : #1 — Groupe')
    expect(markdown).toContain('- #2 — Préparer')
    expect(markdown).toContain('Ticket indisponible')
    expect(markdown).not.toContain('Privé autre projet')
    expect(markdown.endsWith(source.description)).toBe(true)
  })
  it('display sorting never changes stored manual order', () => {
    const second = {
      ...source,
      id: 'second',
      position: 1,
      priority: 'low' as const,
      updated_at: '2026-11-03T00:00:00Z',
    }
    const rows = [source, second]
    expect(sortTickets(rows, 'manual').map((t) => t.id)).toEqual(['second', 'source'])
    expect(sortTickets(rows, 'priority').map((t) => t.id)).toEqual(['source', 'second'])
    expect(sortTickets(rows, 'recent').map((t) => t.id)).toEqual(['second', 'source'])
    expect(rows.map((t) => [t.id, t.position])).toEqual([
      ['source', 7],
      ['second', 1],
    ])
  })
})
it('keeps saved assistant instructions separated by account and removes only the signing-out owner', () => {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) || null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  })
  writeAssistantPrompt('alice', 'Structure mes notes')
  writeAssistantPrompt('bob', 'Corrige mon français')
  expect(readAssistantPrompt('alice')).toBe('Structure mes notes')
  clearAssistantPrompt('alice')
  expect(readAssistantPrompt('alice')).toBe('')
  expect(readAssistantPrompt('bob')).toBe('Corrige mon français')
})
