import { supabase } from './supabase'
/** One subscription per signed-in workspace. Contains metadata only; RLS filters owner. */
export function subscribeWorkspace() {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`atelier-${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'atelier_events' },
      ({ new: row }) => {
        const kind = (row as { kind?: string }).kind
        if (kind === 'workspace') window.dispatchEvent(new Event('atelier-workspace-refresh'))
        if (kind === 'jobs') window.dispatchEvent(new Event('atelier-pc-refresh'))
        if (kind === 'runs' || kind === 'repositories')
          window.dispatchEvent(new Event('atelier-execution-refresh'))
      },
    )
    .subscribe((status) => {
      window.dispatchEvent(
        new CustomEvent('atelier-realtime-status', { detail: status === 'SUBSCRIBED' }),
      )
      if (status === 'SUBSCRIBED') {
        // Initial load / reconnect catch-up comes after subscription, so no missed window.
        for (const name of ['workspace', 'pc', 'execution'])
          window.dispatchEvent(new Event(`atelier-${name}-refresh`))
      }
    })
  return () => {
    void supabase!.removeChannel(channel)
  }
}
