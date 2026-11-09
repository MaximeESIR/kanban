import { networkOptions } from './network.js'
import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici'

// Respect the client's HTTP(S)_PROXY / NO_PROXY environment without changing it.
// Lazy initialization keeps MCP discovery usable without network configuration.
export function createTransport(options?: ConstructorParameters<typeof EnvHttpProxyAgent>[0]) {
  let dispatcher: EnvHttpProxyAgent | undefined
  const transport: typeof fetch = async (input, init) => {
    dispatcher ??= new EnvHttpProxyAgent(options ?? networkOptions())
    return await proxyFetch(input as string, {
      ...init,
      dispatcher,
    } as Parameters<typeof proxyFetch>[1]) as unknown as Response
  }
  return { transport, close: async () => { await dispatcher?.close() } }
}
export const environmentFetch = createTransport().transport
