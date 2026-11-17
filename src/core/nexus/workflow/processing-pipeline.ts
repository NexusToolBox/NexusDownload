import { lstat } from 'node:fs/promises'
import {
  type ProcessingRecord,
  processingActionSchema,
  processingConfigSchema,
  processingRecordSchema,
  processingSteps,
} from '@shared/schemas/nexus-processing'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import { fileSha256 } from '../tools/tool-manager'
import {
  type ArchiveService,
  filenamePasswords,
  passwordCandidates,
  regularFiles,
} from './archive-service'
import type { PackageManager } from './package-manager'
import type { WorkflowTask } from './queue-manager'
export class ProcessingPipeline {
  private records: ProcessingRecord[] = []
  private history = new Set<string>()
  private restored = false
  private busy = false
  constructor(
    private deps: {
      broker: CredentialBroker
      tasks(): WorkflowTask[]
      packages(): PackageManager
      archive: ArchiveService
      changed(): void
      scan(files: string[]): Promise<string>
      mark(files: string[], ids: string[]): Promise<string>
      organize(
        record: ProcessingRecord,
        checkpoint: () => Promise<void>
      ): Promise<string[]>
      notify(record: ProcessingRecord): Promise<void>
      prepare?(record: ProcessingRecord): Promise<void>
      expected?(id: string): { expectedBytes?: number; sha256?: string }
    }
  ) {}
  async load() {
    const history = this.deps.broker.get('processing-history')
    this.history = new Set(
      history ? z.array(z.string()).parse(JSON.parse(history)) : []
    )
    this.records = z
      .array(processingRecordSchema)
      .parse(JSON.parse(this.deps.broker.get('processing-records') || '[]'))
    for (const r of this.records)
      for (const s of r.steps)
        if (s.status === 'running') {
          s.status = 'failed'
          s.reason = 'processing.interrupted'
        }
  }
  /** First-upgrade history is sampled only after the engine restores its tasks. */
  async afterRestore() {
    if (!this.deps.broker.get('processing-history')) {
      this.history = new Set(
        this.deps
          .tasks()
          .filter((t) => ['completed', 'seeding'].includes(t.status))
          .filter((t) => !this.records.some((r) => r.taskIds.includes(t.id)))
          .map((t) => t.id)
      )
      await this.deps.broker.update('processing-history', () =>
        JSON.stringify([...this.history])
      )
    }
    this.restored = true
  }
  snapshot() {
    return {
      processing: structuredClone(this.records),
      passwordCount: this.passwords().length,
    }
  }
  private passwords() {
    return z
      .array(z.string())
      .parse(JSON.parse(this.deps.broker.get('password-book') || '[]'))
  }
  private async save() {
    await this.deps.broker.update('processing-records', () =>
      JSON.stringify(this.records)
    )
    this.deps.changed()
  }
  settled(id: string) {
    const record = this.records.find((r) => r.taskIds.includes(id))
    if (record)
      return record.steps.every(
        (s) => s.status === 'done' || s.status === 'skipped'
      )
    return this.history.has(id)
  }
  private ensure(
    id: string,
    name: string,
    taskIds: string[],
    directory: string,
    files: string[],
    config: ProcessingRecord['config']
  ) {
    let record = this.records.find((r) => r.id === id)
    if (!record) {
      record = processingRecordSchema.parse({
        id,
        name,
        taskIds,
        directory,
        files,
        config,
        steps: processingSteps.map((name) => ({ name, status: 'pending' })),
      })
      this.records.push(record)
    }
    return record
  }
  async configurePackage(pkg: import('./package-manager').DownloadPackage) {
    if (this.busy) throw new Error('processing.busy')
    let record = this.records.find((r) => r.id === pkg.id)
    if (!record) {
      const members = this.deps
        .tasks()
        .filter((t) => pkg.taskIds.includes(t.id))
      if (
        !pkg.extract ||
        members.length !== pkg.taskIds.length ||
        !members.every((t) => ['completed', 'seeding'].includes(t.status))
      )
        return
      record = this.ensure(
        pkg.id,
        pkg.name,
        pkg.taskIds,
        pkg.directory,
        members.flatMap((t) => t.files),
        processingConfigSchema.parse(pkg)
      )
    }
    if (
      pkg.extract &&
      record.steps.find((s) => s.name === 'extract')?.status === 'skipped'
    ) {
      record.files = record.files.map(
        (f) => record.moves.find((m) => m.source === f && m.linked)?.target ?? f
      )
      record.outputs = []
      record.moves = []
      record.extracted = false
      record.archives = []
      for (const step of record.steps.filter((s) => s.name !== 'verify')) {
        step.status = 'pending'
        step.reason = ''
      }
    }
    record.config.extract = pkg.extract
    record.config.trashArchives = pkg.trashArchives
    await this.save()
  }
  async action(raw: unknown) {
    const req = processingActionSchema.parse(raw)
    if (this.busy && req.action !== 'processing-password-book')
      throw new Error('processing.busy')
    if (req.action === 'processing-password-book') {
      await this.deps.broker.update('password-book', () => {
        const previous = this.passwords()
        if (req.keepIndices && req.expectedCount !== previous.length)
          throw new Error('workflow.changed')
        const retained = req.keepIndices
          ? previous.filter((_, index) => req.keepIndices?.includes(index))
          : []
        const next = [...new Set([...retained, ...req.passwords])]
        if (next.length > 200) throw new Error('workflow.invalid')
        return JSON.stringify(next)
      })
    } else {
      let record = this.records.find(
        (r) => r.id === req.id || r.taskIds.includes(req.id)
      )
      if (!record) {
        const task = this.deps.tasks().find((t) => t.id === req.id)
        if (!task) throw new Error('workflow.invalid')
        const pkg = this.deps.packages().packageFor(task.id)
        record = this.ensure(
          pkg?.id ?? task.id,
          pkg?.name ?? task.name,
          pkg?.taskIds ?? [task.id],
          pkg?.directory ?? task.directory,
          task.files,
          processingConfigSchema.parse({})
        )
      }
      if (req.action === 'processing-save') {
        if (record.steps.some((s) => s.status !== 'pending'))
          throw new Error('processing.started')
        record.config = req.config
      } else {
        const step = record.steps.find((s) => s.name === req.step)
        if (step?.status !== 'failed') throw new Error('workflow.invalid')
        if (req.password !== undefined)
          await this.deps.broker.update(
            `package-password-${record.id}`,
            () => req.password ?? ''
          )
        step.status = 'pending'
        step.reason = ''
      }
    }
    await this.save()
    return this.snapshot()
  }
  private async securityFiles(record: ProcessingRecord) {
    const files = [...new Set([...record.files, ...record.outputs])]
    const result: string[] = []
    for (const file of files) {
      const info = await lstat(file).catch(() => null)
      if (info?.isFile() && !info.isSymbolicLink()) {
        result.push(file)
        continue
      }
      if (
        !info &&
        record.config.trashArchives &&
        record.steps.find((s) => s.name === 'extract')?.status === 'done' &&
        record.archives.includes(file)
      )
        continue
      throw new Error('processing.verify')
    }
    if (!result.length) throw new Error('processing.verify')
    return result
  }
  async tick() {
    if (this.busy || !this.restored) return
    this.busy = true
    try {
      const tasks = this.deps.tasks()
      for (const task of tasks) {
        if (
          !['completed', 'seeding'].includes(task.status) ||
          (!this.records.some((r) => r.taskIds.includes(task.id)) &&
            this.history.has(task.id))
        )
          continue
        const pkg = this.deps.packages().packageFor(task.id)
        const members = pkg
          ? tasks.filter((t) => pkg.taskIds.includes(t.id))
          : [task]
        if (
          (pkg && members.length !== pkg.taskIds.length) ||
          !members.every((t) => ['completed', 'seeding'].includes(t.status))
        )
          continue
        const record = this.ensure(
          pkg?.id ?? task.id,
          pkg?.name ?? task.name,
          members.map((t) => t.id),
          pkg?.directory ?? task.directory,
          members.flatMap((t) => t.files),
          processingConfigSchema.parse(
            pkg ?? this.deps.expected?.(task.id) ?? {}
          )
        )
        if (
          record.steps.some((s) => s.status === 'failed') ||
          record.steps.every((s) => ['done', 'skipped'].includes(s.status))
        )
          continue
        if (pkg && record.steps.every((s) => s.status === 'pending')) {
          record.config.extract = pkg.extract
          record.config.trashArchives = pkg.trashArchives
        }
        for (const step of record.steps) {
          if (step.status !== 'pending') continue
          step.status = 'running'
          await this.save()
          try {
            let reason = ''
            if (step.name === 'verify') {
              record.files = [
                ...new Set(
                  (
                    await Promise.all(
                      members.flatMap((t) => t.files).map(regularFiles)
                    )
                  ).flat()
                ),
              ]
              record.taskIds = members.map((t) => t.id)
              if (
                record.config.expectedBytes === undefined &&
                members.every((t) => t.bytes > 0)
              )
                record.config.expectedBytes = members.reduce(
                  (n, t) => n + t.bytes,
                  0
                )
              let size = 0
              for (const file of record.files) {
                const info = await lstat(file)
                if (!info.isFile() || info.isSymbolicLink())
                  throw new Error('processing.verify')
                size += info.size
              }
              if (
                record.config.expectedBytes !== undefined &&
                size !== record.config.expectedBytes
              )
                throw new Error('processing.verify')
              if (
                record.config.sha256 &&
                (record.files.length !== 1 ||
                  (await fileSha256(record.files[0])).toLowerCase() !==
                    record.config.sha256.toLowerCase())
              )
                throw new Error('processing.verify')
              if (
                !record.config.sha256 &&
                record.config.expectedBytes === undefined
              )
                reason = 'processing.noExpected'
              await this.deps.prepare?.(record)
            } else if (step.name === 'extract') {
              if (!record.config.extract) {
                step.status = 'skipped'
                reason = 'processing.notRequested'
              } else {
                if (!record.extracted) {
                  const result = await this.deps.archive.extract(
                    record.files,
                    record.directory,
                    [
                      ...passwordCandidates(
                        pkg?.description ?? '',
                        pkg?.pageText ?? ''
                      ),
                      ...filenamePasswords(record.files),
                      this.deps.broker.get(`package-password-${record.id}`),
                      ...this.passwords(),
                    ].filter(Boolean)
                  )
                  record.outputs = result.files
                  record.archives = result.archives
                  record.extracted = true
                  if (result.password)
                    await this.deps.broker.update(
                      `package-password-${record.id}`,
                      () => result.password
                    )
                  // Persist outputs before recycling; retry never needs the removed volumes.
                  await this.save()
                }
                if (record.config.trashArchives)
                  await this.deps.archive.recycle(record.archives)
              }
            } else if (step.name === 'scan') {
              reason = await this.deps.scan(await this.securityFiles(record))
              if (reason) step.status = 'skipped'
            } else if (step.name === 'mark') {
              reason = await this.deps.mark(
                await this.securityFiles(record),
                record.taskIds
              )
              if (reason) step.status = 'skipped'
            } else if (step.name === 'organize')
              record.outputs = await this.deps.organize(record, () =>
                this.save()
              )
            else await this.deps.notify(record)
            step.reason = reason
            if (step.status === 'running') step.status = 'done'
          } catch (error) {
            step.status = 'failed'
            step.reason =
              error instanceof Error &&
              /^(processing|tools)\.[a-zA-Z0-9-]+$/.test(error.message)
                ? error.message
                : 'processing.failed'
          }
          await this.save()
          if (step.status === 'failed') break
        }
      }
    } finally {
      this.busy = false
    }
  }
  async drain() {
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 100))
    await this.deps.broker.drain()
  }
}
