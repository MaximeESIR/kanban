import { subscribeWorkspace } from '../lib/events'
import { ExecutionProvider } from './Execution'
import { createContext, useContext, type ReactNode, useEffect, useRef, useState } from 'react'
import { Mic, Square, Sparkles, Monitor } from 'lucide-react'
import {
  textHash,
  available,
  cancelJob,
  submit,
  type AIJob,
  type PC,
  type JobKind,
} from '../lib/assistant'
import { supabase, friendlyError } from '../lib/supabase'
import { RichText } from './RichText'
import { recentlySeen } from '../lib/serverClock'
import {
  assistantReady,
  parseAssistantSettings,
  type AssistantSettings,
} from '../lib/assistantSettings'
import { AssistantEngineChoice } from './AssistantEngineChoice'
export function usePC(enabled: boolean) {
  const [pcs, setPCs] = useState<PC[]>([]),
    [jobs, setJobs] = useState<AIJob[]>([]),
    [error, setError] = useState(''),
    [settings, setSettings] = useState<AssistantSettings | null>(null),
    [settingsError, setSettingsError] = useState(''),
    [legacy, setLegacy] = useState(false)
  useEffect(() => {
    if (!enabled || !supabase) return
    let live = true,
      inflight = false,
      again = false
    const poll = async (readJobs = true) => {
      if (!navigator.onLine) return
      if (inflight) {
        again = true
        return
      }
      inflight = true
      try {
        const [p, selection] = await Promise.all([
          supabase!.rpc('pc_status'),
          supabase!.rpc('assistant_settings'),
        ])
        if (p.error) throw p.error
        const missing = Boolean(
          selection.error &&
          (['PGRST202', '42883'].includes(selection.error.code) || selection.status === 404),
        )
        let current: AssistantSettings | null = null
        let selectionError = ''
        if (!missing) {
          try {
            if (selection.error) throw selection.error
            current = parseAssistantSettings(selection.data)
          } catch {
            selectionError = 'Le choix du moteur est indisponible. Réessayez après reconnexion.'
          }
        }
        const j = readJobs
          ? await supabase!
              .from('ai_jobs')
              .select(
                'id,kind,status,result,error,created_at,context' + (current ? ',provider' : ''),
              )
              .order('created_at', { ascending: false })
              .limit(20)
          : null
        if (j?.error) throw j.error
        if (live) {
          setPCs(p.data || [])
          if (j) setJobs(j.data as unknown as AIJob[])
          setSettings(current)
          setSettingsError(selectionError)
          setLegacy(missing)
          setError('')
        }
      } catch {
        if (live) {
          setPCs([])
          setSettings(null)
          setLegacy(false)
          setError('Liaison PC non configurée ou inaccessible.')
        }
      } finally {
        inflight = false
        if (again && live) {
          again = false
          void poll()
        }
      }
    }
    void poll()
    const timer = setInterval(() => void poll(false), 15000)
    const refresh = () => void poll()
    window.addEventListener('atelier-pc-refresh', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('atelier-pc-refresh', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled])
  return { pcs, jobs, error, settings, settingsError, legacy }
}
const PCContext = createContext<ReturnType<typeof usePC>>({
  pcs: [],
  jobs: [],
  error: '',
  settings: null,
  settingsError: '',
  legacy: false,
})
export function AssistantProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const state = usePC(enabled)
  useEffect(() => (enabled ? subscribeWorkspace() : undefined), [enabled])
  return (
    <PCContext.Provider value={state}>
      <ExecutionProvider enabled={enabled}>{children}</ExecutionProvider>
    </PCContext.Provider>
  )
}
export function Assistant({
  targetId,
  enabled,
  text,
  onApply,
  searchDocs,
  onOpen,
}: {
  targetId?: string
  enabled: boolean
  text?: string
  onApply?: (text: string) => void
  searchDocs?: { id: string; title: string; content: string }[]
  onOpen?: (id: string) => void
}) {
  const {
    pcs,
    jobs,
    error: connectionError,
    settings,
    settingsError,
    legacy,
  } = useContext(PCContext)
  const [open, setOpen] = useState(false),
    [prompt, setPrompt] = useState(''),
    [id, setId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [applied, setApplied] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    cancelled = useRef(false),
    before = useRef(''),
    after = useRef('')
  const engineReady = legacy || Boolean(settings && assistantReady(settings))
  const job = jobs.find((x) => x.id === id),
    running =
      busy ||
      (Boolean(id) && !job && !connectionError) ||
      job?.status === 'queued' ||
      job?.status === 'running'
  useEffect(
    () => () => {
      cancelled.current = true
      if (timer.current) clearTimeout(timer.current)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )
  async function send(kind: JobKind, input: Record<string, unknown>) {
    setError('')
    setBusy(true)
    setApplied(false)
    before.current = text || ''
    try {
      setId(
        await submit(
          kind,
          {
            ...input,
            context: { target: targetId, hash: await textHash(text || '') },
          },
          settings?.provider,
        ),
      )
      window.dispatchEvent(new Event('atelier-pc-refresh'))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  async function dictate() {
    setError('')
    if (recording) {
      recorder.current?.stop()
      return
    }
    try {
      if (!engineReady || !available(pcs, 'transcribe'))
        throw new Error('PC indisponible pour la dictée.')
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw new Error('Le microphone n’est pas disponible dans ce navigateur.')
      cancelled.current = false
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      const mime = types.find((x) => MediaRecorder.isTypeSupported(x))
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined)
      recorder.current = r
      const chunks: Blob[] = []
      let size = 0
      r.ondataavailable = (e) => {
        size += e.data.size
        chunks.push(e.data)
        if (size > 4000000 && r.state === 'recording') r.stop()
      }
      r.onstop = async () => {
        if (timer.current) clearTimeout(timer.current)
        stream.current?.getTracks().forEach((t) => t.stop())
        setRecording(false)
        if (cancelled.current) return
        const blob = new Blob(chunks, { type: r.mimeType })
        if (!blob.size || blob.size > 4000000) {
          setError('Enregistrement vide ou trop long (4 Mo maximum).')
          return
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const f = new FileReader()
          f.onload = () => resolve(String(f.result).split(',')[1])
          f.onerror = reject
          f.readAsDataURL(blob)
        })
        await send('transcribe', { audio_base64: base64, mime: blob.type })
      }
      r.start(1000)
      setRecording(true)
      timer.current = setTimeout(() => {
        if (r.state === 'recording') r.stop()
      }, 90000)
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop())
      setError(friendlyError(e))
    }
  }
  const can = (kind: JobKind) =>
    enabled && navigator.onLine && engineReady && available(pcs, kind) && !running && !recording
  return (
    <div className="assistant-box">
      <button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Monitor size={16} /> Assistant PC{' '}
        {enabled && pcs.some((p) => recentlySeen(p.last_seen)) ? '· connecté' : '· non connecté'}
      </button>
      {open && (
        <div className="assistant-panel">
          {!enabled ? (
            <p>
              La démo ne peut pas contacter votre ordinateur. Activez Supabase et la double
              authentification pour associer le PC.
            </p>
          ) : connectionError ? (
            <p>{connectionError}</p>
          ) : (
            <p>
              {pcs.length
                ? settings?.provider === 'groq'
                  ? 'Traitements Groq via votre PC : le PC doit rester allumé.'
                  : 'Traitements locaux sur votre PC, sans API payante.'
                : 'Associez le service PC en suivant le guide de configuration.'}
            </p>
          )}
          {enabled && !connectionError && (
            <AssistantEngineChoice
              settings={settings}
              legacy={legacy}
              error={settingsError}
              disabled={
                busy ||
                recording ||
                jobs.some((j) => j.status === 'queued' || j.status === 'running')
              }
            />
          )}
          <label className="field">
            {searchDocs ? 'Votre recherche' : 'Instructions personnalisées'}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={2000}
              placeholder={
                searchDocs
                  ? 'Où est la fonctionnalité pour le Jetson ?'
                  : 'Structure mes idées sans changer leur sens…'
              }
            />
          </label>
          <div className="assistant-actions">
            {searchDocs ? (
              <button
                className="button secondary"
                disabled={!can('search') || !prompt.trim()}
                onClick={() => void send('search', { query: prompt, documents: searchDocs })}
              >
                Rechercher avec le PC
              </button>
            ) : (
              <>
                <button
                  className="button secondary"
                  disabled={!can('summarize') || !text?.trim()}
                  onClick={() => void send('summarize', { text, prompt })}
                >
                  <Sparkles size={16} />
                  Résumer
                </button>
                <button
                  className="button secondary"
                  disabled={!can('rewrite') || !text?.trim() || !prompt.trim()}
                  onClick={() => void send('rewrite', { text, prompt })}
                >
                  Réécrire
                </button>
                <button
                  className="button secondary"
                  disabled={!recording && !can('transcribe')}
                  onClick={() => void dictate()}
                >
                  {recording ? <Square size={16} /> : <Mic size={16} />}{' '}
                  {recording ? 'Arrêter (90 s max)' : 'Dicter'}
                </button>
              </>
            )}
            {running && (
              <button
                className="text-button"
                disabled={!id || busy}
                onClick={() => void cancelJob(id).catch((e) => setError(friendlyError(e)))}
              >
                Annuler la demande
              </button>
            )}
          </div>
          {recording && (
            <p role="status">Enregistrement en cours. L’audio sera transmis au PC à l’arrêt.</p>
          )}
          {id && !job && !connectionError && (
            <p role="status">Demande transmise, en attente du PC…</p>
          )}
          {job && (
            <p role="status">
              {
                {
                  queued: 'En attente du PC…',
                  running:
                    job.provider === 'groq'
                      ? 'Traitement par Groq via le PC…'
                      : 'Traitement sur le PC…',
                  done: 'Résultat prêt à vérifier',
                  failed: 'Le traitement a échoué',
                  cancelled: 'Demande annulée',
                }[job.status]
              }
            </p>
          )}
          {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
          {job?.status === 'done' && job.result && (
            <div className="ai-result">
              {job.result.text && <RichText text={job.result.text} />}
              {job.result.matches?.map((m) => (
                <button key={m.id} className="search-hit" onClick={() => onOpen?.(m.id)}>
                  {searchDocs?.find((d) => d.id === m.id)?.title || 'Document'}
                  <small>{m.reason}</small>
                </button>
              ))}
              {onApply && job.result.text && (
                <>
                  {!applied ? (
                    <button
                      className="button primary"
                      disabled={text !== before.current}
                      onClick={() => {
                        after.current =
                          job.kind === 'transcribe'
                            ? `${text || ''}\n${job.result!.text}`
                            : job.result!.text!
                        onApply(after.current)
                        setApplied(true)
                      }}
                    >
                      Appliquer à la note
                    </button>
                  ) : (
                    <button
                      className="button secondary"
                      disabled={text !== after.current}
                      onClick={() => {
                        onApply(before.current)
                        setApplied(false)
                      }}
                    >
                      Annuler la modification
                    </button>
                  )}
                  {!applied && text !== before.current && (
                    <p>
                      La note a changé pendant le traitement. Copiez le résultat si vous souhaitez
                      le conserver ; le remplacement est désactivé.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <details>
            <summary>Dernières demandes</summary>
            {jobs.map((j) => (
              <button
                className="search-hit"
                key={j.id}
                onClick={async () => {
                  setId(j.id)
                  before.current =
                    j.context?.target === targetId &&
                    j.context?.hash === (await textHash(text || ''))
                      ? text || ''
                      : '\u0000'
                  setApplied(false)
                }}
              >
                {j.kind} · {j.provider === 'groq' ? 'Groq' : 'Local'} · {j.status} ·{' '}
                {new Date(j.created_at).toLocaleString('fr-FR')}
              </button>
            ))}
          </details>
        </div>
      )}
    </div>
  )
}
