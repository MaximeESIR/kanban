import type { TicketInput } from '../domain'

export interface TicketDraft {
  id: string
  owner: string
  project: string
  ticket?: string
  baseVersion?: string
  input: TicketInput
  updatedAt: string
}
const prefix = (owner: string) => `atelier-ticket-draft:${owner}:`
export function listTicketDrafts(owner: string): TicketDraft[] {
  const drafts: TicketDraft[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (!key.startsWith(prefix(owner))) continue
    try {
      const d = JSON.parse(localStorage.getItem(key)!) as TicketDraft
      if (
        d.owner === owner &&
        typeof d.id === 'string' &&
        typeof d.project === 'string' &&
        typeof d.input?.title === 'string' &&
        typeof d.input?.description === 'string'
      )
        drafts.push(d)
    } catch {
      /* Keep unreadable records for manual recovery; never overwrite them. */
    }
  }
  return drafts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
export function writeTicketDraft(draft: TicketDraft) {
  localStorage.setItem(prefix(draft.owner) + draft.id, JSON.stringify(draft))
}
export function removeTicketDraft(owner: string, id: string) {
  localStorage.removeItem(prefix(owner) + id)
}
export function clearTicketDrafts(owner: string) {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
  for (const key of keys) if (key.startsWith(prefix(owner))) localStorage.removeItem(key)
}
