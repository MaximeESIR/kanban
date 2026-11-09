import { createContext, useContext, useState, type ReactNode } from 'react'
type Mode = 'browser' | 'pc'
const Context = createContext({ mode: 'browser' as Mode, setMode: (_mode: Mode) => {}, error: '' })
export const useSearchMode = () => useContext(Context)
export function SearchPreferences({ ownerId, children }: { ownerId: string; children: ReactNode }) {
  const key = `atelier-search-mode:${ownerId}`
  const [mode, update] = useState<Mode>(() => {
    try {
      return localStorage.getItem(key) === 'pc' ? 'pc' : 'browser'
    } catch {
      return 'browser'
    }
  })
  const [error, setError] = useState('')
  function setMode(value: Mode) {
    update(value)
    try {
      localStorage.setItem(key, value)
      setError('')
    } catch {
      setError('Choix conservé pour cette visite seulement : stockage indisponible.')
    }
  }
  return <Context.Provider value={{ mode, setMode, error }}>{children}</Context.Provider>
}
export function SearchSettings() {
  const { mode, setMode, error } = useSearchMode()
  return (
    <details className="assistant-box">
      <summary>Paramètres de recherche</summary>
      <label className="field">
        Moteur de recherche
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="browser">Sans IA · sur cet appareil</option>
          <option value="pc">Avec IA · sur mon PC</option>
          <option value="groq" disabled>
            Groq · intégration à activer ultérieurement
          </option>
        </select>
      </label>
      <p>
        Choix commun aux notes et aux projets, conservé pour ce compte sur cet appareil. Le mode PC
        nécessite un ordinateur connecté. Aucun changement automatique de moteur.
      </p>
      {error && <p role="status">{error}</p>}
    </details>
  )
}
