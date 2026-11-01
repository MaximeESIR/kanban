export type Status = 'todo' | 'in_progress' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'complex'
export const statuses: { id: Status; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]
export const priorities: Record<Priority, string> = {
  low: 'Basse',
  medium: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
}
export const difficulties: Record<Difficulty, string> = {
  easy: 'Simple',
  medium: 'Modérée',
  hard: 'Difficile',
  complex: 'Complexe',
}
export const colors = ['sage', 'blue', 'purple', 'peach', 'rose', 'sand'] as const
export type ProjectColor = (typeof colors)[number]

export interface Project {
  id: string
  owner_id: string
  name: string
  description: string
  color: ProjectColor
  created_at: string
  updated_at: string
}
export interface Ticket {
  position?: number
  id: string
  owner_id: string
  project_id: string
  number: number
  title: string
  description: string
  priority: Priority
  difficulty: Difficulty
  status: Status
  depends_on_id: string | null
  /** Legacy records are read through prerequisiteIds until migrated. */
  prerequisite_ids?: string[]
  parent_id?: string | null
  created_at: string
  updated_at: string
}
export interface Note {
  category?: 'pro' | 'perso'
  id: string
  owner_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}
export interface Data {
  projects: Project[]
  tickets: Ticket[]
  notes: Note[]
}
export type ProjectInput = Pick<Project, 'name' | 'description' | 'color'>
export type TicketInput = Pick<
  Ticket,
  | 'project_id'
  | 'title'
  | 'description'
  | 'priority'
  | 'difficulty'
  | 'status'
  | 'depends_on_id'
  | 'position'
  | 'prerequisite_ids'
  | 'parent_id'
>
export type NoteInput = Pick<Note, 'title' | 'content' | 'category'>
export const emptyData = (): Data => ({ projects: [], tickets: [], notes: [] })

export function validateProject(input: ProjectInput) {
  if (!input.name.trim() || input.name.trim().length > 80)
    throw new Error('Le nom du projet doit contenir entre 1 et 80 caractères.')
  if (input.description.length > 1000)
    throw new Error('La description est limitée à 1 000 caractères.')
  if (!colors.includes(input.color)) throw new Error('Couleur invalide.')
}

export function validateTicket(input: TicketInput, tickets: Ticket[], id?: string) {
  if (!input.title.trim() || input.title.trim().length > 160)
    throw new Error('Le titre doit contenir entre 1 et 160 caractères.')
  if (input.description.length > 12000)
    throw new Error('La description est limitée à 12 000 caractères.')
  if (
    !statuses.some((s) => s.id === input.status) ||
    !Object.hasOwn(priorities, input.priority) ||
    !Object.hasOwn(difficulties, input.difficulty)
  )
    throw new Error('Les propriétés du ticket sont invalides.')
  const ids = prerequisiteIds(input)
  if (ids.length > 50 || new Set(ids).size !== ids.length)
    throw new Error('Choisissez au maximum 50 prérequis distincts.')
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const owner = id ? byId.get(id)?.owner_id : undefined
  const walk = (start: string[], kind: 'parent' | 'prerequisite') => {
    const seen = new Set<string>(),
      pending = [...start]
    while (pending.length) {
      const next = pending.pop()!
      if (next === id) throw new Error('Cette relation créerait une boucle entre les tickets.')
      if (seen.has(next)) continue
      seen.add(next)
      const t = byId.get(next)
      if (!t || t.project_id !== input.project_id || (owner && t.owner_id !== owner))
        throw new Error('La relation doit être un ticket de ce projet.')
      pending.push(...(kind === 'parent' ? (t.parent_id ? [t.parent_id] : []) : prerequisiteIds(t)))
    }
  }
  walk(ids, 'prerequisite')
  walk(input.parent_id ? [input.parent_id] : [], 'parent')
}

