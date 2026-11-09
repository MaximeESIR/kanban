import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as z from 'zod/v4'

export class PublicError extends Error {}
export const CONFIG_MESSAGE = 'Compte MCP non configuré. Sur le PC, lancez python3 /home/mblaret/Documents/kanban/mcp/setup.py puis suivez mcp/README.md.'
export const ConfigSchema = z.strictObject({
  supabase_url: z.string().regex(/^https:\/\/[a-z0-9-]{3,63}\.supabase\.co$/),
  publishable_key: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{10,500}$/),
  agent_email: z.email().max(254),
  agent_password: z.string().min(1).max(1024),
})
export type Config = z.infer<typeof ConfigSchema>

export function configPath(): string {
  return process.env.ATELIER_MCP_CONFIG || join(homedir(), '.config', 'atelier', 'mcp.json')
}

export function readConfig(path = configPath()): Config {
  let fd: number | undefined
  try {
    if (realpathSync(path) !== resolve(path)) throw new PublicError(CONFIG_MESSAGE)
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new PublicError(CONFIG_MESSAGE)
    const result = ConfigSchema.safeParse(JSON.parse(readFileSync(fd, 'utf8')))
    if (!result.success) throw new PublicError(CONFIG_MESSAGE)
    return result.data
  } catch {
    throw new PublicError(CONFIG_MESSAGE)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
