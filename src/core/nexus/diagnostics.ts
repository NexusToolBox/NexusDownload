import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { NEXUS_VERSION } from '@shared/nexus-version'
import { z } from 'zod'
import { cloudRequestRecordSchema } from './cloud/request-diagnostics'

const modules = ['workspace', 'transfer', 'network-mark', 'cloud'] as const
const recordSchema = z
  .object({
    at: z.number().int(),
    module: z.enum(modules),
    event: z.enum([
      'snapshot',
      'completed',
      'marked',
      'failed',
      'policy-skipped',
      'unsupported',
      'disabled',
      'request',
      'login',
    ]),
    data: z
      .object({
        inboxCount: z.number().int().nonnegative().optional(),
        taskCount: z.number().int().nonnegative().optional(),
        fileCount: z.number().int().nonnegative().optional(),
        enabled: z.boolean().optional(),
        request: cloudRequestRecordSchema.optional(),
        login: z
          .object({
            platform: z.string().max(16),
            step: z.enum(['page', 'cookie', 'token', 'validate']),
            reason: z.enum(['page', 'cookie', 'token', 'validate']),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()
export type DiagnosticRecord = z.input<typeof recordSchema>
export class NexusDiagnostics {
  private writes: Promise<unknown> = Promise.resolve()
  private buckets = new Map<string, { second: number; count: number }>()
  constructor(
    private options: {
      directory: string
      enabled: () => boolean
      maxBytes?: number
    }
  ) {}
  record(
    module: DiagnosticRecord['module'],
    event: DiagnosticRecord['event'],
    data: DiagnosticRecord['data'] = {}
  ): Promise<void> {
    if (!this.options.enabled()) return Promise.resolve()
    const parsed = recordSchema.safeParse({
      at: Date.now(),
      module,
      event,
      data,
    })
    if (!parsed.success) return Promise.resolve()
    const second = Math.floor(Date.now() / 1000)
    const bucket = this.buckets.get(module)
    if (module !== 'cloud' && bucket?.second === second && bucket.count >= 10)
      return Promise.resolve()
    this.buckets.set(module, {
      second,
      count: bucket?.second === second ? bucket.count + 1 : 1,
    })
    const line = `${JSON.stringify(parsed.data)}\n`
    const operation = this.writes
      .catch(() => undefined)
      .then(async () => {
        if (!this.options.enabled()) return
        await mkdir(this.options.directory, { recursive: true })
        const file = path.join(this.options.directory, `${module}.jsonl`)
        const size = await stat(file)
          .then((value) => value.size)
          .catch(() => 0)
        if (
          size + Buffer.byteLength(line) >
          (this.options.maxBytes ?? 256 * 1024)
        ) {
          await rm(`${file}.3`, { force: true })
          for (let i = 2; i >= 1; i--)
            await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(
              () => undefined
            )
          await rename(file, `${file}.1`).catch(() => undefined)
        }
        await appendFile(file, line, { encoding: 'utf8', mode: 0o600 })
      })
    this.writes = operation
    return operation.catch(() => undefined)
  }
  private async files(): Promise<string[]> {
    const names = await readdir(this.options.directory).catch(() => [])
    return names.filter((name) =>
      /^(workspace|transfer|network-mark|cloud)\.jsonl(?:\.[123])?$/.test(name)
    )
  }
  async status(): Promise<{ files: number; bytes: number }> {
    await this.drain()
    const names = await this.files()
    const sizes = await Promise.all(
      names.map((name) =>
        stat(path.join(this.options.directory, name))
          .then((value) => value.size)
          .catch(() => 0)
      )
    )
    return {
      files: names.length,
      bytes: sizes.reduce((sum, size) => sum + size, 0),
    }
  }
  async bundle(): Promise<Buffer> {
    await this.writes.catch(() => undefined)
    const records: z.output<typeof recordSchema>[] = []
    for (const file of await this.files()) {
      const content = await readFile(
        path.join(this.options.directory, file),
        'utf8'
      )
      for (const line of content.split('\n')) {
        try {
          const parsed = recordSchema.safeParse(JSON.parse(line))
          if (parsed.success) records.push(parsed.data)
        } catch {
          /* Invalid or injected records are excluded at export as well. */
        }
      }
    }
    records.sort((a, b) => a.at - b.at)
    return gzipSync(
      JSON.stringify(
        {
          product: 'NexusDownload',
          version: NEXUS_VERSION,
          exportedAt: new Date().toISOString(),
          records,
        },
        null,
        2
      )
    )
  }
  async drain(): Promise<void> {
    await this.writes.catch(() => undefined)
  }
}
