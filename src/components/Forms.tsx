export { TicketForm } from './TicketForm'
import { useState, type FormEvent } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { colors, validateProject, type Project, type ProjectInput } from '../domain'
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
