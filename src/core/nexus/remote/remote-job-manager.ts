import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  type RemoteJob,
  remoteJobSchema,
  remoteSubmitSchema,
} from '@shared/schemas/nexus-remote'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import type { RemoteJobAdapter } from './remote-job-adapter'

export class RemoteJobManager {
  private jobs: RemoteJob[] = []
  private active = new Map<string, Promise<void>>()
  constructor(
    private deps: {
      broker: CredentialBroker
      adapter(key: string): RemoteJobAdapter
      changed(): void
      assertDisk(directory: string): void
      process(job: RemoteJob): Promise<boolean>
      profiles?: import('../speed-profiles').SpeedProfiles
    }
  ) {}
  async load() {
    this.jobs = z
      .array(remoteJobSchema)
      .parse(JSON.parse(this.deps.broker.get('remote-jobs') || '[]'))
  }
  snapshot() {
    return this.jobs.map(({ source: _source, key: _key, ...job }) =>
      structuredClone(job)
    )
  }
  private async save() {
    await this.deps.broker.update('remote-jobs', () =>
      JSON.stringify(this.jobs)
    )
    this.deps.changed()
  }
  async submit(raw: unknown) {
    const input = remoteSubmitSchema.parse(raw)
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          input.adapter,
          input.source,
          path.resolve(input.directory),
        ])
      )
      .digest('hex')
    const existing = this.jobs.find((j) => j.key === key)
    if (existing) return existing.id
    this.deps.assertDisk(input.directory)
    const job = remoteJobSchema.parse({
      ...input,
      id: randomUUID(),
      key,
      createdAt: Date.now(),
    })
    this.jobs.push(job)
    await this.save()
    if (job.adapter.startsWith('115:'))
      await this.deps.profiles?.begin(`remote:${job.id}`, {
        platform: '115',
        accountId: job.adapter.slice(4),
        method: 'offline',
      })
    await this.run(job.id)
    return job.id
  }
  async retrieve(id: string) {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) throw new Error('remote.missing')
    job.remoteOnly = false
    await this.save()
    await this.run(id)
  }
  async tick() {
    for (const job of this.jobs) await this.run(job.id)
  }
  run(id: string): Promise<void> {
    const running = this.active.get(id)
    if (running) return running
    const work = this.advance(id).finally(() => this.active.delete(id))
    this.active.set(id, work)
    return work
  }
  private async advance(id: string) {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) throw new Error('remote.missing')
    try {
      const adapter = this.deps.adapter(job.adapter)
      job.error = undefined
      if (job.phase === 'completed') {
        if (
          !job.cleaned &&
          job.verifiedAt &&
          Date.now() >= job.verifiedAt + job.retainHours * 3600000
        ) {
          await adapter.cleanup(job)
          job.cleaned = true
        }
        await this.save()
        return
      }
      if (!job.remoteId) {
        if (job.intent) {
          const recovered = await adapter.recover(job)
          if (!recovered) throw new Error('remote.uncertain')
          job.remoteId = recovered
        } else {
          // Persist the intent before any remote side effect. A lost response only reconciles.
          job.intent = true
          await this.save()
          job.remoteId = await adapter.submit(job)
        }
        await this.save()
      }
      if (job.phase === 'remote') {
        const state = await adapter.query(job)
        job.progress = Math.max(0, Math.min(100, state.progress))
        job.usage = state.usage
        if (!state.ready) {
          await this.save()
          return
        }
        job.files = await adapter.listFiles(job)
        if (
          !job.files.length ||
          job.files.reduce((n, f) => n + f.bytes, 0) > job.maxBytes
        )
          throw new Error('remote.budget')
        job.phase = 'waiting'
        await this.save()
        // A visible, durable boundary: remote 100% never implies a local file.
        return
      }
      if (job.remoteOnly) return
      if (job.phase === 'waiting' || job.phase === 'retrieving') {
        this.deps.assertDisk(job.directory)
        job.phase = 'retrieving'
        await this.save()
        for (const file of job.files) {
          if (!file.verified)
            await adapter.retrieve(job, file, () => this.save())
          if (!file.verified || !file.localPath)
            throw new Error('remote.integrity')
          await this.save()
        }
        job.phase = 'processing'
        await this.save()
      }
      if (job.phase === 'processing' && (await this.deps.process(job))) {
        job.phase = 'completed'
        job.verifiedAt = Date.now()
      }
      await this.save()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      // Never surface response bodies, source URLs or authentication material.
      job.error = /^(?:remote|cloud)\.[a-z-]+$/.test(message)
        ? message
        : 'remote.network'
      await this.save()
    }
  }
}
