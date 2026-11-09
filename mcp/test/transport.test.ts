import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { createTransport } from '../src/transport.js'

test('proxy transport tunnels requests, honors no_proxy and never falls back when proxy fails', async () => {
  const target = createServer((_req, res) => res.end('reachable'))
  target.listen(0, '127.0.0.1'); await once(target, 'listening')
  const port = (target.address() as {port:number}).port
  let tunnels = 0
  const proxy = createServer()
  proxy.on('connect', (_req, socket, head) => {
    tunnels++
    const upstream = connect(port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    socket.on('error', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy())
  })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as {port:number}).port}`
  const proxied = createTransport({httpProxy:proxyUrl, httpsProxy:proxyUrl, noProxy:''})
  const bypass = createTransport({httpProxy:'http://127.0.0.1:1', httpsProxy:'http://127.0.0.1:1', noProxy:'127.0.0.1'})
  const broken = createTransport({httpProxy:'http://127.0.0.1:1', httpsProxy:'http://127.0.0.1:1', noProxy:''})
  try {
    assert.equal(await (await proxied.transport('http://atelier-test.invalid/')).text(), 'reachable')
    assert.equal(tunnels,1)
    assert.equal(await (await bypass.transport(`http://127.0.0.1:${port}/`)).text(), 'reachable')
    await assert.rejects(broken.transport(`http://127.0.0.1:${port}/`, {signal:AbortSignal.timeout(1000)}))
  } finally {
    await Promise.all([proxied.close(),bypass.close(),broken.close()])
    proxy.close(); target.close()
  }
})
