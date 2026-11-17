import {
  nodeActionSchema,
  type RemoteJob,
  remoteActionSchema,
} from '@shared/schemas/nexus-remote'
import {
  connectorSchema,
  type ParserConnector,
  servicesActionSchema,
} from '@shared/schemas/nexus-services'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import { RemoteNodeClient } from '../remote/node-client'
import { realDebridAdapter } from '../remote/real-debrid-adapter'
import type { RemoteJobAdapter } from '../remote/remote-job-adapter'
import { RemoteJobManager } from '../remote/remote-job-manager'
import { mediaUrl, obj, type ParsedMedia, str } from './domestic-parsers'

const clientId = 'X245A4XAIBGVM' // Real-Debrid documented open-source device client.
const base = 'https://api.real-debrid.com'
const readField = (value: unknown, field: string): unknown =>
  field.split('.').reduce<unknown>((v, k) => obj(v)[k], value)
export class ServiceConnectors {
  readonly nodes: RemoteNodeClient
  readonly remote: RemoteJobManager
  private remoteAdapters = new Map<string, RemoteJobAdapter>()
  private resolver?: (key: string) => RemoteJobAdapter
  setRemoteResolver(resolver: (key: string) => RemoteJobAdapter) {
    this.resolver = resolver
  }
  registerRemote(key: string, adapter: RemoteJobAdapter) {
    this.remoteAdapters.set(key, adapter)
  }
  private connectors: ParserConnector[] = []
  private device?: {
    code: string
    userCode: string
    url: string
    expires: number
    next: number
    interval: number
  }
  constructor(
    private deps: {
      broker: CredentialBroker
      changed(): void
      fetcher?: typeof fetch
      assertDisk(directory: string): void
      processRemote?(job: RemoteJob): Promise<boolean>
      profiles?: import('../speed-profiles').SpeedProfiles
    }
  ) {
    this.nodes = new RemoteNodeClient(deps.broker, deps.changed, deps.fetcher)
    this.remote = new RemoteJobManager({
      ...deps,
      adapter: (key) => {
        const adapter = key.startsWith('node:')
          ? this.nodes.adapter(key.slice(5))
          : (this.remoteAdapters.get(key) ?? this.resolver?.(key))
        if (!adapter) throw new Error('remote.authorization')
        return adapter
      },
      process: (job) => deps.processRemote?.(job) ?? Promise.resolve(false),
    })
    this.registerRemote(
      'real-debrid',
      realDebridAdapter((...args) => this.api(...args), deps.fetcher)
    )
  }
  async load() {
    await this.nodes.load()
    await this.remote.load()
    this.connectors = z
      .array(connectorSchema)
      .parse(JSON.parse(this.deps.broker.get('parser-connectors') || '[]'))
  }
  snapshot() {
    return {
      nodes: this.nodes.snapshot(),
      remoteJobs: this.remote.snapshot(),
      connectors: this.connectors,
      realDebrid: {
        authorized: !!this.deps.broker.get('rd-token'),
        untested: true,
        device: this.device
          ? {
              userCode: this.device.userCode,
              url: this.device.url,
              expires: this.device.expires,
            }
          : null,
      },
    }
  }
  async parse(address: string): Promise<ParsedMedia | null> {
    const url = new URL(mediaUrl(address))
    const connector = this.connectors.find((c) =>
      c.platforms.some(
        (p) => url.hostname === p || url.hostname.endsWith(`.${p}`)
      )
    )
    if (!connector) return null
    const endpoint = new URL(connector.endpoint)
    const headers: Record<string, string> = { Accept: 'application/json' }
    const key = this.deps.broker.get(`connector-key-${connector.id}`)
    if (key) headers.Authorization = `Bearer ${key}`
    let body: string | undefined
    if (connector.method === 'GET')
      endpoint.searchParams.set(connector.inputField, address)
    else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({ [connector.inputField]: address })
    }
    const data = await this.json(endpoint.href, {
      method: connector.method,
      headers,
      body,
    })
    const result = readField(data, connector.resultField)
    const urls = Array.isArray(result) ? result : [result]
    if (urls.length > 500) throw new Error('media.invalid')
    return {
      platform: 'external',
      title: str(readField(data, connector.titleField)) || url.hostname,
      assets: urls.map((value, i) => ({
        id: String(i),
        url: mediaUrl(value),
        kind: 'video',
        label: connector.name,
        format: 'mp4',
        bytes: null,
        entry: String(i + 1),
        headers: {},
      })),
    }
  }
  private async json(url: string, init: RequestInit = {}) {
    const response = await (this.deps.fetcher ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok)
      throw new Error(
        response.status === 401 ? 'services.authorization' : 'services.network'
      )
    if (response.status === 204) return {}
    const text = await response.text()
    if (text.length > 4 * 1024 ** 2) throw new Error('services.invalid')
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? { items: parsed } : obj(parsed)
  }
  private async token() {
    const data = obj(JSON.parse(this.deps.broker.get('rd-token') || '{}'))
    if (!data.access_token) throw new Error('services.authorization')
    if (Number(data.expiresAt) > Date.now() + 60000)
      return str(data.access_token)
    const credentials = obj(
      JSON.parse(this.deps.broker.get('rd-client') || '{}')
    )
    const next = await this.json(`${base}/oauth/v2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: str(credentials.client_id),
        client_secret: str(credentials.client_secret),
        code: str(data.refresh_token),
        grant_type: 'http://oauth.net/grant_type/device/1.0',
      }),
    })
    await this.saveToken(next)
    return str(next.access_token)
  }
  private async saveToken(data: Record<string, unknown>) {
    if (!str(data.access_token) || !str(data.refresh_token))
      throw new Error('services.invalid')
    await this.deps.broker.update('rd-token', () =>
      JSON.stringify({
        ...data,
        expiresAt: Date.now() + Number(data.expires_in) * 1000,
      })
    )
    this.deps.changed()
  }
  private async api(
    route: string,
    method = 'GET',
    data?: Record<string, string>
  ) {
    return this.json(`${base}/rest/1.0/${route}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}` },
      body: data ? new URLSearchParams(data) : undefined,
    })
  }
  async action(raw: unknown): Promise<unknown> {
    if (nodeActionSchema.safeParse(raw).success) {
      await this.nodes.action(raw)
      return this.snapshot()
    }
    const remoteRequest = remoteActionSchema.safeParse(raw)
    if (remoteRequest.success) {
      const req = remoteRequest.data
      if (req.action === 'remote-submit') {
        const { action: _action, ...input } = req
        return { id: await this.remote.submit(input) }
      }
      if (req.action === 'remote-retrieve') await this.remote.retrieve(req.id)
      else await this.remote.run(req.id)
      return this.snapshot()
    }
    const req = servicesActionSchema.parse(raw)
    if (req.action === 'connector-save') {
      this.connectors = this.connectors.filter((c) => c.id !== req.connector.id)
      this.connectors.push(req.connector)
      await this.deps.broker.update('parser-connectors', () =>
        JSON.stringify(this.connectors)
      )
      if (req.key !== undefined)
        await this.deps.broker.update(
          `connector-key-${req.connector.id}`,
          () => req.key ?? ''
        )
    } else if (req.action === 'connector-remove') {
      this.connectors = this.connectors.filter((c) => c.id !== req.id)
      await this.deps.broker.update('parser-connectors', () =>
        JSON.stringify(this.connectors)
      )
      await this.deps.broker.remove(`connector-key-${req.id}`)
    } else if (req.action === 'rd-authorize') {
      const data = await this.json(
        `${base}/oauth/v2/device/code?client_id=${clientId}&new_credentials=yes`
      )
      const url = new URL(str(data.verification_url))
      if (
        url.protocol !== 'https:' ||
        !['real-debrid.com', 'www.real-debrid.com'].includes(url.hostname)
      )
        throw new Error('services.invalid')
      this.device = {
        code: str(data.device_code),
        userCode: str(data.user_code),
        url: url.href,
        expires: Date.now() + Number(data.expires_in) * 1000,
        next: 0,
        interval: Math.max(5, Number(data.interval) || 5) * 1000,
      }
    } else if (req.action === 'rd-poll') {
      const device = this.device
      if (!device || device.expires < Date.now())
        throw new Error('services.expired')
      if (Date.now() < device.next) return this.snapshot()
      device.next = Date.now() + device.interval
      const credentials = await this.json(
        `${base}/oauth/v2/device/credentials?client_id=${clientId}&code=${encodeURIComponent(device.code)}`
      )
      if (!str(credentials.client_secret)) return this.snapshot()
      const data = await this.json(`${base}/oauth/v2/token`, {
        method: 'POST',
        body: new URLSearchParams({
          client_id: str(credentials.client_id),
          client_secret: str(credentials.client_secret),
          code: device.code,
          grant_type: 'http://oauth.net/grant_type/device/1.0',
        }),
      })
      await this.deps.broker.update('rd-client', () =>
        JSON.stringify(credentials)
      )
      await this.saveToken(data)
      this.device = undefined
    } else if (req.action === 'rd-logout') {
      await this.deps.broker.remove('rd-token')
      await this.deps.broker.remove('rd-client')
      this.device = undefined
    } else throw new Error('remote.legacy')
    this.deps.changed()
    return this.snapshot()
  }
}
