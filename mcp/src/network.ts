import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { PublicError } from './config.js'

const keys = new Set(['http_proxy','https_proxy','no_proxy','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','ws_proxy','wss_proxy','WS_PROXY','WSS_PROXY'])
// Clients may intentionally filter environment variables. Use the private file
// prepared by the PC installer as a fallback, never shell-source its contents.
export function networkOptions(path = join(homedir(), '.config/atelier/network.env'), env: NodeJS.ProcessEnv = process.env) {
  const saved: Record<string,string> = {}
  let fd: number | undefined
  try {
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    if (fd !== undefined) {
      const stat=fstatSync(fd)
      if (realpathSync(path)!==resolve(path) || !stat.isFile() || stat.size>100_000 || (stat.mode&0o077)!==0 || (process.getuid && stat.uid!==process.getuid())) throw new Error('private file required')
      for (const line of readFileSync(fd,'utf8').split('\n')) {
        if (!line.trim() || line.startsWith('#')) continue
        const split=line.indexOf('='); const key=line.slice(0,split)
        if (split<0 || !keys.has(key)) throw new Error('invalid key')
        const value: unknown = JSON.parse(line.slice(split+1))
        if (typeof value!=='string' || value.length>8192 || /[\x00-\x1f]/.test(value)) throw new Error('invalid value')
        saved[key]=value
      }
    }
  } catch { throw new PublicError('Configuration réseau MCP refusée. Vérifiez le fichier privé ~/.config/atelier/network.env sur le PC.') }
  finally { if (fd!==undefined) closeSync(fd) }
  const get=(lower: string, upper: string) => env[lower] ?? env[upper] ?? saved[lower] ?? saved[upper] ?? ''
  return { httpProxy:get('http_proxy','HTTP_PROXY'), httpsProxy:get('https_proxy','HTTPS_PROXY'), noProxy:get('no_proxy','NO_PROXY') }
}
