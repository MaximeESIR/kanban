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
  created_at: string
  updated_at: string
}
export interface Note {
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
  'project_id' | 'title' | 'description' | 'priority' | 'difficulty' | 'status' | 'depends_on_id'
>
export type NoteInput = Pick<Note, 'title' | 'content'>
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
  if (!input.depends_on_id) return
  const seen = new Set<string>(id ? [id] : [])
  let next: string | null = input.depends_on_id
  while (next) {
    if (seen.has(next)) throw new Error('Cette dépendance créerait une boucle entre les tickets.')
    seen.add(next)
    const dependency = tickets.find((t) => t.id === next)
    if (!dependency || dependency.project_id !== input.project_id)
      throw new Error('La dépendance doit être un ticket de ce projet.')
    next = dependency.depends_on_id
  }
}

export function dependencyOptions(tickets: Ticket[], projectId: string, ticketId?: string) {
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
          depends_on_id: t.id,
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
  return Boolean(
    ticket.depends_on_id &&
    tickets.some((t) => t.id === ticket.depends_on_id && t.status !== 'done'),
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
  return normalize(values.join(' ')).includes(normalize(query.trim()))
}
