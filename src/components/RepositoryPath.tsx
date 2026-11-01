import { useEffect, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'

type PC = { id: string; label: string; last_seen: string | null }
type Request = { id: string; requested_path: string; status: string; error: string | null }

export function RepositoryPath({ projectId }: { projectId: string }) {
  const [pcs, setPCs] = useState<PC[]>([]),
    [requests, setRequests] = useState<Request[]>([]),
    [setupError, setSetupError] = useState(''),
    [error, setError] = useState(''),
    [worker, setWorker] = useState(''),
    [path, setPath] = useState(''),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [requestId, setRequestId] = useState<string | null>(null)
  useEffect(() => {
    if (!supabase) return
    let live = true
    const refresh = async () => {
      const [workers, jobs] = await Promise.all([
        supabase!.rpc('repository_pcs'),
        supabase!
          .from('repository_requests')
          .select('id,requested_path,status,error')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(5),
      ])
      if (!live) return
      if (workers.error || jobs.error) {
        setSetupError(
          'La saisie des chemins nécessite la migration 007 et la mise à jour du service PC. Les étapes sont dans le guide de connexion.',
        )
      } else {
        setSetupError('')
        setPCs(workers.data || [])
        setRequests(jobs.data || [])
      }
    }
    const trigger = () => {
      void refresh().catch(() => {
        if (live) setSetupError('Connexion au PC indisponible. Réessayez après reconnexion.')
      })
    }
    trigger()
    for (const event of ['atelier-execution-refresh', 'online', 'focus'])
      window.addEventListener(event, trigger)
    return () => {
      live = false
      for (const event of ['atelier-execution-refresh', 'online', 'focus'])
        window.removeEventListener(event, trigger)
    }
  }, [projectId])
  const selectedPC = pcs.find((p) => p.id === worker) || pcs[0]
  const latest = requests[0]
  const pending = latest && ['queued', 'checking'].includes(latest.status)
  const refresh = () => window.dispatchEvent(new Event('atelier-execution-refresh'))
  return (
    <div className="repository-path-form">
      <h3>Indiquer un chemin sur le PC</h3>
      <p>
        Codex travaillera directement dans ce dossier. Le chemin est celui du PC, même depuis votre
        téléphone.
      </p>
      {setupError ? (
        <p role="status">{setupError}</p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!supabase || !selectedPC || busy) return
            setBusy(true)
            setError('')
            const id = requestId || crypto.randomUUID()
            setRequestId(id)
            try {
              const result = await supabase.rpc('request_repository', {
                p_id: id,
                p_project: projectId,
                p_worker: selectedPC.id,
                p_path: path,
                p_create: create,
              })
              if (result.error) throw result.error
              setRequestId(null)
              refresh()
            } catch (e) {
              setError(friendlyError(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {pcs.length > 1 && (
            <label>
              PC concerné
              <select
                value={selectedPC?.id || ''}
                disabled={busy}
                onChange={(e) => {
                  setWorker(e.target.value)
                  setRequestId(null)
                }}
              >
                {pcs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Type de dossier
            <select
              value={create ? 'new' : 'existing'}
              disabled={busy}
              onChange={(e) => {
                setCreate(e.target.value === 'new')
                setRequestId(null)
              }}
            >
              <option value="existing">Dépôt Git existant</option>
              <option value="new">Nouveau dossier pour le projet</option>
            </select>
          </label>
          <label>
            Chemin du projet sur le PC
            <input
              value={path}
              disabled={busy}
              required
              maxLength={1000}
              autoComplete="off"
              spellCheck={false}
              placeholder="/home/vous/Documents/mon-projet"
              onChange={(e) => {
                setPath(e.target.value)
                setRequestId(null)
              }}
            />
          </label>
          {create && (
            <p>
              Le dossier doit être vide ou inexistant, et son parent doit déjà exister. Codex
              initialisera Git au premier Run.
            </p>
          )}
          {!pcs.length && <p>Aucun PC associé à ce compte. Connectez le service PC.</p>}
          <button
            type="submit"
            className="button secondary"
            disabled={busy || !selectedPC || !path.trim()}
          >
            {busy ? 'Envoi…' : create ? 'Créer et associer' : 'Vérifier et associer'}
          </button>
          <p>
            Cette action associe le dossier ; seul Run lance le développement. Si le PC est éteint,
            la demande attend son retour.
          </p>
        </form>
      )}
      {latest && (
        <div role="status">
          {latest.status === 'queued' && <p>Chemin envoyé — en attente du PC.</p>}
          {latest.status === 'checking' && <p>Le PC vérifie le chemin…</p>}
          {latest.status === 'ready' && <p>Chemin vérifié et associé au projet.</p>}
          {latest.status === 'failed' && <p>{latest.error || 'Le PC a refusé ce chemin.'}</p>}
          {latest.status === 'cancelled' && <p>Demande de chemin annulée.</p>}
          {pending && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  const r = await supabase!.rpc('cancel_repository_request', { p_id: latest.id })
                  if (r.error) throw r.error
                  refresh()
                } catch (e) {
                  setError(friendlyError(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Annuler la demande de chemin
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
