import { get, set, del } from 'idb-keyval'
import {
  type Data,
  type ProjectInput,
  type TicketInput,
  type NoteInput,
  ticketLinks,
  unlinkTicket,
} from '../domain'
import { type Repository } from './repository'
import { supabase } from './supabase'
export type Op = {
  request: string
  table: keyof Data
  id: string
  base: string | null
  remove: boolean
  values: Record<string, unknown>
}
type State = { data: Data; ops: Op[]; conflicts: { at: string; table: string; values: unknown }[] }
export const syncEvent = 'atelier-sync'
export function versionConflict(base: string | null, remote: { updated_at: string } | null) {
  return remote ? base !== remote.updated_at : base !== null
}
export function offlineRepository(owner: string, remote: Repository): Repository {
  const key = `atelier-private-${owner}`
  const lock = <T>(fn: () => Promise<T>) => navigator.locks.request(key, fn)
  const notify = (s: State) =>
    window.dispatchEvent(
      new CustomEvent(syncEvent, {
        detail: { pending: s.ops.length, conflicts: s.conflicts.length },
      }),
    )
  const read = () => get<State>(key)
  const save = async (s: State) => {
    await set(key, s)
    notify(s)
  }
  async function synchronize(s: State) {
    if (!navigator.onLine) return s
    while (s.ops.length) {
      const op = s.ops[0]
      const { data: r, error } = await supabase!.rpc('sync_write', {
        p_request: op.request,
        p_table: op.table,
        p_id: op.id,
        p_base: op.base,
        p_delete: op.remove,
        p_values: op.values,
      })
      if (error) {
        if (!navigator.onLine || /fetch|network/i.test(error.message)) break
        // A prerequisite/project may have been deleted by another device while offline.
        // Preserve that edit for recovery, without blocking every subsequent mutation.
        if (['23503', '23514', '23505', '22023', '22P02', 'P0001'].includes(error.code)) {
          s.conflicts.push({
            at: new Date().toISOString(),
            table: op.table,
            values: { ...op.values, id: op.id, _rejected: error.message },
          })
          s.ops.shift()
          await save(s)
          continue
        }
        throw error
      }
      if (r.conflict)
        s.conflicts.push({ at: new Date().toISOString(), table: op.table, values: op.values })
      if (r.row) {
        const rows = s.data[op.table] as { id: string; updated_at: string }[]
        const i = rows.findIndex((x) => x.id === op.id)
        if (i >= 0) rows[i] = { ...rows[i], ...r.row }
        // Later operations on the same item must use the acknowledged version.
        for (const next of s.ops.slice(1))
          if (next.id === op.id && next.table === op.table) next.base = r.row.updated_at
      }
      s.ops.shift()
      await save(s)
    }
    if (!s.ops.length) {
      s.data = await remote.load()
      await save(s)
    }
    return s
  }
  async function load() {
    return lock(async () => {
      let s = await read()
      if (!s) {
        s = { data: await remote.load(), ops: [], conflicts: [] }
        await save(s)
      }
      try {
        s = await synchronize(s)
      } catch (e) {
        notify(s)
        if (navigator.onLine) throw e
      }
      notify(s)
      return s.data
    })
  }
  async function mutate(
    table: keyof Data,
    values: Record<string, unknown>,
    id?: string,
    remove = false,
    expectedVersion?: string,
  ) {
    return lock(async () => {
      const s = await read()
      if (!s) throw new Error('Ouvrez une première fois votre espace en ligne.')
      const rows = s.data[table] as any[]
      const old = rows.find((x) => x.id === id)
      if (id && !old) throw new Error('Cet élément a été supprimé.')
      if (expectedVersion && old?.updated_at !== expectedVersion)
        throw new Error(
          'Ce ticket a changé depuis son ouverture. Votre brouillon est conservé ; rouvrez le ticket pour comparer ou créez une copie.',
        )
      const now = new Date().toISOString()
      const row = {
        ...old,
        ...values,
        id: id || crypto.randomUUID(),
        owner_id: owner,
        created_at: old?.created_at || now,
        updated_at: now,
      }
      if (table === 'tickets' && !old) row.number = -Math.floor(Date.now() / 1000)
      const prior = [...s.ops].reverse().find((x) => x.id === row.id && x.table === table)
      // Keep every operation receipt immutable; base will be advanced after each acknowledgement.
      const op: Op = {
        request: crypto.randomUUID(),
        table,
        id: row.id,
        base: old?.updated_at || null,
        remove,
        values: remove ? { ...old } : values,
      }
      if (prior) op.base = old?.updated_at || null
      s.ops.push(op)
      ;(s.data[table] as any) = remove
        ? rows.filter((x) => x.id !== id)
        : old
          ? rows.map((x) => (x.id === id ? row : x))
          : [...rows, row]
      if (remove && table === 'projects')
        s.data.tickets = s.data.tickets.filter((x) => x.project_id !== id)
      if (remove && table === 'tickets')
        s.data.tickets = s.data.tickets.map((x) => unlinkTicket(x, id!))
      await save(s)
      // Updates remain local until the next background flush; UI never waits for the network.
      return row
    })
  }
  return {
    load,
    project: (v: ProjectInput, id) => mutate('projects', v, id),
    ticket: (v: TicketInput, id, expectedVersion) =>
      mutate('tickets', ticketLinks(v), id, false, expectedVersion),
    note: (v: NoteInput, id) => mutate('notes', v, id),
    remove: async (t, id) => {
      await mutate(t, {}, id, true)
    },
  }
}
export async function clearOffline(owner: string) {
  await del(`atelier-private-${owner}`)
}
export async function exportOffline(owner: string) {
  const s = await get<State>(`atelier-private-${owner}`)
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'atelier-sauvegarde-et-conflits.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function recoverConflicts(owner: string) {
  const key = `atelier-private-${owner}`
  await navigator.locks.request(key, async () => {
    const s = await get<State>(key)
    if (!s) return
    for (const conflict of s.conflicts) {
      const v = conflict.values as Record<string, unknown>,
        id = crypto.randomUUID(),
        now = new Date().toISOString()
      const values = {
        title: `Copie conflit — ${String(v.title || v.name || conflict.table)}`.slice(0, 160),
        content:
          `${v._rejected ? `Modification refusée : ${String(v._rejected)}\n\n` : ''}${String(v.content || v.description || JSON.stringify(v, null, 2))}`.slice(
            0,
            2000000,
          ),
        category: 'pro' as const,
      }
      s.data.notes.push({ ...values, id, owner_id: owner, created_at: now, updated_at: now })
      s.ops.push({
        request: crypto.randomUUID(),
        table: 'notes',
        id,
        base: null,
        remove: false,
        values,
      })
    }
    s.conflicts = []
    await set(key, s)
    window.dispatchEvent(
      new CustomEvent(syncEvent, { detail: { pending: s.ops.length, conflicts: 0 } }),
    )
  })
}
