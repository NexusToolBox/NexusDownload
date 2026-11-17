import {
  nodeActionSchema,
  type RemoteNode,
  remoteFileSchema,
  remoteNodeSchema,
} from '@shared/schemas/nexus-remote'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import type { RemoteJobAdapter } from './remote-job-adapter'
import { retrieveRemoteFile } from './retrieve-file'

export class RemoteNodeClient {
  private nodes: RemoteNode[] = []
  private pending = new Map<
    string,
    {
      requestId: string
      userCode: string
      expiresAt: number
      next: number
      interval: number
    }
  >()
  constructor(
    private broker: CredentialBroker,
    private changed: () => void,
    private fetcher: typeof fetch = fetch
  ) {}
  async load() {
    this.nodes = z
      .array(remoteNodeSchema)
      .parse(JSON.parse(this.broker.get('remote-nodes') || '[]'))
  }
  snapshot() {
    return this.nodes.map((n) => ({
      ...n,
      paired: !!this.broker.get(`node-${n.id}`),
      pairing: this.pending.has(n.id)
        ? {
            userCode: this.pending.get(n.id)!.userCode,
            expiresAt: this.pending.get(n.id)!.expiresAt,
          }
        : null,
    }))
  }
  private async save() {
    await this.broker.update('remote-nodes', () => JSON.stringify(this.nodes))
    this.changed()
  }
  private async json(url: string, body?: unknown, token?: string) {
    const response = await this.fetcher(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
    const text = await response.text()
    if (text.length > 4 * 1024 ** 2) throw new Error('remote.invalid')
    const data = JSON.parse(text)
    if (data.error)
      throw new Error(
        /^remote\.[a-z-]+$/.test(data.error) ? data.error : 'remote.failed'
      )
    if (!response.ok)
      throw new Error(
        response.status === 401 ? 'remote.authorization' : 'remote.network'
      )
    return data
  }
  async action(raw: unknown) {
    const req = nodeActionSchema.parse(raw)
    if (req.action === 'node-pair') {
      const existing = this.nodes.find((n) => n.id === req.node.id)
      if (
        existing &&
        (existing.url !== req.node.url ||
          existing.bridgeUrl !== req.node.bridgeUrl)
      )
        throw new Error('remote.identity')
      const data = z
        .object({
          requestId: z.string(),
          userCode: z.string(),
          expiresAt: z.number(),
          interval: z.number().optional(),
        })
        .parse(
          await this.json(
            `${req.node.bridgeUrl.replace(/\/$/, '')}/mdxp/pair/request`,
            {
              clientName: 'NexusDownload desktop',
              clientVersion: '0.5.0',
              deviceId: req.node.id.replace(/-/g, ''),
            }
          )
        )
      if (!existing) this.nodes.push(req.node)
      this.pending.set(req.node.id, {
        ...data,
        next: Date.now() + Math.max(5, data.interval ?? 5) * 1000,
        interval: Math.max(5, data.interval ?? 5) * 1000,
      })
      await this.save()
    } else if (req.action === 'node-poll') {
      const node = this.nodes.find((n) => n.id === req.id)
      const p = this.pending.get(req.id)
      if (!node || !p || p.expiresAt < Date.now())
        throw new Error('remote.expired')
      if (Date.now() < p.next) return
      p.next = Date.now() + p.interval
      const data = await this.json(
        `${node.bridgeUrl.replace(/\/$/, '')}/mdxp/pair/poll`,
        { requestId: p.requestId }
      )
      if (data.status === 'approved') {
        const token = z.string().min(16).max(4096).parse(data.token)
        await this.broker.update(`node-${node.id}`, () => token)
        this.pending.delete(req.id)
        await this.save()
      } else if (data.status !== 'pending')
        throw new Error('remote.authorization')
    } else {
      this.nodes = this.nodes.filter((n) => n.id !== req.id)
      this.pending.delete(req.id)
      await this.broker.remove(`node-${req.id}`)
      await this.save()
    }
  }
  adapter(id: string): RemoteJobAdapter {
    const node = this.nodes.find((n) => n.id === id)
    if (!node) throw new Error('remote.authorization')
    const token = () => {
      const value = this.broker.get(`node-${id}`)
      if (!value) throw new Error('remote.authorization')
      return value
    }
    const url = (route: string) =>
      `${node.url.replace(/\/$/, '')}/nexus/v05/${route}`
    const call = (route: string, body?: unknown) =>
      this.json(url(route), body, token())
    return {
      submit: async (job) => {
        const data = await call('jobs', {
          id: job.id,
          source: job.source,
          maxBytes: job.maxBytes,
        })
        return z.string().uuid().parse(data.id)
      },
      recover: async (job) => {
        const data = await call(`jobs/${job.id}`)
        return data.id === job.id ? job.id : null
      },
      query: async (job) => {
        const data = await call(`jobs/${job.remoteId}`)
        return { ready: !!data.ready, progress: Number(data.progress) || 0 }
      },
      listFiles: async (job) =>
        z
          .array(remoteFileSchema)
          .parse((await call(`jobs/${job.remoteId}/files`)).files),
      retrieve: async (job, file, checkpoint) =>
        retrieveRemoteFile(
          job,
          file,
          async () => ({
            url: url(
              `jobs/${job.remoteId}/files/${encodeURIComponent(file.id)}`
            ),
            headers: { Authorization: `Bearer ${token()}` },
          }),
          checkpoint,
          this.fetcher
        ),
      cleanup: async (job) => {
        await call(`jobs/${job.remoteId}/cleanup`, {})
      },
    }
  }
}
