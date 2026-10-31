import { Assistant } from './Assistant'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  Circle,
  Flag,
  GripVertical,
  Layers3,
  Link2,
  Plus,
  Search,
  Settings2,
} from 'lucide-react'
import {
  dateLabel,
  difficulties,
  isBlocked,
  matchesSearch,
  priorities,
  statuses,
  type Project,
  type Ticket,
  type Status,
} from '../domain'
import { EmptyState, ProjectIcon } from './ui'

export function Projects({
  onTicket,
  onMoveTicket,
  projects,
  tickets,
  onOpen,
  onCreate,
}: {
  onTicket: (ticket: Ticket) => void
  onMoveTicket: (ticket: Ticket, status: Status) => void
  projects: Project[]
  tickets: Ticket[]
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('recent')
  const [allIssues, setAllIssues] = useState(false)
  const filtered = projects
    .filter((p) => matchesSearch(query, p.name, p.description))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'fr')
        : b.updated_at.localeCompare(a.updated_at),
    )
  const done = tickets.filter((t) => t.status === 'done').length
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">UN PEU D’ORDRE, BEAUCOUP D’IDÉES</p>
          <h1>
            De l’idée au projet<span>.</span>
          </h1>
          <p>Un espace pour donner forme à ce que vous avez en tête.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={18} /> Nouveau projet
        </button>
      </header>
      <div className="overview-stats">
        <div>
          <span className="stat-icon">
            <Layers3 size={19} />
          </span>
          <strong>{projects.length}</strong>
          <span>projet{projects.length !== 1 ? 's' : ''}</span>
        </div>
        <div>
          <span className="stat-icon">
            <Circle size={19} />
          </span>
          <strong>{tickets.length - done}</strong>
          <span>
            ticket{tickets.length - done !== 1 ? 's' : ''} ouvert
            {tickets.length - done !== 1 ? 's' : ''}
          </span>
        </div>
        <div>
          <span className="stat-icon done">
            <CheckCheck size={20} />
          </span>
          <strong>{done}</strong>
          <span>terminé{done !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="section-toolbar">
        <div className="section-title">
          <h2>Tous les projets</h2>
          <span className="count">{projects.length}</span>
        </div>
        <div className="toolbar-controls">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Rechercher un projet"
              placeholder="Rechercher un projet…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="sort-control">
            <ArrowDownWideNarrow size={17} />
            <select
              aria-label="Trier les projets"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Plus récents</option>
              <option value="name">Nom du projet</option>
            </select>
          </label>
        </div>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          title="Tout commence par une idée."
          description="Créez votre premier projet, puis ajoutez les petites étapes pour lui donner vie."
          action={
            <button className="button primary" onClick={onCreate}>
              <Plus size={17} /> Créer mon premier projet
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun projet trouvé."
          description="Essayez un autre nom ou une autre recherche."
          action={
            <button className="button secondary" onClick={() => setQuery('')}>
              Effacer la recherche
            </button>
          }
        />
      ) : (
        <div className="project-grid">
          {filtered.map((project) => {
            const all = tickets.filter((t) => t.project_id === project.id),
              completed = all.filter((t) => t.status === 'done').length
            const percent = all.length ? Math.round((completed / all.length) * 100) : 0
            return (
              <button
                key={project.id}
                className="project-card"
                onClick={() => onOpen(project.id)}
                aria-label={`Ouvrir ${project.name}`}
              >
                <div className="project-card-top">
                  <ProjectIcon color={project.color} />
                  <span className="card-arrow">
                    <ArrowUpRight size={20} />
                  </span>
                </div>
                <h3>{project.name}</h3>
                <p>{project.description || 'Une page blanche, pleine de possibilités.'}</p>
                <div className="project-progress-label">
                  <span>
                    {all.length} ticket{all.length !== 1 ? 's' : ''}
                  </span>
                  <span>{percent}%</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`Progression de ${project.name}`}
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className={project.color} style={{ width: `${percent}%` }} />
                </div>
                <div className="project-card-footer">
                  <span>
                    <Check size={14} /> {completed} terminé{completed !== 1 ? 's' : ''}
                  </span>
                  <span>{dateLabel(project.updated_at)}</span>
                </div>
              </button>
            )
          })}
          <button className="new-project-card" onClick={onCreate}>
            <span>
              <Plus size={24} strokeWidth={1.5} />
            </span>
            <strong>Un nouveau projet ?</strong>
            <small>Faites de la place à votre prochaine idée.</small>
          </button>
        </div>
      )}
      <button className="button secondary" onClick={() => setAllIssues(!allIssues)}>
        {allIssues ? 'Masquer tous les tickets' : 'Tous les tickets'}
      </button>
      {allIssues && (
        <section className="all-issues" aria-label="Tous les tickets">
          {[...tickets]
            .sort(
              (a, b) =>
                ['urgent', 'high', 'medium', 'low'].indexOf(a.priority) -
                  ['urgent', 'high', 'medium', 'low'].indexOf(b.priority) ||
                a.project_id.localeCompare(b.project_id),
            )
            .map((t) => (
              <article key={t.id} className="search-hit">
                <button className="text-button" onClick={() => onTicket(t)}>
                  {t.title}
                </button>
                <small>
                  {projects.find((p) => p.id === t.project_id)?.name} · {priorities[t.priority]}
                </small>
                <select
                  aria-label={`Statut global ${t.title}`}
                  value={t.status}
                  onChange={(e) => onMoveTicket(t, e.target.value as Status)}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </article>
            ))}
        </section>
      )}
      <p className="page-footnote">Les grandes idées avancent à petits pas.</p>
    </>
  )
}

