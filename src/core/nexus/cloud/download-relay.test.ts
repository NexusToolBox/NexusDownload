import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { DownloadRelay } from './download-relay'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
describe('download response gate', () => {
  it('cuts an idle body so the engine can retry', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '10' })
      res.write('a')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture')
    const relay = new DownloadRelay(100)
    await relay.start()
    cleanups.push(() => relay.stop())
    const uri = relay.issue(
      {
        fileId: 'idle',
        bytes: 10,
        kind: 'original-file',
        url: `http://127.0.0.1:${address.port}/`,
        headers: {},
      },
      10,
      () => {}
    )
    const response = await fetch(uri)
    await expect(response.arrayBuffer()).rejects.toThrow()
  })
  async function fixture(total: number, expected: number) {
    const server = createServer((req, res) => {
      if (req.headers.range)
        res
          .writeHead(206, {
            'Content-Range': `bytes 0-0/${total}`,
            'Content-Length': '1',
          })
          .end('a')
      else res.writeHead(200, { 'Content-Length': total }).end('a')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture')
    const relay = new DownloadRelay()
    await relay.start()
    cleanups.push(() => relay.stop())
    const failures: string[] = []
    const uri = relay.issue(
      {
        fileId: 'file',
        url: `http://127.0.0.1:${address.port}/`,
        headers: {},
        bytes: total,
        kind: 'original-file',
      },
      expected,
      (kind) => {
        failures.push(kind)
      }
    )
    return { uri, failures }
  }
  it('allows Range responses with totals larger than 4 GiB', async () => {
    const test = await fixture(5000000000, 5000000000)
    const response = await fetch(test.uri, { headers: { Range: 'bytes=0-0' } })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('a')
    expect(test.failures.length).toBe(0)
  })
  it('rejects replaced content before any payload reaches the engine', async () => {
    const test = await fixture(1, 5000000000)
    const response = await fetch(test.uri, { headers: { Range: 'bytes=0-0' } })
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('')
    expect(test.failures).toEqual(['size'])
  })
})
