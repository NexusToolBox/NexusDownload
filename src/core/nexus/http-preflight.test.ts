import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BROWSER_UA, probeHttp } from './http-preflight'

describe('HTTP preflight against actual response variants', () => {
  let server: Server
  let base = ''
  const calls: { path: string; method: string; range?: string }[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      const route = req.url ?? '/'
      calls.push({
        path: route,
        method: req.method ?? '',
        range: req.headers.range,
      })
      if (route === '/redirect') {
        res.writeHead(302, {
          Location: base.replace('127.0.0.1', 'localhost') + '/known',
        })
        res.end()
        return
      }
      if (
        route === '/referer' &&
        (req.headers.referer !== base + '/' ||
          req.headers['user-agent'] !== BROWSER_UA)
      ) {
        res.writeHead(403)
        res.end()
        return
      }
      if (/^\/status\/\d+$/.test(route)) {
        res.writeHead(Number(route.split('/').at(-1)))
        res.end()
        return
      }
      if (route === '/head-fails' && req.method === 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      if (route === '/known' || route === '/referer') {
        res.writeHead(200, {
          'Content-Length': '1234',
          'Accept-Ranges': 'bytes',
        })
        res.end()
        return
      }
      if (req.method === 'HEAD') {
        res.writeHead(200)
        res.end()
        return
      }
      if (route === '/no-range') {
        res.writeHead(200, { 'Content-Length': '8' })
        res.end('download')
        return
      }
      if (route === '/range' || route === '/head-fails') {
        res.writeHead(206, {
          'Content-Length': '1',
          'Content-Range': 'bytes 0-0/1234',
        })
        res.end('x')
        return
      }
      // Node streams these without Content-Length using chunked encoding.
      res.writeHead(
        200,
        route === '/chunked' ? { 'Transfer-Encoding': 'chunked' } : {}
      )
      res.write('data')
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (address && typeof address !== 'string')
      base = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('uses HEAD first and does not transfer a known body', async () => {
    const result = await probeHttp(base + '/known')
    expect(result.size).toBe(1234)
    expect(result.probe.error).toBeUndefined()
    expect(calls.filter((call) => call.path === '/known').at(-1)?.method).toBe(
      'HEAD'
    )
  })
  it.each(['/range', '/head-fails'])(
    'falls back to a single-byte ranged GET: %s',
    async (route) => {
      const result = await probeHttp(base + route)
      expect(result.size).toBe(1234)
      expect(result.probe.range).toBe(true)
      expect(
        calls
          .filter((call) => call.path === route)
          .map((call) => [call.method, call.range])
      ).toEqual([
        ['HEAD', undefined],
        ['GET', 'bytes=0-0'],
      ])
    }
  )
  it.each(['/unknown', '/chunked'])(
    'keeps unknown size distinct from zero: %s',
    async (route) => {
      const result = await probeHttp(base + route)
      expect(result.size).toBeNull()
      expect(result.probe.error).toBeUndefined()
    }
  )
  it('allows a server that ignores Range and records that resume is unsupported', async () => {
    const result = await probeHttp(base + '/no-range')
    expect(result.size).toBe(8)
    expect(result.probe.range).toBe(false)
  })
  it('follows a redirect to a different hostname', async () => {
    expect((await probeHttp(base + '/redirect')).size).toBe(1234)
  })
  it('retries 403 with the source origin and browser UA, retaining both for task creation', async () => {
    const result = await probeHttp(base + '/referer')
    expect(result.size).toBe(1234)
    expect(result.probe.retried).toBe(true)
    expect(result.headers).toEqual({
      Referer: base + '/',
      'User-Agent': BROWSER_UA,
    })
  })
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [500, 'server'],
    [503, 'server'],
  ] as const)(
    'reports HTTP %s without claiming success',
    async (status, error) => {
      const result = await probeHttp(`${base}/status/${status}`)
      expect(result.probe).toMatchObject({ status, error })
      expect(result.size).toBeNull()
    }
  )
})
