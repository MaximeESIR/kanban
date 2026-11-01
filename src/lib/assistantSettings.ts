import { recentlySeen, serverNow } from './serverClock'

export type AssistantEngine = 'local' | 'groq'
export type AssistantPC = {
  label: string
  last_seen: string | null
  provider: AssistantEngine | null
  revision: number
  state: 'ready' | 'pending' | 'blocked'
  groq_configured: boolean
  local_models_unloaded: boolean
  error: string | null
}
export type AssistantSettings = {
  provider: AssistantEngine
  revision: number
  pcs: AssistantPC[]
}

export function parseAssistantSettings(value: unknown): AssistantSettings {
  const settings = value as AssistantSettings | null
  if (
    !settings ||
    !['local', 'groq'].includes(settings.provider) ||
    !Number.isSafeInteger(settings.revision) ||
    settings.revision < 0 ||
    !Array.isArray(settings.pcs) ||
    !settings.pcs.every(
      (pc) =>
        pc &&
        typeof pc.label === 'string' &&
        (pc.last_seen === null || typeof pc.last_seen === 'string') &&
        (pc.provider === null || ['local', 'groq'].includes(pc.provider)) &&
        Number.isSafeInteger(pc.revision) &&
        ['ready', 'pending', 'blocked'].includes(pc.state) &&
        typeof pc.groq_configured === 'boolean' &&
        typeof pc.local_models_unloaded === 'boolean' &&
        (pc.error === null || typeof pc.error === 'string'),
    )
  )
    throw new Error('Le choix du moteur est indisponible. Réessayez après reconnexion.')
  return settings
}

export function assistantReady(settings: AssistantSettings, now = serverNow()) {
  return settings.pcs.some(
    (pc) =>
      recentlySeen(pc.last_seen, now) &&
      pc.provider === settings.provider &&
      pc.revision === settings.revision &&
      pc.state === 'ready' &&
      (settings.provider === 'local' || (pc.groq_configured && pc.local_models_unloaded)),
  )
}

export function assistantPCMessage(pc: AssistantPC, settings: AssistantSettings) {
  if (!recentlySeen(pc.last_seen)) return 'Choix mémorisé. En attente du PC.'
  if (pc.revision !== settings.revision || pc.state === 'pending')
    return settings.provider === 'groq'
      ? 'Passage à Groq en cours ; déchargement des modèles locaux…'
      : 'Retour aux modèles locaux en cours…'
  if (pc.state === 'blocked')
    return (
      pc.error ||
      (settings.provider === 'groq' && !pc.groq_configured
        ? 'Clé Groq absente sur le PC. Ajoutez-la pour activer Groq.'
        : 'Le PC ne peut pas activer ce moteur. Vérifiez sa configuration.')
    )
  if (pc.provider !== settings.provider) return 'Le PC prépare le moteur choisi…'
  if (settings.provider === 'groq')
    return pc.local_models_unloaded && pc.groq_configured
      ? 'Groq prêt. Qwen déchargé, Whisper arrêté.'
      : 'En attente de confirmation du déchargement des modèles locaux.'
  return 'Modèles locaux prêts. Ils se chargeront à la prochaine demande.'
}
