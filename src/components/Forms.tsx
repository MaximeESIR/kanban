import { RichText } from './RichText'
import { Assistant } from './Assistant'
import { useState, type FormEvent } from 'react'
import { Check, Trash2 } from 'lucide-react'
import {
  colors,
  dependencyOptions,
  difficulties,
  priorities,
  statuses,
  validateProject,
  validateTicket,
  type Project,
  type ProjectInput,
  type Ticket,
  type TicketInput,
  type Status,
} from '../domain'
import { friendlyError } from '../lib/supabase'
import { Modal, Spinner } from './ui'

const colorNames = {
  sage: 'Sauge',
  blue: 'Bleu',
  purple: 'Lavande',
  peach: 'Pêche',
  rose: 'Rose',
  sand: 'Sable',
}

export function ProjectForm({
  project,
  onClose,
  onSave,
  onDelete,
}: {
  project?: Project
  onClose: () => void
  onSave: (input: ProjectInput, id?: string) => Promise<void>
  onDelete: () => void
}) {
  const [input, setInput] = useState<ProjectInput>({
    name: project?.name || '',
    description: project?.description || '',
    color: project?.color || 'sage',
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      validateProject(input)
      await onSave(input, project?.id)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={project ? 'Les détails du projet' : 'Une nouvelle idée à construire.'}
      eyebrow={project ? 'MODIFIER LE PROJET' : 'NOUVEAU PROJET'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} className="modal-form">
        <label className="field">
          Nom du projet <span className="required">*</span>
          <input
            autoFocus
            required
            maxLength={80}
            placeholder="Par exemple, mon site personnel"
            value={input.name}
            onChange={(e) => setInput({ ...input, name: e.target.value })}
          />
        </label>
        <label className="field">
          Description <span className="optional">facultatif</span>
          <textarea
            rows={3}
            maxLength={1000}
            placeholder="En quelques mots, qu’avez-vous en tête ?"
            value={input.description}
            onChange={(e) => setInput({ ...input, description: e.target.value })}
          />
        </label>
        <fieldset className="color-field">
          <legend>Une couleur pour le retrouver</legend>
          <div className="color-options">
            {colors.map((color) => (
              <button
                type="button"
                key={color}
                className={`color-option ${color} ${input.color === color ? 'selected' : ''}`}
                onClick={() => setInput({ ...input, color })}
                aria-label={colorNames[color]}
                aria-pressed={input.color === color}
              >
                {input.color === color && <Check size={18} />}
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {project && (
            <button
              className="icon-button danger"
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label="Supprimer le projet"
            >
              <Trash2 size={18} />
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : project ? 'Enregistrer' : 'Créer le projet'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function TicketForm({
  assistantEnabled = false,
  ticket,
  project,
  tickets,
  initialStatus = 'todo',
  onClose,
  onSave,
  onDelete,
}: {
  assistantEnabled?: boolean
  ticket?: Ticket
  project: Project
  tickets: Ticket[]
  initialStatus?: Status
  onClose: () => void
  onSave: (input: TicketInput, id?: string) => Promise<void>
  onDelete: () => void
}) {
  const [input, setInput] = useState<TicketInput>({
    project_id: project.id,
    title: ticket?.title || '',
    description: ticket?.description || '',
    status: ticket?.status || initialStatus,
    priority: ticket?.priority || 'medium',
    difficulty: ticket?.difficulty || 'medium',
    depends_on_id: ticket?.depends_on_id || null,
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const dependencies = dependencyOptions(tickets, project.id, ticket?.id)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      validateTicket(input, tickets, ticket?.id)
      await onSave(input, ticket?.id)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={ticket ? 'Les détails du ticket' : 'Un petit pas pour votre projet.'}
      eyebrow={`${project.name} ${ticket ? ` / #${ticket.number}` : '/ NOUVEAU TICKET'}`}
      onClose={onClose}
      wide
      busy={busy}
    >
      <div className="modal-form">
        <button className="text-button" type="button" onClick={() => setPreview(!preview)}>
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
            else setInput({ ...input, description })
          }}
        />
      </div>
      <form className="modal-form" onSubmit={submit}>
        <label className="field">
          Titre du ticket <span className="required">*</span>
          <input
            required
            autoFocus
            maxLength={160}
            value={input.title}
            onChange={(e) => setInput({ ...input, title: e.target.value })}
            placeholder="Qu’y a-t-il à faire ?"
          />
        </label>
        <label className="field">
          Description <span className="optional">facultatif</span>
          <textarea
            rows={6}
            maxLength={12000}
            value={input.description}
            onChange={(e) => setInput({ ...input, description: e.target.value })}
            placeholder="Le contexte, le résultat attendu, les détails à garder en tête…"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Statut
            <select
              value={input.status}
              onChange={(e) => setInput({ ...input, status: e.target.value as Status })}
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
                setInput({ ...input, priority: e.target.value as TicketInput['priority'] })
              }
            >
              {Object.entries(priorities).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Difficulté
            <select
              value={input.difficulty}
              onChange={(e) =>
                setInput({ ...input, difficulty: e.target.value as TicketInput['difficulty'] })
              }
            >
              {Object.entries(difficulties).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Dépend d’un autre ticket
          <select
            value={input.depends_on_id || ''}
            onChange={(e) => setInput({ ...input, depends_on_id: e.target.value || null })}
          >
            <option value="">Aucune dépendance</option>
            {dependencies.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.number} — {t.title}
                {t.status === 'done' ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <span className="field-hint">
            La dépendance est un repère : vous gardez la main sur le statut.
          </span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {ticket && (
            <button
              type="button"
              className="icon-button danger"
              onClick={onDelete}
              disabled={busy}
              aria-label="Supprimer le ticket"
            >
              <Trash2 size={18} />
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : ticket ? 'Enregistrer' : 'Créer le ticket'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function DeleteDialog({
  title,
  description,
  onClose,
  onConfirm,
}: {
  title: string
  description: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function remove() {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={title} eyebrow="SUPPRESSION" onClose={onClose} busy={busy}>
      <div className="modal-form">
        <p className="delete-description">{description}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="button secondary" onClick={onClose} disabled={busy} autoFocus>
            Annuler
          </button>
          <button className="button danger-fill" disabled={busy} onClick={remove}>
            {busy ? <Spinner /> : 'Supprimer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
