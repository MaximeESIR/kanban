import { Assistant } from './Assistant'
import { RichText, embeddedImage } from './RichText'
import { type Project } from '../domain'
import { useState } from 'react'
import { ArrowLeft, Check, FileText, Plus, Search, Trash2, CloudUpload } from 'lucide-react'
import { dateLabel, matchesSearch, type Note, type NoteInput } from '../domain'
import { EmptyState, Spinner } from './ui'

export function Notes({
  notes,
  assistantEnabled,
  projects,
  onToTicket,
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
  assistantEnabled: boolean
  projects: Project[]
  onToTicket: (note: Note, projectId: string) => Promise<void>
  notes: Note[]
  selectedId?: string
  drafts: Map<string, NoteInput>
  saving: Set<string>
  errors: Map<string, string>
  onSelect: (id?: string) => void
  onChange: (id: string, input: NoteInput) => void
  onCreate: (category: 'pro' | 'perso') => void
  onDelete: (note: Note) => void
  onRetry: (id: string) => void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'pro' | 'perso'>('pro')
  const [reading, setReading] = useState(false),
    [imageError, setImageError] = useState(''),
    [projectId, setProjectId] = useState('')
  const visible = notes
    .map((note) => ({ ...note, ...drafts.get(note.id) }))
    .filter(
      (note) =>
        (query || (note.category || 'pro') === category) &&
        matchesSearch(query, note.title, note.content),
    )
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
        <button className="button primary" onClick={() => onCreate(category)} disabled={busy}>
          <Plus size={18} /> Nouvelle note
        </button>
      </header>
      <div className="note-tools">
        <button
          className="button secondary"
          aria-pressed={category === 'pro'}
          onClick={() => {
            setCategory('pro')
            onSelect()
          }}
        >
          Pro
        </button>
        <button
          className="button secondary"
          aria-pressed={category === 'perso'}
          onClick={() => {
            setCategory('perso')
            onSelect()
          }}
        >
          Perso
        </button>
      </div>
      <Assistant
        enabled={assistantEnabled}
        searchDocs={notes.map((n) => ({
          id: n.id,
          title: n.title,
          content: n.content
            .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, '[image]')
            .slice(0, 12000),
        }))}
        onOpen={(id) => onSelect(id)}
      />
      {!notes.length ? (
        <EmptyState
          icon={<FileText size={27} strokeWidth={1.5} />}
          title="Une page blanche vous attend."
          description="Une pensée, une liste, une idée à garder. Prenez une note, tout simplement."
          action={
            <button className="button primary" onClick={() => onCreate(category)} disabled={busy}>
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
                  onClick={() => (setCategory(note.category || 'pro'), onSelect(note.id))}
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
                      onChange(current.id, {
                        category: current.category,
                        title: e.target.value,
                        content: current.content,
                      })
                    }
                  />
                  <p className="note-date">
                    {dateLabel(current.created_at)} <span>·</span> Votre espace pour écrire
                  </p>
                  <div className="note-tools">
                    <button className="button secondary" onClick={() => setReading(!reading)}>
                      {reading ? 'Modifier' : 'Lire le rendu'}
                    </button>
                    <label className="button secondary">
                      Ajouter une image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="file-input"
                        onChange={async (e) => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          try {
                            const image = await embeddedImage(f)
                            if (current.content.length + image.length > 2000000)
                              throw new Error('Note limitée à 2 Mo.')
                            onChange(current.id, {
                              category: current.category,
                              title: current.title,
                              content: current.content + image,
                            })
                            setImageError('')
                          } catch (e) {
                            setImageError((e as Error).message)
                          }
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  {imageError && <p role="alert">{imageError}</p>}
                  {reading ? (
                    <RichText text={current.content} />
                  ) : (
                    <textarea
                      className="note-content-input"
                      aria-label="Contenu de la note"
                      placeholder="Laissez vos idées prendre place…"
                      value={current.content}
                      maxLength={2000000}
                      onChange={(e) =>
                        onChange(current.id, {
                          category: current.category,
                          title: current.title,
                          content: e.target.value,
                        })
                      }
                      onPaste={async (e) => {
                        const f = [...e.clipboardData.files].find((f) =>
                          f.type.startsWith('image/'),
                        )
                        if (f) {
                          e.preventDefault()
                          try {
                            const image = await embeddedImage(f)
                            if (current.content.length + image.length > 2000000)
                              throw new Error('Note trop longue')
                            onChange(current.id, {
                              category: current.category,
                              title: current.title,
                              content: current.content + image,
                            })
                          } catch (e) {
                            setImageError((e as Error).message)
                          }
                        }
                      }}
                      spellCheck
                    />
                  )}
                  <Assistant
                    key={current.id}
                    targetId={current.id}
                    enabled={assistantEnabled}
                    text={current.content}
                    onApply={(content) =>
                      onChange(current.id, {
                        category: current.category,
                        title: current.title,
                        content,
                      })
                    }
                  />
                  <div className="note-tools">
                    <select
                      aria-label="Projet destinataire de la note"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">Copier dans un ticket…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button secondary"
                      disabled={!projectId || busy}
                      onClick={() =>
                        void onToTicket(current, projectId).catch((e) =>
                          setImageError((e as Error).message),
                        )
                      }
                    >
                      Créer le ticket
                    </button>
                  </div>
                </div>
                <label className="field note-tools">
                  Type de note
                  <select
                    aria-label="Type de note"
                    value={current.category || 'pro'}
                    onChange={(e) => {
                      const c = e.target.value as 'pro' | 'perso'
                      onChange(current.id, {
                        title: current.title,
                        content: current.content,
                        category: c,
                      })
                      setCategory(c)
                    }}
                  >
                    <option value="pro">Pro</option>
                    <option value="perso">Perso</option>
                  </select>
                </label>
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
