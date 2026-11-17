import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CloudErrorKind } from '@shared/schemas/nexus-cloud'
import { CloudError, type CloudResource } from './cloud-adapter'

/** Loopback-only streaming gate: no extra probe consumes Quark's signed link. */
export class DownloadRelay {
  private leases = new Map<
    string,
    {
      resource: CloudResource
      expected: number | null
      failure: (kind: CloudErrorKind, status: number) => void
      responses: Set<ServerResponse>
      request?: (operation: () => Promise<Response>) => Promise<Response>
    }
  >()
  private server = createServer((request, response) => {
    void this.handle(
      request.url ?? '',
      request.method ?? '',
      request.headers.range,
      response
    )
  })
  private origin = ''
  constructor(
    private readonly idleTimeoutMs = 60000,
    private readonly fetcher: typeof fetch = fetch
  ) {}
  async start() {
    this.server.listen(0, '127.0.0.1')
    await once(this.server, 'listening')
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new CloudError('network')
    this.origin = `http://127.0.0.1:${address.port}`
  }
  issue(
    resource: CloudResource,
    expected: number | null,
    failure: (kind: CloudErrorKind, status: number) => void,
    request?: (operation: () => Promise<Response>) => Promise<Response>
  ) {
    const key = randomBytes(32).toString('hex')
    this.leases.set(key, {
      resource,
      expected,
      failure,
      responses: new Set(),
      request,
    })
    return `${this.origin}/${key}`
  }
  revoke(url: string) {
    const key = url.slice(url.lastIndexOf('/') + 1)
    const lease = this.leases.get(key)
    this.leases.delete(key)
    for (const response of lease?.responses ?? []) response.destroy()
  }
  private async handle(
    raw: string,
    method: string,
    range: string | undefined,
    response: ServerResponse
  ) {
    const lease = this.leases.get(raw.slice(1))
    if (!lease || !['GET', 'HEAD'].includes(method)) {
      response.writeHead(404).end()
      return
    }
    lease.responses.add(response)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    const idle = setTimeout(() => controller.abort(), this.idleTimeoutMs)
    controller.signal.addEventListener('abort', () => response.destroy(), {
      once: true,
    })
    response.on('close', () => {
      controller.abort()
      lease.responses.delete(response)
    })
    const fail = (kind: CloudErrorKind, status = 0) => {
      lease.failure(kind, status)
      if (!response.headersSent) response.writeHead(502)
      response.end()
    }
    try {
      const operation = () =>
        this.fetcher(lease.resource.url, {
          method,
          headers: {
            ...lease.resource.headers,
            'Accept-Encoding': 'identity',
            ...(range ? { Range: range } : {}),
          },
          signal: controller.signal,
        })
      const remote = await (lease.request
        ? lease.request(operation)
        : operation())
      clearTimeout(timeout)
      if (![200, 206].includes(remote.status)) {
        await remote.body?.cancel()
        fail('permission', remote.status)
        return
      }
      const contentRange = remote.headers.get('Content-Range')
      const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
      const length = remote.headers.get('Content-Length')
      const total =
        remote.status === 206
          ? match
            ? Number(match[3])
            : NaN
          : length === null
            ? NaN
            : Number(length)
      if (
        remote.headers.get('Content-Encoding') &&
        remote.headers.get('Content-Encoding') !== 'identity'
      ) {
        await remote.body?.cancel()
        fail('size')
        return
      }
      if (
        !Number.isSafeInteger(total) ||
        (lease.expected !== null && total !== lease.expected)
      ) {
        await remote.body?.cancel()
        fail('size')
        return
      }
      if (
        remote.status === 206 &&
        (!match ||
          Number(match[2]) - Number(match[1]) + 1 !== Number(length) ||
          Number(match[1]) > Number(match[2]) ||
          Number(match[2]) >= total)
      ) {
        await remote.body?.cancel()
        fail('size')
        return
      }
      if (range) {
        const requested = /^bytes=(\d+)-(\d*)$/.exec(range)
        if (
          !requested ||
          (remote.status === 200 && Number(requested[1]) !== 0) ||
          (remote.status === 206 &&
            (!match ||
              Number(match[1]) !== Number(requested[1]) ||
              (requested[2] !== '' &&
                Number(match[2]) !==
                  Math.min(Number(requested[2]), total - 1))))
        ) {
          await remote.body?.cancel()
          fail('headers')
          return
        }
      }
      const headers: Record<string, string> = {
        'Content-Length': length ?? String(total),
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
      }
      if (contentRange) headers['Content-Range'] = contentRange
      response.writeHead(remote.status, headers)
      if (method === 'HEAD') response.end()
      else if (remote.body) {
        const reader = remote.body.getReader()
        const stream = Readable.from(
          (async function* () {
            try {
              while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                idle.refresh()
                yield chunk.value
              }
            } finally {
              reader.releaseLock()
            }
          })()
        )
        await pipeline(stream, response)
      } else fail('network')
    } catch (error) {
      if (!controller.signal.aborted)
        fail(error instanceof CloudError ? error.kind : 'network')
      else response.destroy()
    } finally {
      clearTimeout(timeout)
      clearTimeout(idle)
      lease.responses.delete(response)
    }
  }
  async stop() {
    for (const key of this.leases.keys()) this.revoke(`${this.origin}/${key}`)
    this.server.closeAllConnections()
    if (this.server.listening)
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}
