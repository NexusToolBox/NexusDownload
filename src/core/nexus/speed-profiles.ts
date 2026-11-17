import {
  type SpeedKey,
  type SpeedProfile,
  speedKeySchema,
} from '@shared/schemas/nexus-speed'
import type { DownloadTask } from '@shared/types/task'
import { z } from 'zod'
import type { CredentialBroker } from './cloud/credential-broker'

const rowSchema = speedKeySchema.extend({
  bytes: z.number().nonnegative(),
  ms: z.number().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  updatedAt: z.number(),
})
const sampleSchema = z.object({
  key: speedKeySchema,
  lastBytes: z.number(),
  lastAt: z.number(),
  lastStatus: z.string(),
  bytes: z.number().nonnegative(),
  ms: z.number().nonnegative(),
  terminal: z.boolean(),
})
const stateSchema = z.object({
  rows: z.array(rowSchema),
  samples: z.record(z.string(), sampleSchema),
})
const identity = (key: SpeedKey) =>
  JSON.stringify([key.platform, key.accountId, key.method])

/** Throughput is weighted by active transfer time, excluding pauses and process downtime. */
export class SpeedProfiles {
  private state: z.infer<typeof stateSchema> = { rows: [], samples: {} }
  private savedAt = 0
  private readable = true
  constructor(
    private broker: CredentialBroker,
    private changed: () => void
  ) {}
  load() {
    const raw = this.broker.get('speed-profiles')
    try {
      if (raw) this.state = stateSchema.parse(JSON.parse(raw))
    } catch {
      this.readable = false
      return
    } // Preserve damaged optional statistics; downloads remain available.
    for (const sample of Object.values(this.state.samples)) sample.lastAt = 0
  }
  async begin(id: string, key: SpeedKey, now = Date.now()) {
    if (!this.readable) return
    if (this.state.samples[id]) return
    this.state.samples[id] = {
      key: speedKeySchema.parse(key),
      lastBytes: 0,
      lastAt: now,
      lastStatus: 'paused',
      bytes: 0,
      ms: 0,
      terminal: false,
    }
    await this.save(now)
  }
  snapshot(): SpeedProfile[] {
    return this.state.rows.map(({ bytes, ms, success, failed, ...key }) => ({
      ...key,
      averageBps: ms >= 1000 && bytes > 0 ? bytes / (ms / 1000) : null,
      successRate: success + failed > 0 ? success / (success + failed) : null,
      attempts: success + failed,
    }))
  }
  estimate(key: SpeedKey, bytes: number, unknown: number) {
    const profile = this.snapshot().find((r) => identity(r) === identity(key))
    return {
      profile: profile ?? null,
      seconds:
        unknown === 0 && profile?.averageBps
          ? Math.ceil(bytes / profile.averageBps)
          : null,
    }
  }
  async observe(
    tasks: Pick<DownloadTask, 'id' | 'status' | 'downloadedBytes'>[],
    now = Date.now()
  ) {
    if (!this.readable) return
    let terminalChanged = false
    const byId = new Map(tasks.map((t) => [t.id, t]))
    for (const [id, sample] of Object.entries(this.state.samples)) {
      const task = byId.get(id)
      if (!task || task.status === 'removed') {
        delete this.state.samples[id]
        continue
      }
      const active = task.status === 'downloading'
      if (sample.terminal && !active) continue
      if (sample.terminal) {
        sample.terminal = false
        sample.bytes = 0
        sample.ms = 0
        sample.lastAt = 0
      }
      const dt = now - sample.lastAt
      if (
        sample.lastAt > 0 &&
        dt > 0 &&
        dt <= 5000 &&
        sample.lastStatus === 'downloading' &&
        (active || task.status === 'completed')
      ) {
        sample.bytes += Math.max(0, task.downloadedBytes - sample.lastBytes)
        sample.ms += dt
      }
      sample.lastAt = now
      sample.lastBytes = task.downloadedBytes
      sample.lastStatus = task.status
      if (task.status === 'completed' || task.status === 'error') {
        let row = this.state.rows.find(
          (r) => identity(r) === identity(sample.key)
        )
        if (!row) {
          row = {
            ...sample.key,
            bytes: 0,
            ms: 0,
            success: 0,
            failed: 0,
            updatedAt: now,
          }
          this.state.rows.push(row)
        }
        if (sample.ms >= 1000) {
          row.bytes += sample.bytes
          row.ms += sample.ms
        }
        if (task.status === 'completed') row.success++
        else row.failed++
        row.updatedAt = now
        sample.terminal = true
        terminalChanged = true
      }
    }
    if (terminalChanged || now - this.savedAt >= 10000) await this.save(now)
  }
  async save(now = Date.now()) {
    if (!this.readable) return
    await this.broker.update('speed-profiles', () => JSON.stringify(this.state))
    this.savedAt = now
    this.changed()
  }
}
