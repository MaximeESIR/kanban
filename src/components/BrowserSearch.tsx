import { useSearchMode } from './SearchSettings'
import { useDeferredValue, useMemo, useState } from 'react'
import { createBrowserIndex, type SearchDocument } from '../lib/browserSearch'

export function BrowserSearch({
  documents,
  onOpen,
}: {
  documents: SearchDocument[]
  onOpen: (id: string) => void
}) {
  const { mode } = useSearchMode()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const search = useMemo(() => createBrowserIndex(documents), [documents])
  const results = useMemo(() => search(deferred), [search, deferred])
  if (mode !== 'browser') return null
  return (
    <section className="assistant-box" aria-label="Recherche sans IA">
      <label className="field">
        Rechercher sans IA
        <input
          type="search"
          value={query}
          maxLength={500}
          placeholder="Jetson, déploiement, idées…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p>
        Recherche sur cet appareil, sans PC ni service IA. Mots-clés, accents et petites fautes de
        frappe. Hors ligne : données déjà chargées uniquement.
      </p>
      {query.trim() && (
        <>
          <p role="status">
            {results.length
              ? `${results.length} résultat${results.length > 1 ? 's' : ''}`
              : 'Aucun résultat. Essayez des mots-clés plus précis.'}
            {results.length > 30 ? ' · 30 premiers affichés' : ''}
          </p>
          <ul className="browser-search-results">
            {results.slice(0, 30).map((result) => (
              <li key={result.id}>
                <button type="button" className="text-button" onClick={() => onOpen(result.id)}>
                  {result.title || 'Sans titre'}
                </button>
                <p>{result.excerpt}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
