import { supabase } from './supabase'
export type JobKind = 'summarize' | 'rewrite' | 'transcribe' | 'search'
export type AIJob = {
  context?: { target?: string; hash?: string }
  id: string
  kind: JobKind
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  result: { text?: string; matches?: { id: string; reason: string }[] } | null
  error: string | null
  created_at: string
}
export type PC = { label: string; capabilities: JobKind[]; last_seen: string | null }
export function available(pcs: PC[], kind: JobKind, now = Date.now()) {
  return pcs.some(
    (p) => p.last_seen && now - Date.parse(p.last_seen) < 45000 && p.capabilities.includes(kind),
  )
}
export async function submit(kind: JobKind, input: Record<string, unknown>) {
  if (!supabase || !navigator.onLine) throw new Error('Connexion sécurisée et réseau nécessaires.')
  const id = crypto.randomUUID()
  const { error } = await supabase.rpc('submit_job', { p_id: id, p_kind: kind, p_input: input })
  if (error) throw error
  return id
}
export async function cancelJob(id: string) {
  const { error } = await supabase!.rpc('cancel_job', { p_id: id })
  if (error) throw error
}

export async function textHash(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}
