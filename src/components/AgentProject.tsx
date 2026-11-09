import { useEffect, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
export function AgentProject({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    async function refresh() {
      if (!enabled || !supabase) return
      const { data, error } = await supabase.rpc('agent_workspace_state')
      if (!live) return
      setReady(!error && Array.isArray(data?.project_ids) && Boolean(data?.registered))
      if (error || !Array.isArray(data?.project_ids))
        setError('Le choix du projet MCP nécessite la mise à jour 010.')
      else {
        setSelected(data.project_ids)
        setError(data.registered ? '' : 'Le compte MCP doit encore être enregistré.')
      }
    }
    const trigger = () => {
      void refresh().catch(() => {
        if (live) setError('Connexion indisponible.')
      })
    }
    trigger()
    window.addEventListener('focus', trigger)
    return () => {
      live = false
      window.removeEventListener('focus', trigger)
    }
  }, [enabled, projectId])
  if (!enabled) return null
  return (
    <section className="assistant-box" aria-label="Projet des agents MCP">
      <strong>Claude · Codex · Vibe</strong>
      <p>
        {selected.includes(projectId)
          ? 'Ce projet est sélectionné pour les agents.'
          : 'Ce projet n’est pas sélectionné pour les agents.'}{' '}
        Plusieurs projets peuvent être activés. Chaque session doit recevoir son projet et son
        ticket précis, sans lancement automatique.
      </p>
      <button
        className="button secondary"
        disabled={!ready || busy}
        onClick={async () => {
          if (!supabase) return
          setBusy(true)
          setError('')
          try {
            const { data, error } = await supabase.rpc('set_agent_project', {
              p_project: projectId,
              p_enabled: !selected.includes(projectId),
            })
            if (error) throw error
            if (!Array.isArray(data?.project_ids))
              throw new Error('Réponse inattendue. Rechargez le projet pour vérifier les accès.')
            setSelected(data.project_ids)
          } catch (e) {
            setError(friendlyError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        {selected.includes(projectId)
          ? 'Retirer l’accès des agents'
          : 'Utiliser ce projet avec les agents'}
      </button>
      <p>
        Le choix limite les prochains accès aux tickets. Il n’efface pas les informations déjà lues
        par une session ; ouvrez une nouvelle session quand vous changez de projet.
      </p>
      {error && <p role="status">{error}</p>}
    </section>
  )
}
