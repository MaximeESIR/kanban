/** Explicit public demo opt-in. Any Supabase setting disables demo fallback. */
export function demoAllowed(url?: string, key?: string, publicDemo?: string, hostname = '') {
  if (url || key) return false
  return publicDemo === 'true' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}

/** Shared by Vite (before bundling) and the browser; never echo key material. */
export function publicConfigError(url?: string, key?: string): string | null {
  if (!url && !key) return null
  if (!url || !key) return 'Renseignez à la fois l’URL et la clé publique Supabase.'
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co'))
      return 'L’URL Supabase doit être une URL HTTPS de projet supabase.co.'
    if (key.startsWith('sb_secret_'))
      return 'Une clé secrète a été fournie. Utilisez uniquement la clé publique publishable.'
    if (key.startsWith('eyJ')) {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role !== 'anon')
        return 'Seule la clé publique anon est autorisée dans le navigateur.'
    } else if (!key.startsWith('sb_publishable_')) return 'La clé Supabase publique est invalide.'
    return null
  } catch {
    return 'La configuration Supabase est invalide.'
  }
}
