import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError, ErrorCode } from '@shared/errors'
import type {
  TaskCreateCommandResult,
  TaskCreateRequest,
} from '@shared/schemas/add-task'
import {
  type NexusPreflight,
  type NexusSnapshot,
  type NexusState,
  nexusCollectRequestSchema,
  nexusPreferencesSchema,
  nexusPreflightRequestSchema,
  nexusStateSchema,
} from '@shared/schemas/nexus-workspace'
import type { DownloadTask } from '@shared/types/task'
import writeFileAtomic from 'write-file-atomic'
import { classifiedDirectory } from './classification'
import { getNexusDiskSpace } from './disk-space'
import { duplicateTask, normalizedSourceIdentity } from './duplicate-download'
import { type HttpPreflightResult, probeHttp } from './http-preflight'
import { recognizeSources } from './source-recognizer'

export class NexusWorkspace {
  private state: NexusState = nexusStateSchema.parse({
    version: 1,
    preferences: {},
    inbox: [],
    accounts: [],
    bindings: [],
    packages: [],
    routes: [
      {
        id: 'local',
        resolver: 'direct',
        linkMethod: 'direct',
        refresh: 'none',
        executor: 'local',
        exitRequirement: 'any',
        repatriation: 'none',
        cleanup: 'none',
      },
    ],
  })
  private inputs = new Map<string, string>()
  private probes = new Map<string, HttpPreflightResult>()
  private writes: Promise<unknown> = Promise.resolve()
  private creating = new Map<string, Promise<TaskCreateCommandResult>>()
  private shortcutRegistered: boolean | null = null
  constructor(
    private options: {
      file: string
      defaultDirectory: () => string
      changed: () => void
      fetch?: typeof fetch
      tasks?: () => DownloadTask[]
    }
  ) {}
  async load(): Promise<void> {
    try {
      const parsed = nexusStateSchema.safeParse(
        JSON.parse(await readFile(this.options.file, 'utf8'))
      )
      if (parsed.success) this.state = parsed.data
    } catch {
      /* An absent or invalid feature file uses safe schema defaults. */
    }
  }
  getPreferences() {
    return structuredClone(this.state.preferences)
  }
  async setNetworkMark(
    taskId: string,
    status: NexusState['networkMarks'][string]
  ): Promise<void> {
    if (this.state.networkMarks[taskId] === status) return
    this.state.networkMarks[taskId] = status
    await this.persist()
  }
  snapshot(): NexusSnapshot {
    return {
      ...structuredClone(this.state),
      availableInputIds: [...this.inputs.keys()],
      shortcutRegistered: this.shortcutRegistered,
    }
  }
  setShortcutRegistered(value: boolean | null) {
    if (value === this.shortcutRegistered) return
    this.shortcutRegistered = value
    this.options.changed()
  }
  private async persist(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2)
    const operation = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.options.file), { recursive: true })
        await writeFileAtomic(this.options.file, data, {
          encoding: 'utf8',
          mode: 0o600,
        })
      })
    this.writes = operation
    await operation
    this.options.changed()
  }
  async updatePreferences(raw: unknown): Promise<NexusSnapshot> {
    const parsed = nexusPreferencesSchema.partial().parse(raw)
    const patch = Object.fromEntries(
      Object.entries(parsed).filter(([key]) =>
        Object.hasOwn(raw as object, key)
      )
    )
    this.state.preferences = nexusPreferencesSchema.parse({
      ...this.state.preferences,
      ...patch,
    })
    await this.persist()
    return this.snapshot()
  }
  async collect(raw: unknown): Promise<NexusPreflight | null> {
    const request = nexusCollectRequestSchema.parse(raw)
    const ids: string[] = []
    const sources = recognizeSources(request.input)
    for (const source of sources) {
      const existing = this.state.inbox.find(
        (entry) => entry.source.identity === source.entry.source.identity
      )
      const entry = existing ?? source.entry
      if (!existing) {
        if (this.state.inbox.length >= 500) break
        this.state.inbox.push(entry)
      }
      const code =
        sources.length === 1 &&
        ['baidu', 'quark', 'uc'].includes(entry.source.platform)
          ? request.input.match(
              /(?:提取码|提取碼|访问码|密码|密碼)\s*[:：]?\s*[a-zA-Z0-9]{4}/
            )?.[0]
          : undefined
      this.inputs.set(entry.id, code ? `${source.raw} ${code}` : source.raw)
      ids.push(entry.id)
    }
    if (!ids.length) return null
    await this.persist()
    // Response metadata is safe to expose; source URLs and request headers stay in memory.
    const candidates = ids
      .map((id) => this.state.inbox.find((entry) => entry.id === id))
      .filter((entry) => entry?.source.platform === 'http')
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (cursor < candidates.length) {
          const entry = candidates[cursor++]
          const input = entry && this.inputs.get(entry.id)
          if (!entry || !input?.startsWith('http')) continue
          const result = await probeHttp(input, this.options.fetch)
          this.probes.set(entry.id, result)
          entry.source.expectedBytes = result.size
        }
      })
    )
    await this.persist()
    return this.preflight({ ids })
  }
  async preflight(raw: unknown): Promise<NexusPreflight> {
    const { ids, directory, skipDuplicates } =
      nexusPreflightRequestSchema.parse(raw)
    const items = await Promise.all(
      ids
        .flatMap((id) => {
          const entry = this.state.inbox.find((entry) => entry.id === id)
          return entry ? [entry] : []
        })
        .map(async (entry) => ({
          ...structuredClone(entry),
          available: this.inputs.has(entry.id),
          probe: this.probes.get(entry.id)?.probe,
          duplicate: await this.findDuplicate(entry.source.identity),
          saveDir:
            directory ||
            (await classifiedDirectory(
              this.options.defaultDirectory(),
              entry,
              this.state.preferences
            )),
        }))
    )
    const pending = items.filter((item) => !(skipDuplicates && item.duplicate))
    const directories = [...new Set(items.map((item) => item.saveDir))]
    const disks = directories.map(getNexusDiskSpace)
    const blocked =
      pending.some((item) => !!item.probe?.error) ||
      disks.some((disk) => {
        const needed = pending
          .filter((item) => item.saveDir === disk.directory)
          .reduce((sum, item) => sum + (item.source.expectedBytes ?? 0), 0)
        return (
          disk.freeBytes !== null &&
          disk.freeBytes <
            needed + this.state.preferences.diskReserveGiB * 1024 ** 3
        )
      })
    return {
      items,
      disks,
      blocked,
      knownBytes: pending.reduce(
        (sum, item) => sum + (item.source.expectedBytes ?? 0),
        0
      ),
      unknownCount: pending.filter((item) => item.source.expectedBytes === null)
        .length,
    }
  }
  private async findDuplicate(identity: string) {
    if (!this.state.preferences.duplicateWarning) return
    for (const task of this.options.tasks?.() ?? []) {
      const binding = this.state.bindings.find(
        (item) => item.taskId === task.id
      )
      const matches =
        binding?.source.identity === identity ||
        (!!task.infoHash &&
          /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(task.infoHash) &&
          normalizedSourceIdentity(`magnet:?xt=urn:btih:${task.infoHash}`) ===
            identity) ||
        task.uris.some((uri) => {
          try {
            return normalizedSourceIdentity(uri) === identity
          } catch {
            return false
          }
        })
      if (matches) {
        const duplicate = await duplicateTask(task)
        if (duplicate) return duplicate
      }
    }
  }
  cloudInput(raw: unknown): string {
    if (typeof raw !== 'string') return ''
    const id = raw
    const entry = this.state.inbox.find((item) => item.id === id)
    if (!entry) return ''
    return this.inputs.get(id) ?? ''
  }
  async discard(raw: unknown): Promise<NexusSnapshot> {
    const { ids } = nexusPreflightRequestSchema.parse(raw)
    this.state.inbox = this.state.inbox.filter(
      (entry) => !ids.includes(entry.id)
    )
    for (const id of ids) {
      this.inputs.delete(id)
      this.probes.delete(id)
    }
    await this.persist()
    return this.snapshot()
  }
  async download(
    raw: unknown,
    create: (request: TaskCreateRequest) => Promise<TaskCreateCommandResult>
  ): Promise<{ taskIds: string[]; failed: number }> {
    const request = nexusPreflightRequestSchema.parse(raw)
    const checked = await this.preflight(request)
    if (checked.blocked)
      throw new AppError(
        ErrorCode.IpcInvalidPayload,
        checked.items.some((item) => item.probe?.error)
          ? 'nexus.preflight.failed'
          : 'nexus.preflight.noSpace'
      )
    const taskIds: string[] = []
    let failed = 0
    for (const item of checked.items) {
      if (request.skipDuplicates && item.duplicate) continue
      const input = this.inputs.get(item.id)
      if (!input || !['http', 'magnet'].includes(item.source.platform)) {
        failed++
        continue
      }
      let operation = this.creating.get(item.id)
      if (!operation) {
        operation = create(
          item.source.platform === 'magnet'
            ? {
                type: 'bt',
                payload: { kind: 'magnet', uri: input },
                saveDir: item.saveDir,
                selectedFiles: [],
                duplicatePolicy: 'create-copy',
              }
            : {
                type: 'http',
                uris: [input],
                saveDir: item.saveDir,
                headers: Object.entries(
                  this.probes.get(item.id)?.headers ?? {}
                ).map(([name, value]) => ({ name, value })),
              }
        )
        this.creating.set(item.id, operation)
      }
      try {
        const result = await operation
        if (
          result.outcome === 'conflict' ||
          result.outcome === 'invalid-source'
        ) {
          failed++
          continue
        }
        taskIds.push(result.taskId)
        if (
          !this.state.bindings.some(
            (binding) => binding.taskId === result.taskId
          )
        ) {
          this.state.bindings.push({
            taskId: result.taskId,
            source: item.source,
            routeRef: 'local',
          })
        }
        this.state.inbox = this.state.inbox.filter(
          (entry) => entry.id !== item.id
        )
        await this.persist()
        this.inputs.delete(item.id)
        this.probes.delete(item.id)
      } catch {
        failed++
      } finally {
        this.creating.delete(item.id)
      }
    }
    this.options.changed()
    return { taskIds, failed }
  }
  async drain(): Promise<void> {
    await this.writes
  }
}
