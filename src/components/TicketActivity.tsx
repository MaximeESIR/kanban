import { boundedRequest } from '../lib/boundedRequest'
import { useEffect, useRef, useState } from 'react'
import type { Ticket } from '../domain'
import { supabase, friendlyError } from '../lib/supabase'
import { RichText } from './RichText'

type Claim = {
  id: string
  ticket_id: string
  agent_label: string
  state: 'running' | 'review' | 'approved' | 'cancelled'
  report: { summary: string; tests: string[]; limitations: string[] } | null
  created_at: string
  updated_at: string
}
type History = {
  id: string
  ticket_id: string
  description: string
  agent_label: string
  created_at: string
  previous_version: string
  replaced_version: string
}
type Activity = { claim: Claim | null; history: History[] }

export function TicketActivity({
  ticket,
  enabled,
  unsaved,
  expectedVersion,
  busy,
  onBusy,
  onUpdated,
}: {
  ticket: Ticket
  enabled: boolean
  unsaved: boolean
  expectedVersion: string
  busy: boolean
  onBusy: (busy: boolean) => void
  onUpdated: (ticket: Ticket) => void
}) {
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef<{ key: string; id: string } | null>(null)
  useEffect(() => {
    if (!enabled || !supabase) return
    let live = true
    const refresh = async () => {
      if (!navigator.onLine) return
      setLoading(true)
      try {
        const { data, error } = await boundedRequest((signal) =>
          supabase!
            .rpc('ticket_agent_activity', {
              p_ticket: ticket.id,
            })
            .abortSignal(signal),
        )
        if (error) throw error
        if (!data || !Array.isArray(data.history) || !Object.hasOwn(data, 'claim'))
          throw new Error('Historique des agents indisponible. Vérifiez la mise à jour 009.')
        if (live) {
          setActivity(data as Activity)
          setError('')
        }
      } catch (e) {
        if (live) {
          const code = (e as { code?: string }).code
          setError(
            code === 'PGRST202' || code === '42883'
              ? 'Le suivi des agents et l’historique nécessitent la mise à jour 009.'
              : friendlyError(e),
          )
        }
      } finally {
        if (live) setLoading(false)
      }
    }
    const trigger = () => void refresh()
    trigger()
    for (const event of ['atelier-workspace-refresh', 'online', 'focus'])
      window.addEventListener(event, trigger)
    return () => {
      live = false
      for (const event of ['atelier-workspace-refresh', 'online', 'focus'])
        window.removeEventListener(event, trigger)
    }
  }, [enabled, ticket.id, ticket.updated_at])
  if (!enabled) return null
  const claim = activity?.claim
  const disabled = busy || unsaved || !navigator.onLine
  async function act(name: string, extra: Record<string, string>) {
    if (!supabase || disabled) return
    const params = { p_ticket: ticket.id, p_version: expectedVersion, ...extra }
    const key = JSON.stringify([name, params])
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    onBusy(true)
    setError('')
    try {
      const args = { p_request: request.current.id, ...params }
      const { data, error } = await boundedRequest((signal) =>
        supabase!.rpc(name, args).abortSignal(signal),
      )
      if (error) throw error
      if (!data?.ticket || data.ticket.id !== ticket.id)
        throw new Error('Réponse inattendue. Actualisez le ticket pour vérifier son état.')
      request.current = null
      onUpdated(data.ticket)
      window.dispatchEvent(new Event('atelier-workspace-refresh'))
      window.dispatchEvent(new Event('atelier-execution-refresh'))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      onBusy(false)
    }
  }
  return (
    <section className="ticket-agent-activity" aria-label="Travail des agents et historique">
      {claim && (
        <div className="run-report">
          <strong>
            {claim.agent_label} ·{' '}
            {
              {
                running: 'Travail en cours',
                review: 'Résultat à valider',
                approved: 'Résultat validé',
                cancelled: 'Prise en charge annulée',
              }[claim.state]
            }
          </strong>
          {claim.report && (
            <>
              <p>{claim.report.summary}</p>
              <strong>Vérifications annoncées par l’agent</strong>
              {claim.report.tests.length ? (
                <ul>
                  {claim.report.tests.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p>Aucun résultat de test communiqué.</p>
              )}
              {claim.report.limitations.length > 0 && (
                <>
                  <strong>Limites et points à vérifier</strong>
                  <ul>
                    {claim.report.limitations.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {claim.state === 'review' && (
            <>
              <p>
                Vérifiez le travail et les tests avant de fermer le ticket. Le rapport ne déclenche
                aucune fusion de code.
              </p>
              <button
                type="button"
                className="button primary"
                disabled={disabled}
                onClick={() => void act('approve_agent_review', { p_claim: claim.id })}
              >
                Valider le résultat de l’agent et passer à Done
              </button>
            </>
          )}
          {['running', 'review'].includes(claim.state) && (
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => void act('cancel_agent_claim', { p_claim: claim.id })}
            >
              {claim.state === 'review'
                ? 'Écarter le résultat de l’agent'
                : 'Annuler la prise en charge de l’agent'}
            </button>
          )}
          {claim.state === 'running' && (
            <p>
              Annuler libère le ticket. Pour arrêter le développement, interrompez aussi la session
              de votre agent sur le PC.
            </p>
          )}
          {unsaved && (
            <p>Enregistrez vos modifications avant de valider ou d’annuler la prise en charge.</p>
          )}
        </div>
      )}
      <details className="ticket-history">
        <summary>
          Historique des descriptions modifiées par les agents
          {activity ? ` (${activity.history.length}/20)` : ''}
        </summary>
        <p>
          Les 20 dernières descriptions remplacées par un agent sont conservées. Une restauration
          conserve les autres champs du ticket.
        </p>
        {loading && <p role="status">Chargement de l’historique…</p>}
        {activity?.history.length === 0 && <p>Aucune description remplacée par un agent.</p>}
        {activity?.history.map((entry) => (
          <details key={entry.id}>
            <summary>
              {new Date(entry.created_at).toLocaleString('fr-FR')} · {entry.agent_label}
            </summary>
            {entry.description ? <RichText text={entry.description} /> : <p>Description vide.</p>}
            <button
              type="button"
              className="button secondary"
              disabled={disabled || claim?.state === 'running'}
              onClick={() => void act('restore_ticket_description', { p_history: entry.id })}
            >
              Restaurer cette description
            </button>
          </details>
        ))}
        {(unsaved || claim?.state === 'running') && (
          <p>
            {unsaved
              ? 'Enregistrez vos modifications avant de restaurer une description.'
              : 'Attendez la fin du travail de l’agent ou annulez sa prise en charge avant de restaurer.'}
          </p>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
