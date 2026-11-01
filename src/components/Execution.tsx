import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Play, Monitor, Check } from 'lucide-react'
import { supabase, friendlyError } from '../lib/supabase'
import { isBlocked, type Project, type Ticket } from '../domain'
import { recentlySeen, serverNow } from '../lib/serverClock'

type LocalRepository = {
  id: string
  label: string
  local_path: string
  enabled: boolean
  last_seen: string
}
type Binding = { project_id: string; repository_id: string }
type Run = {
  id: string
  ticket_id: string
  status: 'queued' | 'running' | 'review' | 'approved' | 'failed' | 'cancelled'
  phase: string
  error: string | null
  result: {
    summary?: string
    tests?: string[]
    limitations?: string[]
    branch?: string
    worktree?: string
    changes?: string
  } | null
}
const ExecutionContext = createContext<{
  repositories: LocalRepository[]
  bindings: Binding[]
  runs: Run[]
  error: string
  connected: boolean
}>({ repositories: [], bindings: [], runs: [], error: '', connected: false })
export function ExecutionProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [state, setState] = useState({
    repositories: [] as LocalRepository[],
    bindings: [] as Binding[],
    runs: [] as Run[],
    error: '',
  })
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!enabled || !supabase) return
    let live = true,
      inflight = false,
      again = false
    const refresh = async () => {
      if (!navigator.onLine) return
      if (inflight) {
        again = true
        return
      }
      inflight = true
      try {
        const [r, b, j, active] = await Promise.all([
          supabase!.from('worker_repositories').select('*').order('label'),
          supabase!.from('project_repositories').select('*'),
          supabase!
            .from('development_runs')
            .select('id,ticket_id,status,phase,error,result')
            .order('created_at', { ascending: false })
            .limit(200),
          supabase!
            .from('development_runs')
            .select('id,ticket_id,status,phase,error,result')
            .in('status', ['queued', 'running', 'review'])
            .order('created_at', { ascending: false }),
        ])
        if (r.error || b.error || j.error || active.error)
          throw r.error || b.error || j.error || active.error
        if (live)
          setState({
            repositories: r.data || [],
            bindings: b.data || [],
            runs: [
              ...((active.data as Run[]) || []),
              ...((j.data as Run[]) || []).filter(
                (x) => !((active.data as Run[]) || []).some((a) => a.id === x.id),
              ),
            ],
            error: '',
          })
      } catch {
        if (live)
          setState((s) => ({
            ...s,
            error: 'Exécution PC indisponible. Vérifiez la migration 005 et le service PC.',
          }))
      } finally {
        inflight = false
        if (again && live) {
          again = false
          void refresh()
        }
      }
    }
    const trigger = () => void refresh()
    const status = (e: Event) => setConnected(Boolean((e as CustomEvent).detail))
    for (const event of ['atelier-execution-refresh', 'online', 'focus'])
      window.addEventListener(event, trigger)
    window.addEventListener('atelier-realtime-status', status)
    trigger()
    return () => {
      live = false
      for (const event of ['atelier-execution-refresh', 'online', 'focus'])
        window.removeEventListener(event, trigger)
      window.removeEventListener('atelier-realtime-status', status)
    }
  }, [enabled])
  return (
    <ExecutionContext.Provider value={{ ...state, connected }}>
      {children}
    </ExecutionContext.Provider>
  )
}
async function action(name: string, params: Record<string, unknown>) {
  if (!supabase || !navigator.onLine) throw new Error('Une connexion sécurisée est nécessaire.')
  const { error } = await supabase.rpc(name, params)
  if (error) throw error
  window.dispatchEvent(new Event('atelier-execution-refresh'))
  window.dispatchEvent(new Event('atelier-workspace-refresh'))
}
export function ProjectRepository({ project, enabled }: { project: Project; enabled: boolean }) {
  const { repositories, bindings, error, connected } = useContext(ExecutionContext)
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const selected = bindings.find((b) => b.project_id === project.id)?.repository_id || ''
  const repo = repositories.find((r) => r.id === selected)
  return (
    <details className="repository-panel">
      <summary>
        <Monitor size={16} /> {repo ? `Dépôt : ${repo.label}` : 'Associer un dépôt sur le PC'}
      </summary>
      {!enabled ? (
        <p>
          Activez Supabase et le service PC pour exécuter vos tickets. La démonstration reste locale
          au navigateur.
        </p>
      ) : (
        <>
          <label>
            Dépôt autorisé
            <select
              aria-label="Dépôt du projet"
              value={selected}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true)
                setMessage('')
                try {
                  await action('bind_project_repository', {
                    p_project: project.id,
                    p_repository: e.target.value || null,
                  })
                } catch (e) {
                  setMessage(friendlyError(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <option value="">Choisir un dépôt…</option>
              {repositories.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.local_path}
                </option>
              ))}
            </select>
          </label>
          {repo && <p className="repository-path">{repo.local_path}</p>}
          {!repositories.length && (
            <p>
              Sur le PC, enregistrez d’abord le chemin du dépôt avec le script Atelier. Il
              apparaîtra ici automatiquement.
            </p>
          )}
          {repo && !repo.enabled && (
            <p>Le PC n’a pas autorisé l’exécution. Lancez le diagnostic local avant Run.</p>
          )}
          <p>
            Une seule session Codex à la fois. Les changements restent sur une branche locale, à
            vérifier et à fusionner sur le PC.
          </p>
          <small>
            {connected
              ? 'Suivi en direct connecté'
              : 'Suivi en direct déconnecté — reconnexion automatique'}
          </small>
          {(message || error) && <p role="alert">{message || error}</p>}
        </>
      )}
      <a
        href="https://github.com/MaximeESIR/kanban/blob/main/docs/CONNEXION-PC.md"
        target="_blank"
        rel="noreferrer"
      >
        Guide de connexion du PC
      </a>
    </details>
  )
}
export function TicketExecution({
  ticket,
  tickets,
  enabled,
  compact = false,
  unsaved = false,
  onOpen,
}: {
  ticket: Ticket
  tickets: Ticket[]
  enabled: boolean
  compact?: boolean
  unsaved?: boolean
  onOpen?: () => void
}) {
  const { repositories, bindings, runs, error: connectionError } = useContext(ExecutionContext)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [, refreshClock] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => refreshClock((value) => value + 1), 15000)
    return () => clearInterval(timer)
  }, [])
  const now = serverNow()
  const repo = repositories.find(
    (r) => r.id === bindings.find((b) => b.project_id === ticket.project_id)?.repository_id,
  )
  const run = runs.find((r) => r.ticket_id === ticket.id)
  const active = run && ['queued', 'running', 'review'].includes(run.status)
  const blocked = isBlocked(ticket, tickets)
  const reason = !enabled
    ? 'Connectez Supabase et votre PC pour utiliser Run.'
    : connectionError ||
      (unsaved
        ? 'Enregistrez les modifications avant Run.'
        : !repo
          ? 'Associez un dépôt autorisé à ce projet.'
          : !repo.enabled
            ? 'Exécution non autorisée sur le PC : lancez le diagnostic local.'
            : !recentlySeen(repo.last_seen, now)
              ? 'Le PC est déconnecté.'
              : !navigator.onLine
                ? 'Vous êtes hors ligne.'
                : blocked
                  ? 'Terminez les prérequis.'
                  : '')
  async function call(name: string, params: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await action(name, params)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className={`ticket-execution ${compact ? 'compact' : ''}`}
      aria-label={`Exécution de ${ticket.title}`}
    >
      {run && (
        <button
          type="button"
          className="text-button run-phase"
          onClick={onOpen}
          disabled={!onOpen}
          aria-label={`Suivi : ${run.phase}`}
        >
          {run.phase}
        </button>
      )}
      {!active && ticket.status !== 'done' && (
        <button
          type="button"
          className="button secondary run-button"
          title={reason || 'Exécuter ce ticket sur le PC'}
          disabled={busy || Boolean(reason)}
          onClick={() =>
            void call('submit_development', {
              p_id: crypto.randomUUID(),
              p_ticket: ticket.id,
              p_version: ticket.updated_at,
            })
          }
        >
          <Play size={14} /> Run
        </button>
      )}
      {!compact && (
        <>
          {!active && reason && <small>{reason}</small>}
          {run?.result && (
            <div className="run-report">
              <p>{run.result.summary}</p>
              {run.result.tests?.length ? (
                <>
                  <strong>Vérifications</strong>
                  <ul>
                    {run.result.tests.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Aucun résultat de test communiqué.</p>
              )}
              {run.result.limitations?.length ? (
                <>
                  <strong>Limites / à vérifier</strong>
                  <ul>
                    {run.result.limitations.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {run.result.branch && (
                <p>
                  Branche locale : <code>{run.result.branch}</code>
                </p>
              )}
              {run.result.worktree && (
                <details>
                  <summary>Emplacement sur le PC</summary>
                  <code>{run.result.worktree}</code>
                  {run.result.changes && <pre>{run.result.changes}</pre>}
                </details>
              )}
            </div>
          )}
          {run?.error && <p role="alert">{run.error}</p>}
          {run?.status === 'review' && (
            <>
              <p>
                Vérifiez les changements et les tests. Valider ferme le ticket ; la fusion du code
                reste à faire sur le PC.
              </p>
              <button
                type="button"
                className="button primary"
                disabled={busy || unsaved || blocked}
                onClick={() =>
                  void call('approve_development', { p_id: run.id, p_version: ticket.updated_at })
                }
              >
                <Check size={16} /> Valider et passer à Done
              </button>
            </>
          )}
          {active && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void call('cancel_development', { p_id: run.id })}
            >
              {run.status === 'review' ? 'Écarter ce résultat' : 'Annuler l’exécution'}
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
