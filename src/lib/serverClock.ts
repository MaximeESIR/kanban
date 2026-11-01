/** Presence timestamps come from Supabase, never from the device's wall clock. */
export function createServerClock(
  monotonicNow = () => performance.now(),
  wallNow = () => Date.now(),
) {
  let anchor: { server: number; monotonic: number } | null = null
  return {
    observe(date: string | null) {
      const server = date ? Date.parse(date) : NaN
      if (Number.isFinite(server)) anchor = { server, monotonic: monotonicNow() }
    },
    now() {
      return anchor ? anchor.server + Math.max(0, monotonicNow() - anchor.monotonic) : wallNow()
    },
  }
}

export const serverClock = createServerClock()
export const serverNow = () => serverClock.now()

export function recentlySeen(timestamp: string | null, now = serverNow()) {
  if (!timestamp) return false
  const age = now - Date.parse(timestamp)
  // HTTP Date has second precision; tolerate rounding, not arbitrary future dates.
  return Number.isFinite(age) && age >= -5000 && age < 45000
}
