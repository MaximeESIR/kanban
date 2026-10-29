import {
  type Data,
  type Note,
  type NoteInput,
  type Project,
  type ProjectInput,
  type Ticket,
  type TicketInput,
  validateProject,
  validateTicket,
} from '../domain'
import { DEMO_OWNER, DEMO_STORAGE, demoData } from './demo'
import { supabase } from './supabase'

export interface Repository {
  load(): Promise<Data>
  project(input: ProjectInput, id?: string): Promise<Project>
  ticket(input: TicketInput, id?: string): Promise<Ticket>
  note(input: NoteInput, id?: string): Promise<Note>
  remove(kind: 'projects' | 'tickets' | 'notes', id: string): Promise<void>
}

export function createDemoRepository(): Repository {
  const read = (): Data => {
    const raw = localStorage.getItem(DEMO_STORAGE)
    if (!raw) {
      const initial = demoData()
      write(initial)
      return initial
    }
    try {
      const parsed = JSON.parse(raw) as Data
      if (
        !Array.isArray(parsed.projects) ||
        !Array.isArray(parsed.tickets) ||
        !Array.isArray(parsed.notes)
      )
        throw new Error()
      return parsed
    } catch {
      throw new Error(
        'Les données de démonstration sont illisibles. Utilisez « Réinitialiser la démo » sur la page de connexion.',
      )
    }
  }
  const write = (data: Data) => localStorage.setItem(DEMO_STORAGE, JSON.stringify(data))
  const stamp = () => ({
    owner_id: DEMO_OWNER,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return {
    async load() {
      return read()
    },
    async project(input, id) {
      validateProject(input)
      const data = read(),
        existing = data.projects.find((p) => p.id === id)
      if (id && !existing) throw new Error('Ce projet a été supprimé.')
      const project: Project = {
        ...stamp(),
        ...existing,
        ...input,
        name: input.name.trim(),
        id: id || crypto.randomUUID(),
        updated_at: new Date().toISOString(),
      }
      data.projects = existing
        ? data.projects.map((p) => (p.id === id ? project : p))
        : [...data.projects, project]
      write(data)
      return project
    },
    async ticket(input, id) {
      const data = read()
      validateTicket(input, data.tickets, id)
      if (!data.projects.some((p) => p.id === input.project_id))
        throw new Error('Ce projet a été supprimé.')
      const existing = data.tickets.find((t) => t.id === id)
      if (id && !existing) throw new Error('Ce ticket a été supprimé.')
      const ticket: Ticket = {
        ...stamp(),
        number: Math.max(0, ...data.tickets.map((t) => t.number)) + 1,
        ...existing,
        ...input,
        title: input.title.trim(),
        id: id || crypto.randomUUID(),
        updated_at: new Date().toISOString(),
      }
      data.tickets = existing
        ? data.tickets.map((t) => (t.id === id ? ticket : t))
        : [...data.tickets, ticket]
      write(data)
      return ticket
    },
    async note(input, id) {
      const data = read(),
        existing = data.notes.find((n) => n.id === id)
      if (id && !existing) throw new Error('Cette note a été supprimée.')
      const note: Note = {
        ...stamp(),
        ...existing,
        ...input,
        id: id || crypto.randomUUID(),
        updated_at: new Date().toISOString(),
      }
      data.notes = existing
        ? data.notes.map((n) => (n.id === id ? note : n))
        : [note, ...data.notes]
      write(data)
      return note
    },
    async remove(kind, id) {
      const data = read()
      if (kind === 'projects') {
        data.projects = data.projects.filter((p) => p.id !== id)
        data.tickets = data.tickets.filter((t) => t.project_id !== id)
      }
      if (kind === 'tickets')
        data.tickets = data.tickets
          .filter((t) => t.id !== id)
          .map((t) => (t.depends_on_id === id ? { ...t, depends_on_id: null } : t))
      if (kind === 'notes') data.notes = data.notes.filter((n) => n.id !== id)
      write(data)
    },
  }
}

export function createRemoteRepository(ownerId: string): Repository {
  const client = supabase!
  return {
    async load() {
      const allowed = await client.rpc('can_access_atelier')
      if (allowed.error) throw allowed.error
      if (!allowed.data)
        throw new Error(
          'Votre compte n’est pas autorisé. Ajoutez votre identifiant à la liste des propriétaires dans Supabase.',
        )
      const results = await Promise.all([
        client.from('projects').select('*').order('created_at', { ascending: true }),
        client.from('tickets').select('*').order('number'),
        client.from('notes').select('*').order('updated_at', { ascending: false }),
      ])
      for (const result of results) if (result.error) throw result.error
      return {
        projects: results[0].data as Project[],
        tickets: results[1].data as Ticket[],
        notes: results[2].data as Note[],
      }
    },
    async project(input, id) {
      validateProject(input)
      const values = { ...input, name: input.name.trim() }
      const { data, error } = await (
        id
          ? client.from('projects').update(values).eq('id', id).eq('owner_id', ownerId)
          : client.from('projects').insert({ ...values, owner_id: ownerId })
      )
        .select()
        .single()
      if (error) throw error
      return data as Project
    },
    async ticket(input, id) {
      const values = { ...input, title: input.title.trim() }
      const { data, error } = await (
        id
          ? client.from('tickets').update(values).eq('id', id).eq('owner_id', ownerId)
          : client.from('tickets').insert({ ...values, owner_id: ownerId })
      )
        .select()
        .single()
      if (error) throw error
      return data as Ticket
    },
    async note(input, id) {
      const { data, error } = await (
        id
          ? client.from('notes').update(input).eq('id', id).eq('owner_id', ownerId)
          : client.from('notes').insert({ ...input, owner_id: ownerId })
      )
        .select()
        .single()
      if (error) throw error
      return data as Note
    },
    async remove(kind, id) {
      const { error, data } = await client
        .from(kind)
        .delete()
        .eq('id', id)
        .eq('owner_id', ownerId)
        .select('id')
      if (error) throw error
      if (!data?.length)
        throw new Error('Cet élément n’existe plus ou vous n’avez pas accès à sa suppression.')
    },
  }
}