export function dependencyOptions(
  tickets: Ticket[],
  projectId: string,
  ticketId?: string,
  kind: 'parent' | 'prerequisite' = 'prerequisite',
) {
  return tickets.filter((t) => {
    if (t.project_id !== projectId || t.id === ticketId) return false
    try {
      validateTicket(
        {
          project_id: projectId,
          title: 'test',
          description: '',
          status: 'todo',
          priority: 'medium',
          difficulty: 'medium',
          depends_on_id: null,
          prerequisite_ids: kind === 'prerequisite' ? [t.id] : [],
          parent_id: kind === 'parent' ? t.id : null,
        },
        tickets,
        ticketId,
      )
      return true
    } catch {
      return false
    }
  })
}

export function isBlocked(ticket: Ticket, tickets: Ticket[]) {
  return prerequisiteIds(ticket).some((id) => tickets.find((t) => t.id === id)?.status !== 'done')
}

export function prerequisiteIds(ticket: Pick<Ticket, 'prerequisite_ids' | 'depends_on_id'>) {
  return ticket.prerequisite_ids ?? (ticket.depends_on_id ? [ticket.depends_on_id] : [])
}
export function ticketLinks(input: TicketInput): TicketInput {
  const ids = prerequisiteIds(input)
  return {
    ...input,
    prerequisite_ids: ids,
    depends_on_id: ids[0] || null,
    parent_id: input.parent_id || null,
  }
}
export function unlinkTicket(ticket: Ticket, removed: string): Ticket {
  return {
    ...ticket,
    ...ticketLinks({
      ...ticket,
      prerequisite_ids: prerequisiteIds(ticket).filter((id) => id !== removed),
      parent_id: ticket.parent_id === removed ? null : ticket.parent_id,
    }),
  }
}
/** Parent stays above its children when they share a column. Filtering never hides a child. */
export function nestedTickets(tickets: Ticket[]) {
  const byId = new Map(tickets.map((t) => [t.id, t])),
    children = new Map<string, Ticket[]>()
  for (const t of tickets)
    if (t.parent_id && byId.has(t.parent_id))
      children.set(t.parent_id, [...(children.get(t.parent_id) || []), t])
  const rows: { ticket: Ticket; depth: number }[] = [],
    seen = new Set<string>()
  const visit = (root: Ticket, depth: number) => {
    const stack = [{ ticket: root, depth }]
    while (stack.length) {
      const row = stack.pop()!
      if (seen.has(row.ticket.id)) continue
      seen.add(row.ticket.id)
      rows.push({ ...row, depth: Math.min(row.depth, 2) })
      for (const child of [...(children.get(row.ticket.id) || [])].reverse())
        stack.push({ ticket: child, depth: row.depth + 1 })
    }
  }
  for (const t of tickets) if (!t.parent_id || !byId.has(t.parent_id)) visit(t, 0)
  for (const t of tickets) visit(t, 0)
  return rows
}
export function sortTickets(tickets: Ticket[], sort: 'priority' | 'recent') {
  const rank = ['urgent', 'high', 'medium', 'low']
  return [...tickets].sort(
    (a, b) =>
      (sort === 'recent'
        ? Date.parse(b.updated_at) - Date.parse(a.updated_at)
        : rank.indexOf(a.priority) - rank.indexOf(b.priority)) ||
      a.project_id.localeCompare(b.project_id) ||
      a.number - b.number ||
      a.id.localeCompare(b.id),
  )
}

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(
    new Date(value),
  )
}
export function matchesSearch(query: string, ...values: string[]) {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('fr')
  const haystack = normalize(values.join(' '))
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((word) => {
      if (!word || haystack.includes(word)) return true
      for (
        let start = haystack.indexOf(word[0]);
        start >= 0;
        start = haystack.indexOf(word[0], start + 1)
      ) {
        let j = 1
        for (
          let i = start + 1;
          i < Math.min(haystack.length, start + word.length * 2 + 2) && j < word.length;
          i++
        )
          if (haystack[i] === word[j]) j++
        if (j === word.length) return true
      }
      return false
    })
}