export function Board({
  assistantEnabled,
  project,
  tickets,
  busy,
  onBack,
  onEditProject,
  onNewTicket,
  onEditTicket,
  onMove,
  onReorder,
}: {
  assistantEnabled: boolean
  project: Project
  tickets: Ticket[]
  busy: boolean
  onBack: () => void
  onEditProject: () => void
  onNewTicket: (status: Status) => void
  onEditTicket: (ticket: Ticket) => void
  onMove: (ticket: Ticket, status: Status) => void
  onReorder: (ticket: Ticket, position: number) => void
}) {
  const [showArchive, setShowArchive] = useState(false)
  const [query, setQuery] = useState(''),
    [priority, setPriority] = useState('all'),
    [dragging, setDragging] = useState<string | null>(null),
    [over, setOver] = useState<Status | null>(null)
  const selected = tickets.filter(
    (t) =>
      matchesSearch(query, t.title, t.description, `#${t.number}`) &&
      (priority === 'all' || t.priority === priority) &&
      (showArchive || t.status !== 'done' || Date.now() - Date.parse(t.updated_at) < 7 * 86400000),
  )
  const boardRef = useRef<HTMLDivElement>(null)
  const touch = useRef<{ timer?: ReturnType<typeof setTimeout>; active: boolean }>({
    active: false,
  })
  useEffect(
    () => () => {
      if (touch.current.timer) clearTimeout(touch.current.timer)
    },
    [],
  )
  function touchEnd(x: number, y: number, ticket: Ticket) {
    if (touch.current.timer) clearTimeout(touch.current.timer)
    if (touch.current.active) {
      const hit = document.elementFromPoint(x, y),
        target = tickets.find(
          (t) => t.id === hit?.closest<HTMLElement>('[data-ticket-id]')?.dataset.ticketId,
        )
      const status = hit?.closest<HTMLElement>('[data-column]')?.dataset.column as
        Status | undefined
      if (target && target.id !== ticket.id && target.status === ticket.status)
        onReorder(ticket, (target.position || 0) - 0.5)
      else if (status && status !== ticket.status && statuses.some((s) => s.id === status))
        onMove(ticket, status)
    }
    touch.current.active = false
    setDragging(null)
    setOver(null)
  }
  const done = tickets.filter((t) => t.status === 'done').length
  const filtered = Boolean(query || priority !== 'all')
  return (
    <>
      <button
        className="text-button"
        onClick={() => {
          const lines = [
            `# ${project.name}`,
            ...statuses.flatMap((s) => [
              `\n## ${s.label}`,
              ...tickets
                .filter((t) => t.status === s.id)
                .map((t) => `- [${s.id === 'done' ? 'x' : ' '}] ${t.title}\n\n${t.description}\n`),
            ]),
          ]
          const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
          const a = document.createElement('a')
          a.href = url
          a.download = 'projet.md'
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}
      >
        Exporter en Markdown
      </button>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} /> Tous les projets
      </button>
      <header className="page-heading board-heading">
        <div className="board-title">
          <ProjectIcon color={project.color} size="large" />
          <div>
            <p className="eyebrow">VOTRE PROJET</p>
            <h1>{project.name}</h1>
          </div>
        </div>
        <div className="heading-actions">
          <button
            className="button secondary settings-button"
            onClick={onEditProject}
            aria-label="Modifier le projet"
          >
            <Settings2 size={17} />
            <span>Modifier</span>
          </button>
          <button className="button primary" onClick={() => onNewTicket('todo')}>
            <Plus size={18} /> Nouveau ticket
          </button>
        </div>
      </header>
      {project.description && <p className="board-description">{project.description}</p>}
      <Assistant
        enabled={assistantEnabled}
        searchDocs={tickets.map((t) => ({ id: t.id, title: t.title, content: t.description }))}
        onOpen={(id) => {
          const t = tickets.find((t) => t.id === id)
          if (t) onEditTicket(t)
        }}
      />
      <div className="board-overview">
        <span>
          <Layers3 size={15} /> {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
        </span>
        <span>
          <CheckCheck size={16} /> {done} terminé{done !== 1 ? 's' : ''}
        </span>
        <div className="board-progress">
          <div className="progress-track">
            <div
              className="sage"
              style={{ width: `${tickets.length ? (done / tickets.length) * 100 : 0}%` }}
            />
          </div>
          <span>{tickets.length ? Math.round((done / tickets.length) * 100) : 0}%</span>
        </div>
      </div>
      <div className="section-toolbar board-toolbar">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Rechercher un ticket"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un ticket…"
          />
        </label>
        <div className="toolbar-controls">
          <label className="sort-control">
            <Flag size={15} />
            <select
              aria-label="Filtrer par priorité"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="all">Toutes les priorités</option>
              {Object.entries(priorities).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              className="text-button"
              onClick={() => {
                setQuery('')
                setPriority('all')
              }}
            >
              Effacer
            </button>
          )}
        </div>
      </div>
      <button className="text-button" onClick={() => setShowArchive(!showArchive)}>
        {showArchive
          ? 'Masquer les anciens tickets terminés'
          : 'Afficher les anciens tickets terminés'}
      </button>
      <nav className="column-tabs" aria-label="Colonnes du tableau">
        {statuses.map((status, i) => (
          <button
            className="button secondary"
            key={status.id}
            onClick={() =>
              boardRef.current?.children[i]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'start',
              })
            }
          >
            {status.label}
          </button>
        ))}
      </nav>
      <div ref={boardRef} className="kanban">
        {statuses.map((status) => {
          const items = selected
            .filter((t) => t.status === status.id)
            .sort((a, b) => (a.position || 0) - (b.position || 0) || a.number - b.number)
          return (
            <section
              key={status.id}
              data-column={status.id}
              className={`kanban-column ${over === status.id ? 'drag-over' : ''}`}
              aria-label={status.label}
              onDragOver={(e) => {
                if (dragging && !busy) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOver(status.id)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const ticket = tickets.find((t) => t.id === dragging)
                if (ticket && !busy && ticket.status !== status.id) onMove(ticket, status.id)
                setDragging(null)
                setOver(null)
              }}
            >
              <div className="column-heading">
                <h2>
                  <span className={`status-dot ${status.id}`} />
                  {status.label}
                  <span className="count">{items.length}</span>
                </h2>
                <button
                  className="icon-button"
                  onClick={() => onNewTicket(status.id)}
                  aria-label={`Ajouter un ticket dans ${status.label}`}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="column-content">
                {items.map((ticket, ticketIndex) => {
                  const blocked = isBlocked(ticket, tickets),
                    dependency = tickets.find((t) => t.id === ticket.depends_on_id)
                  return (
                    <article
                      key={ticket.id}
                      data-ticket-id={ticket.id}
                      className={`ticket-card ${dragging === ticket.id ? 'dragging' : ''} ${ticket.status === 'done' ? 'completed' : ''}`}
                      draggable={!busy}
                      onDragStart={(e) => {
                        setDragging(ticket.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', ticket.id)
                      }}
                      onDragEnd={() => {
                        setDragging(null)
                        setOver(null)
                      }}
                    >
                      <div className="ticket-topline">
                        <button
                          className="icon-button"
                          aria-label={`Monter ${ticket.title}`}
                          disabled={busy || ticketIndex === 0}
                          onClick={() =>
                            onReorder(ticket, (items[ticketIndex - 1]?.position || 0) - 1)
                          }
                        >
                          ↑
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Descendre ${ticket.title}`}
                          disabled={busy || ticketIndex === items.length - 1}
                          onClick={() =>
                            onReorder(ticket, (items[ticketIndex + 1]?.position || 0) + 1)
                          }
                        >
                          ↓
                        </button>
                        <span className="ticket-number">#{ticket.number}</span>
                        <span className={`priority priority-${ticket.priority}`}>
                          <span />
                          {priorities[ticket.priority]}
                        </span>
                        <button
                          className="icon-button touch-grip"
                          aria-label={`Déplacer par appui long ${ticket.title}`}
                          disabled={busy}
                          onPointerDown={(e) => {
                            if (e.pointerType === 'mouse') return
                            e.currentTarget.setPointerCapture(e.pointerId)
                            touch.current.active = false
                            touch.current.timer = setTimeout(() => {
                              touch.current.active = true
                              setDragging(ticket.id)
                            }, 350)
                          }}
                          onPointerMove={(e) => {
                            if (touch.current.active) {
                              const status = document
                                .elementFromPoint(e.clientX, e.clientY)
                                ?.closest<HTMLElement>('[data-column]')?.dataset.column as
                                Status | undefined
                              setOver(status || null)
                            }
                          }}
                          onPointerUp={(e) => {
                            if (e.pointerType !== 'mouse') touchEnd(e.clientX, e.clientY, ticket)
                          }}
                          onPointerCancel={() => {
                            if (touch.current.timer) clearTimeout(touch.current.timer)
                            touch.current.active = false
                            setDragging(null)
                            setOver(null)
                          }}
                        >
                          <GripVertical size={15} />
                        </button>
                      </div>
                      <button className="ticket-open" onClick={() => onEditTicket(ticket)}>
                        <h3>{ticket.title}</h3>
                        {ticket.description && <p>{ticket.description}</p>}
                      </button>
                      {dependency && (
                        <button
                          className={`dependency-chip ${blocked ? 'blocked' : 'resolved'}`}
                          onClick={() => onEditTicket(dependency)}
                          title={dependency.title}
                        >
                          <Link2 size={13} />
                          {blocked ? 'Dépend de' : 'Dépendance terminée'} #{dependency.number}
                        </button>
                      )}
                      <div className="ticket-footer">
                        <span
                          className={`difficulty difficulty-${ticket.difficulty}`}
                          title={`Difficulté : ${difficulties[ticket.difficulty]}`}
                        >
                          <span className="difficulty-bars" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                            <i />
                          </span>
                          {difficulties[ticket.difficulty]}
                        </span>
                        <select
                          className="ticket-status"
                          aria-label={`Statut de ${ticket.title}`}
                          value={ticket.status}
                          disabled={busy}
                          onChange={(e) => onMove(ticket, e.target.value as Status)}
                        >
                          {statuses.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  )
                })}
                {!items.length && (
                  <div className="column-empty">
                    <span className={`empty-column-symbol ${status.id}`}>
                      {status.id === 'done' ? (
                        <Check size={23} />
                      ) : status.id === 'in_progress' ? (
                        <Circle size={23} />
                      ) : (
                        <Layers3 size={23} />
                      )}
                    </span>
                    <p>
                      {filtered
                        ? 'Aucun ticket correspondant'
                        : status.id === 'done'
                          ? 'Les petits pas accomplis.'
                          : status.id === 'in_progress'
                            ? 'Une chose à la fois.'
                            : 'Les prochaines idées sont ici.'}
                    </p>
                  </div>
                )}
                <button className="add-ticket" onClick={() => onNewTicket(status.id)}>
                  <Plus size={16} /> Ajouter un ticket
                </button>
              </div>
            </section>
          )
        })}
      </div>
      <p className="board-help">
        Glissez un ticket entre les colonnes, ou changez son statut avec le menu de la carte.
      </p>
    </>
  )
}
