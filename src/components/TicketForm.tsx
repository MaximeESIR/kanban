import { TicketExecution } from './Execution'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import {
  dependencyOptions,
  difficulties,
  priorities,
  statuses,
  prerequisiteIds,
  ticketLinks,
  validateTicket,
  type Project,
  type Ticket,
  type TicketInput,
  type Status,
} from '../domain'
import {
  listTicketDrafts,
  writeTicketDraft,
  removeTicketDraft,
  type TicketDraft,
} from '../lib/ticketDrafts'
import { friendlyError } from '../lib/supabase'
import { Modal, Spinner } from './ui'
import { Assistant } from './Assistant'
import { RichText } from './RichText'

export function TicketForm({
  assistantEnabled = false,
  ticket,
  project,
  tickets,
  initialStatus = 'todo',
  initialParent,
  onClose,
  onSave,
  onDelete,
  onOpen,
  onNewChild,
}: {
  assistantEnabled?: boolean
  ticket?: Ticket
  project: Project
  tickets: Ticket[]
  initialStatus?: Status
  initialParent?: string
  onClose: () => void
  onSave: (input: TicketInput, id?: string, expectedVersion?: string) => Promise<Ticket>
  onDelete: () => void
  onOpen: (ticket: Ticket) => void
  onNewChild: (ticket: Ticket) => void
}) {
  const initial: TicketInput = ticketLinks({
    project_id: project.id,
    title: ticket?.title || '',
    description: ticket?.description || '',
    status: ticket?.status || initialStatus,
    priority: ticket?.priority || 'medium',
    difficulty: ticket?.difficulty || 'medium',
    position: ticket?.position ?? 0,
    depends_on_id: ticket?.depends_on_id || null,
    prerequisite_ids: ticket ? prerequisiteIds(ticket) : [],
    parent_id: ticket?.parent_id || initialParent || null,
  })
  const [input, setInput] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [preview, setPreview] = useState(false),
    [search, setSearch] = useState(''),
    [localSaved, setLocalSaved] = useState(false)
  const [recovery, setRecovery] = useState<TicketDraft[]>(() => {
    try {
      return listTicketDrafts(project.owner_id).filter(
        (d) => d.project === project.id && d.ticket === ticket?.id,
      )
    } catch {
      return []
    }
  })
  const latest = useRef(input),
    baseline = useRef(initial),
    version = useRef(ticket?.updated_at),
    draftId = useRef(crypto.randomUUID())
  const recovered = useRef<string | null>(null),
    saving = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    // Acknowledging our own offline write changes the server revision, not the content.
    if (!recovered.current && JSON.stringify(initial) === JSON.stringify(baseline.current))
      version.current = ticket?.updated_at
  }, [ticket])
  const dirty = () => JSON.stringify(latest.current) !== JSON.stringify(baseline.current)
  function persist(value: TicketInput) {
    try {
      writeTicketDraft({
        id: draftId.current,
        owner: project.owner_id,
        project: project.id,
        ticket: ticket?.id,
        baseVersion: version.current,
        input: value,
        updatedAt: new Date().toISOString(),
      })
      setLocalSaved(true)
    } catch {
      setError(
        'Impossible de conserver le brouillon sur cet appareil. Enregistrez avant de fermer.',
      )
      setLocalSaved(false)
    }
  }
  function edit(next: TicketInput) {
    next = ticketLinks(next)
    latest.current = next
    setInput(next)
    persist(next)
  }
  function clearSavedDraft() {
    removeTicketDraft(project.owner_id, draftId.current)
    if (recovered.current) removeTicketDraft(project.owner_id, recovered.current)
    recovered.current = null
    setLocalSaved(false)
  }
  async function save(copy = false): Promise<boolean> {
    if (saving.current) return false
    if (ticket && !dirty() && !copy) return true
    saving.current = true
    setBusy(true)
    setError('')
    const snapshot = latest.current
    try {
      validateTicket(snapshot, tickets, copy ? undefined : ticket?.id)
      const saved = await onSave(
        snapshot,
        copy ? undefined : ticket?.id,
        copy ? undefined : version.current,
      )
      baseline.current = snapshot
      version.current = saved.updated_at
      if (!dirty()) clearSavedDraft()
      else persist(latest.current)
      return !dirty()
    } catch (e) {
      if (mounted.current) setError(friendlyError(e))
      return false
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function close() {
    if (!ticket && dirty() && !localSaved) {
      setError(
        'Le brouillon n’a pas pu être conservé. Créez le ticket ou copiez son texte avant de fermer.',
      )
      return
    }
    if (ticket && !(await save())) return
    onClose()
  }
  async function navigate(next: () => void) {
    if (await save()) next()
  }
  const hideHandler = useRef(() => {})
  hideHandler.current = () => {
    if (ticket && dirty() && !saving.current) void save()
  }
  useEffect(() => {
    mounted.current = true
    const hide = () => {
      if (document.hidden) hideHandler.current()
    }
    const unload = (e: BeforeUnloadEvent) => {
      // An immediate synchronous local draft already exists after every keystroke.
      // Warn only if the browser refused that write.
      if (dirty()) {
        try {
          writeTicketDraft({
            id: draftId.current,
            owner: project.owner_id,
            project: project.id,
            ticket: ticket?.id,
            baseVersion: version.current,
            input: latest.current,
            updatedAt: new Date().toISOString(),
          })
        } catch {
          e.preventDefault()
          e.returnValue = ''
        }
      }
    }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('beforeunload', unload)
    return () => {
      mounted.current = false
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('beforeunload', unload)
    }
  }, [])
  const candidates = dependencyOptions(tickets, project.id, ticket?.id)
  const parentOptions = dependencyOptions(tickets, project.id, ticket?.id, 'parent')
  const children = tickets.filter((t) => t.parent_id === ticket?.id && ticket)
  const unblocks = tickets.filter((t) => ticket && prerequisiteIds(t).includes(ticket.id))
  const waiting = prerequisiteIds(input),
    completed = waiting.filter((id) => tickets.find((t) => t.id === id)?.status === 'done').length
  const relationButton = (t: Ticket) => (
    <button
      type="button"
      key={t.id}
      className="text-button relation-link"
      disabled={busy}
      onClick={() => void navigate(() => onOpen(t))}
    >
      #{t.number} — {t.title}
      {t.status === 'done' ? ' ✓' : ''}
    </button>
  )
  return (
    <Modal
      title={ticket ? 'Les détails du ticket' : 'Un petit pas pour votre projet.'}
      eyebrow={`${project.name}${ticket ? ` / #${ticket.number}` : ' / NOUVEAU TICKET'}`}
      onClose={() => void close()}
      wide
      busy={busy}
    >
      <div className="modal-form">
        {recovery.length > 0 && (
          <section className="draft-recovery" aria-label="Brouillons disponibles">
            <p>
              Un brouillon a été conservé sur cet appareil. Vous pouvez le reprendre avant de
              modifier le ticket.
            </p>
            {recovery.map((d) => (
              <div key={d.id}>
                <small>
                  {d.input.title || 'Sans titre'} · {new Date(d.updatedAt).toLocaleString('fr-FR')}
                </small>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    recovered.current = d.id
                    version.current = d.baseVersion
                    edit(d.input)
                    setRecovery([])
                    if (ticket && d.baseVersion !== ticket.updated_at)
                      setError(
                        'Le ticket a changé depuis ce brouillon. Comparez son contenu ou créez une copie pour préserver les deux versions.',
                      )
                  }}
                >
                  Reprendre le brouillon
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    removeTicketDraft(project.owner_id, d.id)
                    setRecovery((r) => r.filter((x) => x.id !== d.id))
                  }}
                >
                  Écarter ce brouillon
                </button>
              </div>
            ))}
          </section>
        )}
        <button className="text-button" onClick={() => setPreview(!preview)}>
          {preview ? 'Masquer le rendu' : 'Lire la description'}
        </button>
        {preview && <RichText text={input.description} />}
        <Assistant
          targetId={ticket?.id}
          enabled={assistantEnabled}
          text={input.description}
          onApply={(description) => {
            if (description.length > 12000)
              setError(
                'Le résultat dépasse les 12 000 caractères du ticket. Copiez-le dans une note.',
              )
            else edit({ ...latest.current, description })
          }}
        />
      </div>
      {ticket && (
        <TicketExecution
          ticket={ticket}
          tickets={tickets}
          enabled={assistantEnabled}
          unsaved={dirty()}
        />
      )}
      <form
        className="modal-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void save().then((ok) => {
            if (ok) onClose()
          })
        }}
      >
        <fieldset className="ticket-fields" disabled={busy}>
          <label className="field">
            Titre du ticket <span className="required">*</span>
            <input
              required
              autoFocus
              maxLength={160}
              value={input.title}
              onChange={(e) => edit({ ...input, title: e.target.value })}
              placeholder="Qu’y a-t-il à faire ?"
            />
          </label>
          <label className="field">
            Description <span className="optional">facultatif</span>
            <textarea
              rows={6}
              maxLength={12000}
              value={input.description}
              onChange={(e) => edit({ ...input, description: e.target.value })}
              placeholder="Le contexte, le résultat attendu, les détails à garder en tête…"
            />
          </label>
          <div className="form-grid">
            <label className="field">
              Statut
              <select
                value={input.status}
                onChange={(e) => edit({ ...input, status: e.target.value as Status })}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Priorité
              <select
                value={input.priority}
                onChange={(e) =>
                  edit({ ...input, priority: e.target.value as TicketInput['priority'] })
                }
              >
                {Object.entries(priorities).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Difficulté
              <select
                value={input.difficulty}
                onChange={(e) =>
                  edit({ ...input, difficulty: e.target.value as TicketInput['difficulty'] })
                }
              >
                {Object.entries(difficulties).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Ticket parent
            <select
              value={input.parent_id || ''}
              onChange={(e) => edit({ ...input, parent_id: e.target.value || null })}
            >
              <option value="">Aucun parent</option>
              {parentOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.number} — {t.title}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Le parent regroupe les sous-tâches. Les prérequis se choisissent séparément.
            </span>
          </label>
          <fieldset className="prerequisites">
            <legend>
              Prérequis · {completed}/{waiting.length} terminés
            </legend>
            <label className="field">
              Rechercher un prérequis
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" />
            </label>
            <div className="prerequisite-list">
              {candidates
                .filter(
                  (t) =>
                    t.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')) ||
                    waiting.includes(t.id),
                )
                .map((t) => (
                  <label key={t.id} className="prerequisite-option">
                    <input
                      type="checkbox"
                      checked={waiting.includes(t.id)}
                      onChange={(e) =>
                        edit({
                          ...input,
                          prerequisite_ids: e.target.checked
                            ? [...waiting, t.id]
                            : waiting.filter((id) => id !== t.id),
                        })
                      }
                    />
                    <span>
                      #{t.number} — {t.title}
                      {t.status === 'done' ? ' ✓' : ''}
                    </span>
                  </label>
                ))}
              {!candidates.length && (
                <p className="field-hint">Aucun autre ticket compatible dans ce projet.</p>
              )}
              {waiting
                .filter((id) => !candidates.some((t) => t.id === id))
                .map((id) => (
                  <button
                    type="button"
                    key={id}
                    className="text-button"
                    onClick={() =>
                      edit({ ...input, prerequisite_ids: waiting.filter((x) => x !== id) })
                    }
                  >
                    Retirer le prérequis indisponible {id.slice(0, 8)}
                  </button>
                ))}
            </div>
            <p className="field-hint">
              Un même prérequis peut servir à plusieurs tickets. Vous gardez la main sur les
              statuts.
            </p>
          </fieldset>
        </fieldset>
        {ticket && (
          <section className="ticket-relations" aria-label="Relations du ticket">
            <strong>
              Sous-tickets · {children.filter((t) => t.status === 'done').length}/{children.length}{' '}
              terminés
            </strong>
            {children.map(relationButton)}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void navigate(() => onNewChild(ticket))}
            >
              Nouveau sous-ticket
            </button>
            {!!unblocks.length && (
              <>
                <strong>Débloque</strong>
                {unblocks.map(relationButton)}
              </>
            )}
          </section>
        )}
        <p className="field-hint" role="status">
          {busy ? 'Enregistrement…' : localSaved ? 'Brouillon conservé sur cet appareil.' : 'Prêt.'}{' '}
          {ticket
            ? 'Enregistrement à la fermeture et au passage en arrière-plan.'
            : 'Le ticket sera créé avec le bouton ci-dessous.'}{' '}
          Annuler abandonne les changements non encore enregistrés.
        </p>
        {error && (
          <div className="form-error" role="alert">
            <p>{error}</p>
            {ticket && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void save(true).then((ok) => {
                    if (ok) onClose()
                  })
                }
              >
                Créer une copie du brouillon
              </button>
            )}
          </div>
        )}
        <div className="modal-actions">
          {ticket && (
            <button
              type="button"
              className="icon-button danger"
              disabled={busy}
              aria-label="Supprimer le ticket"
              onClick={onDelete}
            >
              <Trash2 size={18} />
            </button>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              clearSavedDraft()
              onClose()
            }}
          >
            Annuler les modifications
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : ticket ? 'Enregistrer' : 'Créer le ticket'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
