import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Download,
  FileText,
  FolderKanban,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react'
import { Auth } from './components/Auth'
import { Projects, Board } from './components/Projects'
import { Notes } from './components/Notes'
import { DeleteDialog, ProjectForm, TicketForm } from './components/Forms'
import { Brand, EmptyState, ProjectIcon, Spinner } from './components/ui'
import {
  emptyData,
  validateTicket,
  type Data,
  type Note,
  type NoteInput,
  type Project,
  type ProjectInput,
  type Status,
  type Ticket,
  type TicketInput,
} from './domain'
import { DEMO_EMAIL, DEMO_OWNER, DEMO_SESSION } from './lib/demo'
import { demoEnabled, friendlyError, supabase } from './lib/supabase'
import { createDemoRepository, createRemoteRepository, type Repository } from './lib/repository'

type Identity = { id: string; email: string; demo: boolean }
type Route = { view: 'projects' | 'notes'; project?: string; note?: string }
type Dialog =
  | { kind: 'project'; project?: Project }
  | { kind: 'ticket'; project: Project; ticket?: Ticket; status?: Status }
  | {
      kind: 'delete'
      entity: 'projects' | 'tickets' | 'notes'
      id: string
      title: string
      description: string
    }

function readRoute(): Route {
  const params = new URLSearchParams(location.search)
  return {
    view: params.get('view') === 'notes' ? 'notes' : 'projects',
    project: params.get('project') || undefined,
    note: params.get('note') || undefined,
  }
}

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(
    new URLSearchParams(location.search).get('recovery') === '1',
  )
  useEffect(() => {
    if (!supabase) {
      try {
        if (demoEnabled && sessionStorage.getItem(DEMO_SESSION))
          setIdentity({ id: DEMO_OWNER, email: DEMO_EMAIL, demo: true })
      } catch {
        /* Demo can still be opened without a persisted session. */
      }
      setLoading(false)
      return
    }
    let alive = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setIdentity(
        session?.user
          ? { id: session.user.id, email: session.user.email || '', demo: false }
          : null,
      )
      setLoading(false)
    })
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) {
          setIdentity(
            data.session
              ? { id: data.session.user.id, email: data.session.user.email || '', demo: false }
              : null,
          )
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])
  function finishRecovery() {
    const url = new URL(location.href)
    url.searchParams.delete('recovery')
    history.replaceState(null, '', url)
    setRecovery(false)
  }
  async function logout() {
    if (identity?.demo) {
      try {
        sessionStorage.removeItem(DEMO_SESSION)
      } catch {
        /* No session storage. */
      }
      setIdentity(null)
    } else {
      const result = await supabase!.auth.signOut({ scope: 'local' })
      if (result.error) throw result.error
      setIdentity(null)
    }
    finishRecovery()
  }
  if (loading)
    return (
      <div className="loading-page">
        <Brand />
        <Spinner />
        <p>On ouvre votre atelier…</p>
      </div>
    )
  if (!identity || recovery)
    return (
      <Auth
        recovery={Boolean(identity && recovery)}
        onRecovered={finishRecovery}
        onDemo={() => {
          try {
            sessionStorage.setItem(DEMO_SESSION, 'true')
          } catch {
            /* Session remains available in memory. */
          }
          setIdentity({ id: DEMO_OWNER, email: DEMO_EMAIL, demo: true })
        }}
      />
    )
  return (
    <Workspace
      key={identity.id}
      identity={identity}
      onLogout={logout}
      onPassword={() => setRecovery(true)}
    />
  )
}

