import { useEffect, useState } from 'react'
import {
  assistantPCMessage,
  type AssistantEngine,
  type AssistantSettings,
} from '../lib/assistantSettings'
import { supabase, friendlyError } from '../lib/supabase'

export function AssistantEngineChoice({
  settings,
  legacy,
  error,
  disabled,
}: {
  settings: AssistantSettings | null
  legacy: boolean
  error: string
  disabled: boolean
}) {
  const [choice, setChoice] = useState<AssistantEngine>('local')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    if (settings) setChoice(settings.provider)
  }, [settings?.provider, settings?.revision])
  if (legacy)
    return (
      <p>Mode local. Le choix Groq nécessite la mise à jour 008 et le service PC correspondant.</p>
    )
  if (error) return <p role="status">{error}</p>
  if (!settings) return <p role="status">Vérification du moteur de l’assistant…</p>
  return (
    <div className="assistant-engine">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (!supabase || busy || disabled) return
          setBusy(true)
          setFailure('')
          try {
            const { error } = await supabase.rpc('set_assistant_provider', { p_provider: choice })
            if (error) throw error
            window.dispatchEvent(new Event('atelier-pc-refresh'))
          } catch (e) {
            setFailure(friendlyError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label className="field">
          Moteur des notes, dictées et recherches
          <select
            value={choice}
            disabled={busy || disabled || !navigator.onLine}
            onChange={(e) => setChoice(e.target.value as AssistantEngine)}
          >
            <option value="local">Local — Qwen et Whisper</option>
            <option value="groq">Groq — modèles à distance</option>
          </select>
        </label>
        <p>
          {choice === 'groq'
            ? 'Vos notes, dictées et le contenu des documents et tickets utilisés pour vos recherches seront envoyés à Groq via le PC. La clé reste sur le PC. Ce choix s’applique à vos prochaines demandes, sur tous vos appareils.'
            : 'Qwen et Whisper traitent vos demandes sur le PC. Ce choix s’applique à vos prochaines demandes, sur tous vos appareils.'}
        </p>
        {choice !== settings.provider && (
          <button
            type="submit"
            className="button secondary"
            disabled={busy || disabled || !navigator.onLine}
          >
            {busy
              ? 'Enregistrement…'
              : choice === 'groq'
                ? 'Utiliser Groq'
                : 'Utiliser les modèles locaux'}
          </button>
        )}
        {disabled && <p>Terminez ou annulez les demandes en cours avant de changer de moteur.</p>}
      </form>
      <div role="status" className="assistant-engine-status">
        {settings.pcs.length ? (
          settings.pcs.map((pc, index) => (
            <p key={index}>
              {settings.pcs.length > 1 && <strong>{pc.label} : </strong>}
              {assistantPCMessage(pc, settings)}
            </p>
          ))
        ) : (
          <p>Choix mémorisé. Connectez votre PC pour l’appliquer.</p>
        )}
      </div>
      {settings.provider === 'groq' && (
        <p>
          Les modèles locaux restent sur disque pour permettre le retour au mode local sans
          téléchargement.
        </p>
      )}
      {failure && <p role="alert">{failure}</p>}
    </div>
  )
}
