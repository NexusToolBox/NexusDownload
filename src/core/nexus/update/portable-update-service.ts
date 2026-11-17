import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { EngineAdapter } from '@core/engine/engine-adapter'
import type { EventBus } from '@core/events/event-bus'
import { Events } from '@shared/protocol/events'
import type { AppUpdateState } from '@shared/types/app-update'
import { TaskStatus } from '@shared/types/task'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { fileSha256 } from '../tools/file-sha256'

const releaseSchema = z.object({
  tag_name: z.string(),
  body: z.string().nullish(),
  published_at: z.string().nullish(),
  html_url: z.url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.url(),
      size: z.number().int().positive(),
    })
  ),
})
const preferencesSchema = z
  .object({
    lastCheck: z.number().default(0),
    gid: z.string().optional(),
    version: z.string().optional(),
    prompted: z.array(z.string()).default([]),
  })
  .catch({ lastCheck: 0, prompted: [] })
export interface PortableInstallRequest {
  zip: string
  sha256: string
  version: string
  previousVersion: string
}
export function newerVersion(next: string, current: string) {
  if (!/^\d+\.\d+\.\d+$/.test(next)) return false
  const a = next.split('.').map(Number),
    b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}
/** Portable releases use the existing engine and a separate transactional installer. */
export class PortableUpdateService {
  private state: AppUpdateState
  private preferences = preferencesSchema.parse({})
  private release?: z.infer<typeof releaseSchema>
  private checksumUrl = ''
  private zipUrl = ''
  private digest = ''
  private checking?: Promise<unknown>
  private downloading?: Promise<void>
  private cancelled = false
  private installing = false
  constructor(
    private options: {
      version: string
      directory: string
      latestUrl: string
      engine: EngineAdapter
      events: EventBus
      prefix(): string
      activeTasks(): string[]
      install(request: PortableInstallRequest): Promise<void>
      fetcher?: typeof fetch
      allowLocalhost?: boolean
    }
  ) {
    this.state = {
      phase: 'idle',
      currentVersion: options.version,
      updateAuthority: 'application',
    }
  }
  private get preferencesFile() {
    return path.join(this.options.directory, 'preferences.json')
  }
  private get archive() {
    return path.join(
      this.options.directory,
      `NexusDownload-v${this.state.availableVersion}-win-x64.zip`
    )
  }
  async initialize() {
    try {
      this.preferences = preferencesSchema.parse(
        JSON.parse(await readFile(this.preferencesFile, 'utf8'))
      )
    } catch {
      this.preferences = preferencesSchema.parse({})
    }
  }
  private async save() {
    await mkdir(this.options.directory, { recursive: true })
    await writeFileAtomic(
      this.preferencesFile,
      JSON.stringify(this.preferences)
    )
  }
  getState(): AppUpdateState {
    return {
      ...this.state,
      activeTasks: this.options.activeTasks(),
    }
  }
  getChannel() {
    return 'stable' as const
  }
  setChannel() {
    /* Portable releases have one stable channel. */
  }
  private emit(patch: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...patch }
    this.options.events.emit(Events.UpdateStateChanged, this.getState())
  }
  private url(value: string, accelerated = false) {
    const prefix = accelerated ? this.options.prefix().trim() : ''
    const address = new URL(prefix ? `${prefix}${value}` : value)
    if (
      address.username ||
      address.password ||
      address.hash ||
      (address.protocol !== 'https:' &&
        !(
          this.options.allowLocalhost &&
          address.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(address.hostname)
        ))
    )
      throw new Error('update.github')
    return address.href
  }
  private async request(url: string, accelerated = false) {
    const response = await (this.options.fetcher ?? fetch)(
      this.url(url, accelerated),
      {
        signal: AbortSignal.timeout(15000),
        credentials: 'omit',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'NexusDownload',
        },
      }
    )
    if (!response.ok) throw new Error('update.github')
    return response
  }
  async check(manual = true): Promise<unknown> {
    if (this.checking) return this.checking
    if (
      this.downloading ||
      this.installing ||
      this.state.phase === 'downloaded'
    )
      return
    if (!manual && Date.now() - this.preferences.lastCheck < 86400000) return
    const previous = { ...this.state }
    this.checking = (async () => {
      try {
        this.preferences.lastCheck = Date.now()
        await this.save()
        this.emit({ phase: 'checking', error: undefined })
        const response = await this.request(this.options.latestUrl)
        const raw = await response.text()
        if (raw.length > 1024 * 1024) throw new Error('update.github')
        const release = releaseSchema.parse(JSON.parse(raw))
        const version = release.tag_name.replace(/^v/, '')
        if (release.draft || release.prerelease) {
          this.emit({
            ...previous,
            phase: 'up-to-date',
            availableVersion: undefined,
          })
          return
        }
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('update.github')
        const filename = `NexusDownload-v${version}-win-x64.zip`
        const zip = release.assets.find((a) => a.name === filename)
        const sha = release.assets.find((a) => a.name === `${filename}.sha256`)
        if (newerVersion(version, this.options.version) && (!zip || !sha))
          throw new Error('update.github')
        this.release = release
        this.zipUrl = zip?.browser_download_url ?? ''
        this.checksumUrl = sha?.browser_download_url ?? ''
        const available = newerVersion(version, this.options.version)
        this.emit({
          phase: available ? 'available' : 'up-to-date',
          availableVersion: available ? version : undefined,
          releaseNotes: release.body ?? '',
          releaseUrl: release.html_url,
          publishedAt: release.published_at ?? undefined,
          automatic: !manual,
          prompted: this.preferences.prompted.includes(version),
          checkedAt: new Date().toISOString(),
          error: undefined,
        })
      } catch {
        if (manual)
          this.emit({
            ...previous,
            phase: 'error',
            error: { message: 'update.github' },
          })
        else this.emit(previous)
      }
    })().finally(() => {
      this.checking = undefined
    })
    return this.checking
  }
  async download() {
    if (this.downloading || this.installing) return
    if (!this.release || !this.state.availableVersion || !this.zipUrl) return
    this.cancelled = false
    this.emit({
      phase: 'downloading',
      error: undefined,
      browserFallback: false,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    })
    let slowSince = Date.now()
    const monitor = setInterval(() => {
      if (
        (this.state.progress?.bytesPerSecond ?? 0) >= 50 * 1024 &&
        (this.state.progress?.transferred ?? 0) > 0
      )
        slowSince = Date.now()
      if (!this.state.browserFallback && Date.now() - slowSince >= 30000)
        this.emit({ browserFallback: true })
    }, 500)
    this.downloading = this.runDownload()
      .catch(async (error) => {
        if (this.cancelled) return
        this.emit({
          phase: 'error',
          progress: undefined,
          error: {
            message:
              error instanceof Error && error.message === 'update.hash'
                ? 'update.hash'
                : 'update.download',
          },
        })
      })
      .finally(() => {
        clearInterval(monitor)
        this.downloading = undefined
      })
  }
  private async runDownload() {
    const checksum = (
      await (await this.request(this.checksumUrl, true)).text()
    ).trim()
    const match = /^([a-fA-F0-9]{64})(?:\s+\*?([^\r\n]+))?$/.exec(checksum)
    if (
      checksum.length > 1024 ||
      !match ||
      (match[2] && match[2] !== path.basename(this.archive))
    ) {
      await this.discardArchive()
      throw new Error('update.hash')
    }
    if (this.cancelled) return
    this.digest = match[1].toLowerCase()
    await mkdir(this.options.directory, { recursive: true })
    if ((await fileSha256(this.archive).catch(() => '')) === this.digest) {
      if (this.cancelled) return
      this.emit({ phase: 'downloaded', progress: undefined })
      return
    }
    let gid =
      this.preferences.version === this.state.availableVersion
        ? this.preferences.gid
        : undefined
    if (gid) {
      const task = await this.options.engine
        .getTaskStatus(gid)
        .catch(() => null)
      if (
        !task ||
        [TaskStatus.Error, TaskStatus.Removed, TaskStatus.Completed].includes(
          task.status
        )
      )
        gid = undefined
      else await this.options.engine.resumeTask(gid)
    }
    if (!gid)
      gid = await this.options.engine.createDownload({
        uris: [this.url(this.zipUrl, true)],
        saveDir: this.options.directory,
        filename: path.basename(this.archive),
        gid: randomBytes(8).toString('hex'),
        pause: false,
        extraEngineOptions: {
          split: '8',
          'max-connection-per-server': '8',
          continue: 'true',
          'allow-overwrite': 'false',
          'auto-file-renaming': 'false',
        },
      })
    this.preferences.gid = gid
    this.preferences.version = this.state.availableVersion
    await this.save()
    if (this.cancelled) {
      await this.options.engine.pauseTask(gid).catch(() => undefined)
      return
    }
    while (!this.cancelled) {
      const task = await this.options.engine.getTaskStatus(gid)
      if (!task || [TaskStatus.Error, TaskStatus.Removed].includes(task.status))
        throw new Error('update.download')
      this.emit({
        progress: {
          percent: task.progress * 100,
          transferred: task.downloadedBytes,
          total: task.totalBytes,
          bytesPerSecond: task.downloadSpeed,
        },
      })
      if (task.status === TaskStatus.Completed) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (this.cancelled) return
    if ((await fileSha256(this.archive)) !== this.digest) {
      await this.discardArchive()
      throw new Error('update.hash')
    }
    this.emit({ phase: 'downloaded', progress: undefined, error: undefined })
  }
  private async discardArchive() {
    if (this.preferences.gid) {
      await this.options.engine
        .removeTask(this.preferences.gid)
        .catch(() => undefined)
      await this.options.engine
        .removeDownloadResult(this.preferences.gid)
        .catch(() => undefined)
    }
    this.preferences.gid = undefined
    await rm(this.archive, { force: true })
    await rm(`${this.archive}.aria2`, { force: true })
    await this.save()
  }
  async install() {
    if (
      this.installing ||
      this.state.phase !== 'downloaded' ||
      !this.state.availableVersion
    )
      return
    this.installing = true
    try {
      if ((await fileSha256(this.archive)) !== this.digest) {
        await this.discardArchive()
        throw new Error('update.hash')
      }
      await this.options.install({
        zip: this.archive,
        sha256: this.digest,
        version: this.state.availableVersion,
        previousVersion: this.options.version,
      })
      this.emit({ phase: 'installing' })
    } catch (error) {
      this.installing = false
      this.emit({
        phase: 'error',
        error: {
          message:
            error instanceof Error && error.message === 'update.permission'
              ? 'update.permission'
              : error instanceof Error && error.message === 'update.hash'
                ? 'update.hash'
                : 'update.install',
        },
      })
    }
  }
  async action(raw: unknown) {
    const { action } = z
      .object({
        action: z.enum(['cancel', 'dismiss-completed', 'mark-prompted']),
      })
      .parse(raw)
    if (action === 'mark-prompted') {
      const version = this.state.availableVersion
      if (version && !this.preferences.prompted.includes(version)) {
        this.preferences.prompted = [
          ...this.preferences.prompted.slice(-19),
          version,
        ]
        await this.save()
      }
      this.emit({ prompted: true })
    } else if (action === 'cancel') {
      this.cancelled = true
      await this.downloading
      if (this.preferences.gid)
        await this.options.engine
          .pauseTask(this.preferences.gid)
          .catch(() => undefined)
      this.emit({ phase: 'cancelled', progress: undefined })
    } else
      this.emit({ completedVersion: undefined, restoredVersion: undefined })
  }
  setStartupResult(result: {
    completedVersion?: string
    restoredVersion?: string
    releaseNotes?: string
  }) {
    this.emit({ ...result, completedReleaseNotes: result.releaseNotes })
  }
  async waitForDownload() {
    await this.downloading
  }
}