function Workspace({
  identity,
  onLogout,
  onPassword,
}: {
  identity: Identity
  onLogout: () => Promise<void>
  onPassword: () => void
}) {
  const repo: Repository = useMemo(
    () => (identity.demo ? createDemoRepository() : createRemoteRepository(identity.id)),
    [identity.demo, identity.id],
  )
  const [data, setData] = useState<Data>(emptyData)
  const [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(''),
    [refreshing, setRefreshing] = useState(false)
  const [route, setRoute] = useState<Route>(readRoute)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [working, setWorking] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const revision = useRef(0),
    loadRequest = useRef(0),
    active = useRef(true),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drafts = useRef(new Map<string, NoteInput>()),
    noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    noteFlights = useRef(new Map<string, Promise<void>>()),
    noteErrors = useRef(new Map<string, string>())
  const [, setDraftTick] = useState(0)
  const bump = () => {
    if (active.current) setDraftTick((v) => v + 1)
  }
  const announce = useCallback((text: string, error = false) => {
    setToast({ text, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), error ? 8000 : 3500)
  }, [])
  const refresh = useCallback(async () => {
    const stamp = revision.current,
      request = ++loadRequest.current
    setRefreshing(true)
    try {
      const next = await repo.load()
      if (active.current && request === loadRequest.current && revision.current === stamp) {
        setData(next)
        setLoaded(true)
        setLoadError('')
      }
    } catch (err) {
      if (active.current && request === loadRequest.current) setLoadError(friendlyError(err))
    } finally {
      if (active.current && request === loadRequest.current) setRefreshing(false)
    }
  }, [repo])
  useEffect(() => {
    active.current = true
    void refresh()
    const onFocus = () => {
      if (navigator.onLine && !document.hidden) void refresh()
    }
    const onOnline = () => {
        setOnline(true)
        onFocus()
      },
      onOffline = () => setOnline(false)
    const pop = () => setRoute(readRoute())
    const interval = setInterval(onFocus, 60000)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('popstate', pop)
    const unload = (event: BeforeUnloadEvent) => {
      if (drafts.current.size) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      active.current = false
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('popstate', pop)
      window.removeEventListener('beforeunload', unload)
      for (const timer of noteTimers.current.values()) clearTimeout(timer)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [refresh])

  function navigate(next: Route) {
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    if (next.view === 'notes') url.searchParams.set('view', 'notes')
    if (next.project) url.searchParams.set('project', next.project)
    if (next.note) url.searchParams.set('note', next.note)
    history.pushState(null, '', url)
    setRoute(next)
    window.scrollTo({ top: 0 })
  }
  async function action<T>(operation: () => Promise<T>): Promise<T> {
    revision.current++
    setWorking((v) => v + 1)
    try {
      return await operation()
    } finally {
      revision.current++
      if (active.current) setWorking((v) => Math.max(0, v - 1))
    }
  }
  async function saveProject(input: ProjectInput, id?: string) {
    const saved = await action(() => repo.project(input, id))
    setData((d) => ({
      ...d,
      projects: id ? d.projects.map((p) => (p.id === id ? saved : p)) : [...d.projects, saved],
    }))
    announce(id ? 'Projet mis à jour.' : 'Votre nouveau projet est prêt.')
    if (!id) navigate({ view: 'projects', project: saved.id })
  }
  async function saveTicket(input: TicketInput, id?: string, quiet = false) {
    validateTicket(input, data.tickets, id)
    const saved = await action(() => repo.ticket(input, id))
    setData((d) => ({
      ...d,
      tickets: id ? d.tickets.map((t) => (t.id === id ? saved : t)) : [...d.tickets, saved],
    }))
    if (!quiet) announce(id ? 'Ticket mis à jour.' : 'Ticket ajouté au projet.')
  }
  async function moveTicket(ticket: Ticket, status: Status) {
    try {
      await saveTicket(
        {
          project_id: ticket.project_id,
          title: ticket.title,
          description: ticket.description,
          priority: ticket.priority,
          difficulty: ticket.difficulty,
          depends_on_id: ticket.depends_on_id,
          status,
        },
        ticket.id,
        true,
      )
      announce(`« ${ticket.title} » déplacé.`)
    } catch (err) {
      announce(friendlyError(err), true)
    }
  }
  async function createNote() {
    try {
      const note = await action(() => repo.note({ title: '', content: '' }))
      setData((d) => ({ ...d, notes: [note, ...d.notes] }))
      navigate({ view: 'notes', note: note.id })
      announce('Une nouvelle page pour vos idées.')
    } catch (err) {
      announce(friendlyError(err), true)
    }
  }
  function editNote(id: string, input: NoteInput) {
    drafts.current.set(id, input)
    noteErrors.current.delete(id)
    bump()
    const timer = noteTimers.current.get(id)
    if (timer) clearTimeout(timer)
    noteTimers.current.set(
      id,
      setTimeout(() => {
        void flushNote(id).catch(() => {})
      }, 700),
    )
  }
  async function flushNote(id: string): Promise<void> {
    const timer = noteTimers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      noteTimers.current.delete(id)
    }
    const running = noteFlights.current.get(id)
    if (running) {
      await running
      if (drafts.current.has(id)) await flushNote(id)
      return
    }
    const draft = drafts.current.get(id)
    if (!draft) return
    const job = action(() => repo.note(draft, id))
      .then((saved) => {
        if (active.current)
          setData((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? saved : n)) }))
        if (drafts.current.get(id) === draft) drafts.current.delete(id)
        noteErrors.current.delete(id)
      })
      .catch((err) => {
        noteErrors.current.set(id, friendlyError(err))
        throw err
      })
      .finally(() => {
        noteFlights.current.delete(id)
        bump()
      })
    noteFlights.current.set(id, job)
    bump()
    await job
  }
  async function flushAll() {
    // A user can keep typing while an earlier request is still in flight.
    // Drain the latest versions too before allowing logout or password changes.
    while (drafts.current.size) {
      const results = await Promise.allSettled([...drafts.current.keys()].map(flushNote))
      if (results.some((r) => r.status === 'rejected')) {
        announce(
          'Une note n’a pas pu être enregistrée. Réessayez avant de quitter votre espace.',
          true,
        )
        return false
      }
    }
    return true
  }
  async function leave(password = false) {
    if (!(await flushAll())) return
    try {
      if (password) onPassword()
      else await onLogout()
    } catch (err) {
      announce(friendlyError(err), true)
    }
  }

  function confirmDelete(entity: 'projects' | 'tickets' | 'notes', item: Project | Ticket | Note) {
    setDialog({
      kind: 'delete',
      entity,
      id: item.id,
      title:
        entity === 'projects'
          ? 'Supprimer ce projet ?'
          : entity === 'tickets'
            ? 'Supprimer ce ticket ?'
            : 'Supprimer cette note ?',
      description:
        entity === 'projects'
          ? `« ${(item as Project).name} » et ses ${data.tickets.filter((t) => t.project_id === item.id).length} tickets seront supprimés définitivement.`
          : entity === 'tickets'
            ? `« ${(item as Ticket).title} » sera supprimé. Les autres tickets ne dépendront plus de lui.`
            : `« ${(item as Note).title || 'Sans titre'} » sera supprimée définitivement.`,
    })
  }
  async function removeItem(entity: 'projects' | 'tickets' | 'notes', id: string) {
    if (entity === 'notes') {
      const timer = noteTimers.current.get(id)
      if (timer) clearTimeout(timer)
      await noteFlights.current.get(id)?.catch(() => {})
    }
    await action(() => repo.remove(entity, id))
    setData((d) => {
      if (entity === 'projects')
        return {
          ...d,
          projects: d.projects.filter((p) => p.id !== id),
          tickets: d.tickets.filter((t) => t.project_id !== id),
        }
      if (entity === 'tickets')
        return {
          ...d,
          tickets: d.tickets
            .filter((t) => t.id !== id)
            .map((t) => (t.depends_on_id === id ? { ...t, depends_on_id: null } : t)),
        }
      return { ...d, notes: d.notes.filter((n) => n.id !== id) }
    })
    if (entity === 'notes') {
      drafts.current.delete(id)
      noteErrors.current.delete(id)
      bump()
      navigate({ view: 'notes' })
    }
    if (entity === 'projects') navigate({ view: 'projects' })
    announce('Suppression effectuée.')
  }
  function exportData() {
    const snapshot = {
      ...data,
      notes: data.notes.map((n) => ({ ...n, ...drafts.current.get(n.id) })),
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...snapshot }, null, 2)], {
        type: 'application/json',
      }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `atelier-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    announce('Votre sauvegarde a été téléchargée.')
  }
  const project = data.projects.find((p) => p.id === route.project)
  const initials = identity.demo ? 'D' : identity.email.charAt(0).toUpperCase() || 'A'
  useEffect(() => {
    document.title = `${route.view === 'notes' ? 'Notes' : project?.name || 'Projects'} — Atelier`
  }, [route.view, project?.name])
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <a
          className="brand-link"
          href={location.pathname}
          onClick={(e) => {
            e.preventDefault()
            navigate({ view: 'projects' })
          }}
        >
          <Brand />
        </a>
        <div className="workspace-label">
          <span className="workspace-square">A</span>
          <div>
            Mon espace<small>Personnel</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="sidebar-label">L’ESSENTIEL</span>
        <nav className="main-nav" aria-label="Navigation principale">
          <button
            className={route.view === 'projects' ? 'active' : ''}
            onClick={() => navigate({ view: 'projects' })}
          >
            <FolderKanban size={19} />
            Projects<span className="nav-count">{data.projects.length}</span>
          </button>
          <button
            className={route.view === 'notes' ? 'active' : ''}
            onClick={() => navigate({ view: 'notes' })}
          >
            <FileText size={19} />
            Notes<span className="nav-count">{data.notes.length}</span>
          </button>
        </nav>
        <div className="sidebar-projects">
          <div className="sidebar-label-row">
            <span className="sidebar-label">MES PROJETS</span>
            <button
              className="icon-button"
              aria-label="Créer un projet"
              disabled={!loaded}
              onClick={() => setDialog({ kind: 'project' })}
            >
              <Plus size={15} />
            </button>
          </div>
          {data.projects.slice(0, 7).map((p) => (
            <button
              key={p.id}
              className={`sidebar-project ${project?.id === p.id && route.view === 'projects' ? 'selected' : ''}`}
              onClick={() => navigate({ view: 'projects', project: p.id })}
            >
              <span className={`project-color-dot ${p.color}`} />
              <span>{p.name}</span>
            </button>
          ))}
          {!data.projects.length && <p className="sidebar-empty">Vos idées commencent ici.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span>À votre rythme.</span>
            <p>
              Une idée. Un petit pas.
              <br />
              Et la suite se dessine.
            </p>
            <span className="sidebar-spark">✳</span>
          </div>
          <div className="account-tools">
            <button
              className="icon-button"
              onClick={exportData}
              disabled={!loaded}
              aria-label="Exporter mes données"
              title="Exporter mes données"
            >
              <Download size={17} />
            </button>
            {!identity.demo && (
              <button
                className="icon-button"
                onClick={() => void leave(true)}
                aria-label="Changer mon mot de passe"
                title="Changer mon mot de passe"
              >
                <KeyRound size={17} />
              </button>
            )}
            <button
              className="icon-button"
              onClick={() => void leave()}
              aria-label="Se déconnecter"
              title="Se déconnecter"
            >
              <LogOut size={17} />
            </button>
          </div>
          <div className="account">
            <span className="avatar">{initials}</span>
            <div>
              <strong>{identity.demo ? 'Espace de démo' : 'Mon compte'}</strong>
              <small title={identity.email}>{identity.email}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand small />
          </div>
          <div className="breadcrumbs">
            <span>Mon espace</span>
            <ChevronRight size={14} />
            <strong>{route.view === 'notes' ? 'Notes' : 'Projects'}</strong>
            {project && route.view === 'projects' && (
              <>
                <ChevronRight size={14} />
                <span className="crumb-project">{project.name}</span>
              </>
            )}
          </div>
          <div className="topbar-right">
            {identity.demo ? (
              <span
                className="badge demo-badge"
                title="Stockage dans ce navigateur uniquement, sans synchronisation ni protection par mot de passe."
              >
                Démo · cet appareil
              </span>
            ) : (
              <span className="private-badge">
                <span /> Espace privé
              </span>
            )}
            <button
              className="icon-button"
              onClick={() => void refresh()}
              disabled={refreshing || working > 0}
              aria-label="Actualiser les données"
              title="Actualiser"
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            </button>
            <button
              className="icon-button mobile-logout"
              onClick={() => void leave()}
              aria-label="Se déconnecter"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Navigation mobile">
          <button
            className={route.view === 'projects' ? 'active' : ''}
            onClick={() => navigate({ view: 'projects' })}
          >
            <FolderKanban size={17} /> Projects <span>{data.projects.length}</span>
          </button>
          <button
            className={route.view === 'notes' ? 'active' : ''}
            onClick={() => navigate({ view: 'notes' })}
          >
            <FileText size={17} /> Notes <span>{data.notes.length}</span>
          </button>
          <button onClick={exportData} disabled={!loaded} aria-label="Exporter mes données">
            <Download size={17} />
          </button>
          {!identity.demo && (
            <button onClick={() => void leave(true)} aria-label="Changer mon mot de passe">
              <KeyRound size={17} />
            </button>
          )}
        </nav>
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} />
            {identity.demo
              ? 'Hors connexion — la démo reste disponible sur cet appareil.'
              : 'Hors connexion — reconnectez-vous pour enregistrer vos modifications.'}
          </div>
        )}
        {loaded && loadError && (
          <div className="sync-banner" role="alert">
            {loadError}
            <button className="text-button" onClick={() => void refresh()}>
              Réessayer
            </button>
          </div>
        )}
        <main className={`main-content ${route.view === 'notes' ? 'notes-page' : ''}`} id="main">
          {!loaded ? (
            loadError ? (
              <EmptyState
                title="Votre espace n’a pas pu être chargé."
                description={loadError}
                action={
                  <button className="button primary" onClick={() => void refresh()}>
                    Réessayer
                  </button>
                }
              />
            ) : (
              <div className="content-loading">
                <Spinner />
                <p>On prépare votre espace…</p>
              </div>
            )
          ) : route.view === 'notes' ? (
            <Notes
              notes={data.notes}
              selectedId={route.note}
              drafts={drafts.current}
              saving={new Set(noteFlights.current.keys())}
              errors={noteErrors.current}
              busy={working > 0}
              onSelect={(note) => navigate({ view: 'notes', note })}
              onChange={editNote}
              onCreate={() => void createNote()}
              onDelete={(note) => confirmDelete('notes', note)}
              onRetry={(id) => void flushNote(id).catch(() => {})}
            />
          ) : route.project ? (
            project ? (
              <Board
                key={project.id}
                project={project}
                tickets={data.tickets.filter((t) => t.project_id === project.id)}
                busy={working > 0}
                onBack={() => navigate({ view: 'projects' })}
                onEditProject={() => setDialog({ kind: 'project', project })}
                onNewTicket={(status) => setDialog({ kind: 'ticket', project, status })}
                onEditTicket={(ticket) => setDialog({ kind: 'ticket', project, ticket })}
                onMove={(ticket, status) => void moveTicket(ticket, status)}
              />
            ) : (
              <EmptyState
                title="Ce projet n’est plus ici."
                description="Il a peut-être été supprimé. Retrouvez les autres projets dans votre espace."
                action={
                  <button className="button primary" onClick={() => navigate({ view: 'projects' })}>
                    Voir mes projets
                  </button>
                }
              />
            )
          ) : (
            <Projects
              projects={data.projects}
              tickets={data.tickets}
              onOpen={(id) => navigate({ view: 'projects', project: id })}
              onCreate={() => setDialog({ kind: 'project' })}
            />
          )}
        </main>
      </div>
      {dialog?.kind === 'project' && (
        <ProjectForm
          project={dialog.project}
          onClose={() => setDialog(null)}
          onSave={saveProject}
          onDelete={() => {
            if (dialog.project) confirmDelete('projects', dialog.project)
          }}
        />
      )}
      {dialog?.kind === 'ticket' && (
        <TicketForm
          key={dialog.ticket?.id || 'new'}
          ticket={dialog.ticket}
          project={dialog.project}
          tickets={data.tickets}
          initialStatus={dialog.status}
          onClose={() => setDialog(null)}
          onSave={saveTicket}
          onDelete={() => {
            if (dialog.ticket) confirmDelete('tickets', dialog.ticket)
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          title={dialog.title}
          description={dialog.description}
          onClose={() => setDialog(null)}
          onConfirm={() => removeItem(dialog.entity, dialog.id)}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {!toast.error && <Check size={17} />}
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Fermer la notification">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
