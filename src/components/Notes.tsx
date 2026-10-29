import { useState } from 'react'
import { ArrowLeft, Check, FileText, Plus, Search, Trash2, CloudUpload } from 'lucide-react'
import { dateLabel, matchesSearch, type Note, type NoteInput } from '../domain'
import { EmptyState, Spinner } from './ui'

export function Notes({
  notes,
  selectedId,
  drafts,
  saving,
  errors,
  onSelect,
  onChange,
  onCreate,
  onDelete,
  onRetry,
  busy,
}: {
  notes: Note[]
  selectedId?: string
  drafts: Map<string, NoteInput>
  saving: Set<string>
  errors: Map<string, string>
  onSelect: (id?: string) => void
  onChange: (id: string, input: NoteInput) => void
  onCreate: () => void
  onDelete: (note: Note) => void
  onRetry: (id: string) => void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const visible = notes
    .map((note) => ({ ...note, ...drafts.get(note.id) }))
    .filter((note) => matchesSearch(query, note.title, note.content))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const selected = notes.find((n) => n.id === selectedId) || (!selectedId ? visible[0] : undefined)
  const current = selected ? { ...selected, ...drafts.get(selected.id) } : null
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">POUR LES IDÉES QUI PASSENT</p>
          <h1>
            Un coin pour penser<span>.</span>
          </h1>
          <p>Les mots en vrac d’aujourd’hui, les belles idées de demain.</p>
        </div>
        <button className="button primary" onClick={onCreate} disabled={busy}>
          <Plus size={18} /> Nouvelle note
        </button>
      </header>
      {!notes.length ? (
        <EmptyState
          icon={<FileText size={27} strokeWidth={1.5} />}
          title="Une page blanche vous attend."
          description="Une pensée, une liste, une idée à garder. Prenez une note, tout simplement."
          action={
            <button className="button primary" onClick={onCreate} disabled={busy}>
              <Plus size={17} /> Écrire ma première note
            </button>
          }
        />
      ) : (
        <div className={`notes-layout ${selectedId ? 'note-is-selected' : ''}`}>
          <aside className="notes-list">
            <div className="notes-search">
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Rechercher une note"
                  placeholder="Rechercher une note…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="notes-list-label">
                VOS NOTES <span>{visible.length}</span>
              </div>
            </div>
            <div className="notes-items">
              {visible.map((note) => (
                <button
                  key={note.id}
                  className={`note-preview ${selected?.id === note.id ? 'active' : ''}`}
                  onClick={() => onSelect(note.id)}
                >
                  <div>
                    <FileText size={16} />
                    <h3>{note.title.trim() || 'Sans titre'}</h3>
                    {drafts.has(note.id) && (
                      <span className="unsaved-dot" aria-label="Modifications non enregistrées" />
                    )}
                  </div>
                  <p>{note.content || 'Une nouvelle page pour vos idées…'}</p>
                  <time dateTime={note.updated_at}>{dateLabel(note.updated_at)}</time>
                </button>
              ))}
              {!visible.length && (
                <p className="notes-no-results">Aucune note ne correspond à votre recherche.</p>
              )}
            </div>
          </aside>
          <section className="note-editor" aria-label="Éditeur de note">
            {current ? (
              <>
                <div className="note-editor-toolbar">
                  <button
                    className="icon-button mobile-note-back"
                    onClick={() => onSelect()}
                    aria-label="Revenir aux notes"
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <span
                    className={`save-status ${errors.has(current.id) ? 'save-error' : ''}`}
                    role="status"
                  >
                    {errors.has(current.id) ? (
                      <>
                        <CloudUpload size={15} /> Non enregistrée
                      </>
                    ) : saving.has(current.id) ? (
                      <>
                        <Spinner /> Enregistrement…
                      </>
                    ) : drafts.has(current.id) ? (
                      <>
                        <CloudUpload size={15} /> Modifications en cours
                      </>
                    ) : (
                      <>
                        <Check size={15} /> Enregistrée
                      </>
                    )}
                  </span>
                  <button
                    className="icon-button danger"
                    onClick={() => onDelete(current)}
                    aria-label="Supprimer la note"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                {errors.has(current.id) && (
                  <div className="note-save-error" role="alert">
                    <p>{errors.get(current.id)}</p>
                    <button className="text-button" onClick={() => onRetry(current.id)}>
                      Réessayer l’enregistrement
                    </button>
                  </div>
                )}
                <div className="note-writing">
                  <input
                    className="note-title-input"
                    aria-label="Titre de la note"
                    placeholder="Sans titre"
                    value={current.title}
                    maxLength={160}
                    onChange={(e) =>
                      onChange(current.id, { title: e.target.value, content: current.content })
                    }
                  />
                  <p className="note-date">
                    {dateLabel(current.created_at)} <span>·</span> Votre espace pour écrire
                  </p>
                  <textarea
                    className="note-content-input"
                    aria-label="Contenu de la note"
                    placeholder="Laissez vos idées prendre place…"
                    value={current.content}
                    maxLength={100000}
                    onChange={(e) =>
                      onChange(current.id, { title: current.title, content: e.target.value })
                    }
                    spellCheck
                  />
                </div>
                <div className="note-bottom">
                  <span>
                    {current.content.trim() ? current.content.trim().split(/\s+/).length : 0} mots
                  </span>
                  <span>Enregistrement automatique</span>
                </div>
              </>
            ) : (
              <EmptyState
                title="Choisissez une note."
                description="Retrouvez vos idées dans la liste, ou créez une nouvelle note."
              />
            )}
          </section>
        </div>
      )}
    </>
  )
}
