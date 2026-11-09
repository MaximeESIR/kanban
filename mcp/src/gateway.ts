import { ConfigSchema, PublicError, readConfig, type Config } from './config.js'

export const RPC_NAMES = [
  'agent_list_projects', 'agent_list_tickets', 'agent_get_ticket', 'agent_search_tickets',
  'agent_create_ticket', 'agent_update_ticket', 'agent_append_ticket', 'agent_edit_body',
  'agent_claim_ticket', 'agent_finish_review',
] as const
export type RpcName = typeof RPC_NAMES[number]
export type RpcResult = Record<string, unknown>
export interface RpcGateway { rpc(name: RpcName, args: Record<string, unknown>): Promise<RpcResult> }

const RESPONSE_LIMIT = 2_000_000
const TIMEOUT_MS = 20_000
const safeMessages: Record<string, string> = {
  '42501': 'Accès refusé. Vérifiez le compte agent et les projets autorisés dans Supabase.',
  '40001': 'Le ticket a changé. Relisez-le puis utilisez sa nouvelle version ; aucune modification concurrente ne doit être écrasée.',
  '22023': 'Arguments refusés. Vérifiez les champs et utilisez un nouvel identifiant pour une nouvelle opération.',
  '55000': 'Ticket indisponible : prérequis non terminés, exécution ou prise en charge active. Consultez le ticket et demandez une validation humaine.',
  '23503': 'Projet, parent ou prérequis introuvable ou non autorisé.',
  '23514': 'Valeur ou relation entre tickets refusée.',
}

export class Gateway implements RpcGateway {
  private config: Config | undefined
  private token = ''
  private refreshToken = ''
  private expiresAt = 0
  private authenticating: Promise<void> | undefined
  constructor(private readonly loadConfig: () => Config = readConfig,
              private readonly transport: typeof fetch = fetch,
              private readonly now: () => number = Date.now) {}

  private configuration(): Config {
    if (!this.config) {
      const parsed = ConfigSchema.safeParse(this.loadConfig())
      if (!parsed.success) throw new PublicError('Configuration MCP invalide. Relancez mcp/setup.py sur le PC.')
      this.config = parsed.data
    }
    return this.config
  }

  private async post(path: string, data: Record<string, unknown>, token?: string): Promise<RpcResult> {
    const config = this.configuration()
    let response: Response
    try {
      response = await this.transport(config.supabase_url + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', apikey: config.publishable_key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(data),
      })
      const reader = response.body?.getReader()
      if (!reader) throw new PublicError('Réponse Supabase vide.')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > RESPONSE_LIMIT) {
            await reader.cancel()
            throw new PublicError('Réponse trop volumineuse. Réduisez le nombre de tickets demandés.')
          }
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw new PublicError('Réponse Supabase invalide. Aucun résultat fiable disponible.') }
      if (!response.ok) {
        if (response.status === 401) {
          this.token = ''; this.refreshToken = ''; this.expiresAt = 0
          throw new PublicError('Authentification MCP refusée ou expirée. Vérifiez le compte agent dédié ; ne réutilisez pas le compte humain ou PC.')
        }
        if (response.status === 404) throw new PublicError('API des tickets indisponible. Vérifiez que la migration MCP 009 est appliquée.')
        const code = body && typeof body === 'object' && 'code' in body ? String(body.code) : ''
        throw new PublicError(safeMessages[code] || 'Supabase a refusé l’opération. Aucun détail privé n’est affiché ; relisez le ticket avant de réessayer avec le même identifiant.')
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError('Réponse Supabase invalide.')
      return body as RpcResult
    } catch (error) {
      if (error instanceof PublicError) throw error
      throw new PublicError('Connexion Supabase impossible ou délai dépassé. Relisez le ticket ; pour une nouvelle tentative, conservez le même identifiant de requête et les mêmes arguments.')
    }
  }

  private async authenticate(): Promise<void> {
    if (this.token && this.now() < this.expiresAt) return
    if (!this.authenticating) {
      this.authenticating = (async () => {
        const config = this.configuration()
        const body = this.refreshToken ? { refresh_token: this.refreshToken } :
          { email: config.agent_email, password: config.agent_password }
        const result = await this.post('/auth/v1/token?grant_type=' + (this.refreshToken ? 'refresh_token' : 'password'), body)
        if (typeof result.access_token !== 'string' || !result.access_token || result.access_token.length > 16_384 ||
            typeof result.refresh_token !== 'string' || !result.refresh_token || result.refresh_token.length > 16_384 ||
            typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
          throw new PublicError('Session Supabase invalide. Vérifiez le compte agent.')
        }
        this.token = result.access_token
        this.refreshToken = result.refresh_token
        this.expiresAt = this.now() + Math.max(0, result.expires_in - 60) * 1000
      })().finally(() => { this.authenticating = undefined })
    }
    await this.authenticating
  }

  async rpc(name: RpcName, args: Record<string, unknown>): Promise<RpcResult> {
    if (!(RPC_NAMES as readonly string[]).includes(name)) throw new PublicError('Opération MCP non autorisée.')
    await this.authenticate()
    return this.post('/rest/v1/rpc/' + name, args, this.token)
  }
}
