import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { DeviceCodeService } from '@core/bridge/device-code-service'
import { type PairedClient, PairingService } from '@core/bridge/pairing-service'
import {
  type ControlTask,
  phoneRequestSchema,
} from '@shared/schemas/nexus-control'
import QRCode from 'qrcode'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import { jsonBody, privateAddress, reply, sameOrigin } from './http-guard'

export class PhoneServer {
  private pairing: PairingService
  private codes: DeviceCodeService
  private server?: Server
  private hosts: string[] = []
  private qr = ''
  private rates = new Map<string, { start: number; count: number }>()
  constructor(
    private deps: {
      broker: CredentialBroker
      webRoot: string
      addresses(): string[]
      changed(): void
      collect(input: string): Promise<void>
      tasks(): ControlTask[]
      control(action: 'pause' | 'resume', id: string): Promise<void>
    }
  ) {
    this.pairing = new PairingService({
      load: async () => JSON.parse(deps.broker.get('phone-pairings') || '[]'),
      save: async (values: PairedClient[]) => {
        await deps.broker.update('phone-pairings', () => JSON.stringify(values))
        deps.changed()
      },
    })
    this.codes = new DeviceCodeService(this.pairing)
  }
  async load() {
    await this.pairing.load()
  }
  snapshot() {
    return {
      urls: this.server
        ? this.hosts
            .filter((h) => !h.startsWith('127.'))
            .map((h) => `http://${h}/`)
        : [],
      qr: this.qr,
      devices: this.pairing.listPaired().map((c) => ({
        id: c.identity.kind === 'cli' ? c.identity.id : '',
        name: c.name,
        pairedAt: c.pairedAt,
      })),
    }
  }
  async approve(code: string) {
    const normalized = code.replace(/[-\s]/g, '').toUpperCase()
    const pending = this.codes
      .listPending()
      .find(
        (p) => p.kind === 'cli' && p.userCode.replace(/-/g, '') === normalized
      )
    if (!pending || pending.kind !== 'cli') throw new Error('control.pairing')
    await this.codes.approve(pending.requestId)
    this.deps.changed()
  }
  async revoke(id: string) {
    await this.pairing.revoke({ kind: 'cli', id }, 'removed')
    this.deps.changed()
  }
  async start(port = 16811) {
    if (this.server) return
    this.hosts = [
      ...new Set([
        '127.0.0.1',
        ...this.deps.addresses().filter(privateAddress),
      ]),
    ].map((a) => `${a}:${port}`)
    const server = createServer((req, res) => {
      void (async () => {
        if (
          !privateAddress(req.socket.remoteAddress || '') ||
          !sameOrigin(req, this.hosts)
        )
          return reply(res, 403, {})
        const key = req.socket.remoteAddress || ''
        const now = Date.now(),
          rate = this.rates.get(key)
        if (!rate || now - rate.start > 60000) {
          if (this.rates.size > 512) this.rates.clear()
          this.rates.set(key, { start: now, count: 1 })
        } else if (++rate.count > 120) return reply(res, 429, {})
        const route = req.url || ''
        if (
          req.method === 'GET' &&
          (route === '/' || /^\/assets\/[\w.-]+$/.test(route))
        ) {
          const file = route === '/' ? 'phone.html' : route.slice(1)
          const body = await readFile(path.join(this.deps.webRoot, file))
          const ext = path.extname(file)
          res.writeHead(200, {
            'content-type':
              (
                {
                  '.html': 'text/html; charset=utf-8',
                  '.js': 'text/javascript',
                  '.css': 'text/css',
                  '.woff2': 'font/woff2',
                } as Record<string, string>
              )[ext] || 'application/octet-stream',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            'content-security-policy':
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          })
          res.end(body)
          return
        }
        if (req.method === 'POST' && route === '/pair') {
          const { name } = z
            .object({ name: z.string().min(1).max(40) })
            .strict()
            .parse(await jsonBody(req))
          return reply(res, 200, this.codes.request(name, '1.0.0'))
        }
        if (req.method === 'POST' && route === '/poll') {
          const { requestId } = z
            .object({ requestId: z.string().max(128) })
            .strict()
            .parse(await jsonBody(req))
          return reply(res, 200, this.codes.poll(requestId))
        }
        const bearer = req.headers.authorization?.replace(/^Bearer /, '') || ''
        const client = this.pairing.findByToken(bearer)
        if (!client) return reply(res, 401, {})
        this.pairing.markActive(client.identity)
        if (route === '/tasks' && req.method === 'GET')
          return reply(res, 200, this.deps.tasks().slice(-1000))
        if (route === '/action' && req.method === 'POST') {
          const data = phoneRequestSchema.parse(await jsonBody(req))
          if (data.action === 'collect') await this.deps.collect(data.input)
          else await this.deps.control(data.action, data.id)
          return reply(res, 200, { ok: true })
        }
        return reply(res, 404, {})
      })().catch(() => {
        if (!res.headersSent) reply(res, 400, { error: 'control.failed' })
        else res.end()
      })
    })
    server.requestTimeout = 15000
    server.headersTimeout = 10000
    server.maxConnections = 32
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '0.0.0.0', resolve)
    })
    this.server = server
    // Capture an actual ephemeral port in local integration tests.
    const address = server.address()
    if (address && typeof address !== 'string')
      this.hosts = this.hosts.map((h) => `${h.split(':')[0]}:${address.port}`)
    const url = this.snapshot().urls[0]
    this.qr = url ? await QRCode.toDataURL(url, { margin: 1, width: 240 }) : ''
  }
  async stop() {
    this.codes.dispose()
    this.qr = ''
    const server = this.server
    this.server = undefined
    if (server)
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    this.rates.clear()
  }
}
