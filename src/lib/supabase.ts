import { createClient } from '@supabase/supabase-js'
import { demoAllowed, publicConfigError } from '../config'
import { serverClock } from './serverClock'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const configured = Boolean(url && key)
export const demoEnabled = demoAllowed(
  url,
  key,
  import.meta.env.VITE_PUBLIC_DEMO,
  window.location.hostname,
)

export const configError = publicConfigError(url, key)
export const supabase =
  configured && !configError
    ? createClient(url!, key!, {
        global: {
          fetch: async (input, init) => {
            const response = await fetch(input, init)
            // Supabase exposes Date through CORS. Calibrate before callers
            // render last_seen values, including after focus/reconnection.
            serverClock.observe(response.headers.get('date'))
            return response
          },
        },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      })
    : null

export function friendlyError(error: unknown): string {
  const e = error as { message?: string; code?: string; status?: number }
  if (!navigator.onLine)
    return 'Vous êtes hors connexion. Vos modifications ne sont pas encore enregistrées.'
  if (e?.code === 'invalid_credentials') return 'Adresse e-mail ou mot de passe incorrect.'
  if (e?.code === 'over_request_rate_limit' || e?.status === 429)
    return 'Trop de tentatives. Réessayez dans quelques instants.'
  if (e?.code === '23503') return 'Ce projet ou cette dépendance n’existe plus. Actualisez la page.'
  if (e?.code === '23514' || e?.code === 'P0001')
    return e.message || 'Ces données ne sont pas valides.'
  if (e?.code === '42501') return 'Votre compte n’est pas autorisé à accéder à cet espace.'
  if (e?.code === 'PGRST116') return 'Cet élément a été modifié ou supprimé. Actualisez la page.'
  if (/fetch|network/i.test(e?.message || ''))
    return 'Connexion impossible. Vérifiez votre réseau, puis réessayez.'
  return e?.message || 'Une erreur est survenue. Réessayez.'
}
