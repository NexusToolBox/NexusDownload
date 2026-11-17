import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import type {
  TaskCreateCommandResult,
  TaskCreateRequest,
} from '@shared/schemas/add-task'
import {
  nodeSubmitSchema,
  remoteFileSchema,
} from '@shared/schemas/nexus-remote'
import type { DownloadTask } from '@shared/types/task'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { fileSha256 } from '../tools/tool-manager'

const recordSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  directory: z.string(),
  maxBytes: z.number(),
  intent: z.boolean(),
  taskId: z.string().optional(),
  cleaned: z.boolean().default(false),
  cleanupFiles: z.array(z.string()).optional(),
})
type Record = z.infer<typeof recordSchema>
/** Dedicated directories and durable submit intents bind every file to one paired client. */
export class RemoteNodeHost {
  private jobs: Record[] = []
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private deps: {
      file: string
      root: string
      create(req: TaskCreateRequest): Promise<TaskCreateCommandResult>
      pause(id: string): Promise<unknown>
      tasks(): DownloadTask[]
      files(id: string): string[]
      authorize(directory: string): Promise<unknown>
    }
  ) {}
  async load() {
    try {
      this.jobs = z
        .array(recordSchema)
        .parse(JSON.parse(await readFile(this.deps.file, 'utf8')))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  private async save() {
    await mkdir(path.dirname(this.deps.file), { recursive: true })
    await writeFileAtomic(this.deps.file, JSON.stringify(this.jobs), {
      mode: 0o600,
    })
  }
  private get(owner: string, id: string) {
    const job = this.jobs.find((j) => j.id === id && j.owner === owner)
    if (!job) throw new Error('remote.missing')
    return job
  }
  async submit(owner: string, raw: unknown) {
    const req = nodeSubmitSchema.parse(raw)
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const old = this.jobs.find((j) => j.id === req.id)
        if (old) {
          if (old.owner !== owner) throw new Error('remote.missing')
          return { id: old.id }
        }
        const u = new URL(req.source)
        if (
          !['magnet:', 'http:', 'https:'].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw new Error('remote.invalid')
        const root = await realpath(this.deps.root)
        const directory = path.join(root, `NexusDownload-${req.id}`)
        await this.deps.authorize(root)
        await mkdir(directory, { recursive: true })
        await this.deps.authorize(directory)
        if ((await realpath(directory)) !== directory)
          throw new Error('remote.path')
        const job: Record = {
          id: req.id,
          owner,
          directory,
          maxBytes: req.maxBytes,
          intent: true,
          cleaned: false,
        }
        this.jobs.push(job)
        await this.save()
        const result = await this.deps.create(
          u.protocol === 'magnet:'
            ? {
                type: 'bt',
                payload: { kind: 'magnet', uri: req.source },
                saveDir: directory,
                selectedFiles: [],
                downloadAll: true,
                seedRatio: 0,
              }
            : {
                type: 'http',
                requestId: req.id,
                uris: [req.source],
                saveDir: directory,
                headers: [],
              }
        )
        if (result.outcome !== 'created') throw new Error('remote.failed')
        job.taskId = result.taskId
        await this.save()
        return { id: job.id }
      })
    this.queue = operation
    return operation
  }
  private task(job: Record) {
    const task =
      this.deps.tasks().find((t) => t.id === job.taskId) ||
      this.deps.tasks().find((t) => t.saveDir === job.directory)
    if (!task) throw new Error('remote.uncertain')
    return task
  }
  async status(owner: string, id: string) {
    const job = this.get(owner, id)
    if (job.cleaned) return { id, ready: false, progress: 100, cleaned: true }
    const task = this.task(job)
    if (Math.max(task.totalBytes, task.downloadedBytes) > job.maxBytes) {
      if (['downloading', 'queued', 'fetching_metadata'].includes(task.status))
        await this.deps.pause(task.id)
      throw new Error('remote.budget')
    }
    if (task.status === 'error') throw new Error('remote.failed')
    return {
      id,
      ready: ['completed', 'seeding'].includes(task.status),
      progress: task.progress,
    }
  }
  async tick() {
    // Enforce the declared budget even while the desktop is disconnected.
    await Promise.allSettled(
      this.jobs.filter((j) => !j.cleaned).map((j) => this.status(j.owner, j.id))
    )
  }
  private async path(job: Record, file: string) {
    await this.deps.authorize(job.directory)
    const canonical = await realpath(file)
    const relative = path.relative(job.directory, canonical)
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative) ||
      (await lstat(file)).isSymbolicLink()
    )
      throw new Error('remote.path')
    return canonical
  }
  private async entries(job: Record) {
    const task = this.task(job)
    const files = this.deps.files(task.id)
    const candidates =
      task.type === 'http' && task.finalPath ? [task.finalPath] : files
    const result = []
    for (const file of [...new Set(candidates)]) {
      const canonical = await this.path(job, file)
      const stat = await lstat(canonical)
      if (!stat.isFile()) throw new Error('remote.path')
      const id = createHash('sha256')
        .update(path.relative(job.directory, canonical))
        .digest('hex')
      result.push({
        id,
        canonical,
        bytes: stat.size,
        name: path.relative(job.directory, canonical),
      })
    }
    if (
      !result.length ||
      result.reduce((n, f) => n + f.bytes, 0) > job.maxBytes
    )
      throw new Error('remote.budget')
    return result
  }
  async list(owner: string, id: string) {
    const job = this.get(owner, id)
    if (!(await this.status(owner, id)).ready) throw new Error('remote.waiting')
    return Promise.all(
      (await this.entries(job)).map(async (f) =>
        remoteFileSchema.parse({
          id: f.id,
          name: f.name,
          bytes: f.bytes,
          hash: `sha256:${await fileSha256(f.canonical)}`,
        })
      )
    )
  }
  async file(owner: string, id: string, fileId: string) {
    const job = this.get(owner, id)
    if (!(await this.status(owner, id)).ready) throw new Error('remote.waiting')
    const entry = (await this.entries(job)).find((f) => f.id === fileId)
    if (!entry) throw new Error('remote.missing')
    const hash = await fileSha256(entry.canonical)
    return {
      ...entry,
      etag: `"${hash}"`,
      stream: (start: number, end: number) =>
        createReadStream(entry.canonical, { start, end }),
    }
  }
  async cleanup(owner: string, id: string) {
    const job = this.get(owner, id)
    if (job.cleaned) return
    if (!(await this.status(owner, id)).ready) throw new Error('remote.waiting')
    if (this.task(job).status === 'seeding') throw new Error('remote.seeding')
    if (!job.cleanupFiles) {
      job.cleanupFiles = (await this.entries(job)).map((f) => f.canonical)
      await this.save()
    }
    for (const file of [...job.cleanupFiles]) {
      try {
        await unlink(await this.path(job, file))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      job.cleanupFiles = job.cleanupFiles.filter((f) => f !== file)
      await this.save()
    }
    job.cleaned = true
    await this.save()
  }
}
