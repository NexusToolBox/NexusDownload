import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { CredentialBroker } from '@core/nexus/cloud/credential-broker'
import { getNexusDiskSpace } from '@core/nexus/disk-space'
import type {
  TaskCreateCommandResult,
  TaskCreateRequest,
} from '@shared/schemas/add-task'
import {
  type MediaPlatform,
  type MediaResult,
  mediaActionSchema,
} from '@shared/schemas/nexus-media'
import {
  detectMedia,
  type MediaAsset,
  mediaName,
  type ParsedMedia,
  type ParserIo,
  parseDomestic,
} from './domestic-parsers'

export interface MediaRuntimeDeps {
  finish?: import('./media-finisher').MediaFinisher
  requireFfmpeg?(): Promise<void>
  services?: import('./service-connectors').ServiceConnectors
  external?: import('./external-media').ExternalMedia
  broker: CredentialBroker
  io: ParserIo
  login(platform: MediaPlatform, url?: string): Promise<string>
  stream(
    asset: MediaAsset,
    directory: string,
    filename: string
  ): Promise<{ taskId: string }>
  enqueue?(ids: string[]): Promise<void>
  completedGroup?(
    title: string,
    ids: string[],
    directory: string
  ): Promise<void>
  threshold?(): number
}
export class MediaRuntime {
  private submitting = false
  isSubmitting() {
    return this.submitting
  }
  private results = new Map<string, { parsed: ParsedMedia; at: number }>()
  private recent: MediaResult[] = []
  private create?: (
    request: TaskCreateRequest
  ) => Promise<TaskCreateCommandResult>
  constructor(readonly deps: MediaRuntimeDeps) {}
  setCreate(
    create: (request: TaskCreateRequest) => Promise<TaskCreateCommandResult>
  ) {
    this.create = create
  }
  snapshot() {
    return {
      recent: this.recent,
      jobs: this.deps.external?.snapshot() ?? [],
      logins: [
        'bilibili',
        'pixiv',
        'douyin',
        'kuaishou',
        'weibo',
        'xiaohongshu',
        'acfun',
        'external',
      ].filter((p) => !!this.deps.broker.get(`media-${p}`)),
    }
  }
  private cookieKey(platform: MediaPlatform, url?: string) {
    return platform === 'external' && url
      ? 'media-external-' +
          createHash('sha256').update(new URL(url).origin).digest('hex')
      : `media-${platform}`
  }
  async action(raw: unknown): Promise<unknown> {
    const req = mediaActionSchema.parse(raw)
    if (req.action === 'login') {
      const site = req.url ? detectMedia(req.url) : req.platform
      const cookies = await this.deps.login(site, req.url)
      await this.deps.broker.update(
        this.cookieKey(site, req.url),
        () => cookies
      )
      return this.snapshot()
    }
    if (req.action === 'logout') {
      await this.deps.broker.remove(`media-${req.platform}`)
      return this.snapshot()
    }
    if (req.action === 'parse') {
      const platform = detectMedia(req.url)
      const cookie = this.deps.broker.get(this.cookieKey(platform, req.url))
      const parsed =
        platform === 'external' && this.deps.external
          ? ((await this.deps.services?.parse(req.url)) ??
            (await this.deps.external.parse(
              req.url,
              cookie,
              req.gallery ||
                /(?:^|\.)(?:flickr\.com|deviantart\.com|artstation\.com|imgur\.com|danbooru\.donmai\.us|gelbooru\.com|e-hentai\.org|nhentai\.net)$/i.test(
                  new URL(req.url).hostname
                )
            )))
          : await parseDomestic(req.url, cookie, this.deps.io, req.quality)
      const id = randomUUID()
      this.results.set(id, { parsed, at: Date.now() })
      for (const [key, value] of this.results)
        if (Date.now() - value.at > 3600000) this.results.delete(key)
      const result: MediaResult = {
        id,
        platform,
        title: parsed.title,
        choices: parsed.assets.map(
          ({
            url: _url,
            audioUrl: _audio,
            headers: _headers,
            motionUrl,
            external: _external,
            ugoira: _ugoira,
            ...asset
          }) => ({ ...asset, motion: !!motionUrl })
        ),
        subtitles: parsed.subtitles ?? [],
        notice: parsed.notice,
      }
      this.recent = [result, ...this.recent].slice(0, 20)
      return result
    }
    const result = this.results.get(req.id)
    if (!result || Date.now() - result.at > 3600000)
      throw new Error('media.expired')
    if (!path.isAbsolute(req.directory)) throw new Error('media.invalid')
    const disk = getNexusDiskSpace(req.directory)
    if (
      disk.freeBytes === null ||
      disk.freeBytes < (this.deps.threshold?.() ?? 5 * 1024 ** 3)
    )
      throw new Error('media.space')
    const chosen = result.parsed.assets.filter((a) =>
      req.choices.includes(a.id)
    )
    if (chosen.length !== req.choices.length || !this.create)
      throw new Error('media.invalid')
    if (
      chosen.some(
        (a) =>
          a.audioUrl ||
          a.ugoira ||
          /\.(m3u8|mpd)(?:[?#]|$)/i.test(a.url) ||
          (a.motionUrl && req.livePhoto) ||
          (a.kind === 'video' && req.format !== 'mp4')
      )
    )
      await this.deps.requireFfmpeg?.()
    if (this.submitting) throw new Error('media.busy')
    this.submitting = true
    const ids: string[] = []
    try {
      for (const asset of chosen) {
        const filename = `${mediaName(result.parsed.title)}_${mediaName(asset.entry)}_${mediaName(asset.label || asset.id)}.${asset.kind === 'video' ? (asset.audioUrl || /\.(m3u8|mpd)(?:[?#]|$)/i.test(asset.url) || asset.external ? req.format : asset.format) : asset.format}`
        let taskId: string
        if (asset.external && this.deps.external)
          taskId = await this.deps.external.download(
            asset,
            req.directory,
            filename,
            this.deps.broker.get(
              this.cookieKey('external', asset.external.page)
            ),
            req.format,
            req.subtitle
          )
        else if (asset.audioUrl || /\.(m3u8|mpd)(?:[?#]|$)/i.test(asset.url))
          taskId = (await this.deps.stream(asset, req.directory, filename))
            .taskId
        else {
          const task = await this.create({
            type: 'http',
            uris: [asset.url],
            saveDir: req.directory,
            filename,
            headers: Object.entries(asset.headers).map(([name, value]) => ({
              name,
              value,
            })),
          })
          if (task.outcome !== 'created') throw new Error('media.invalid')
          taskId = task.taskId
        }
        ids.push(taskId)
        if (asset.ugoira) {
          await this.deps.finish?.register({
            taskId,
            ugoira: asset.ugoira,
            container: req.format,
          })
        } else if (asset.motionUrl && req.livePhoto) {
          const motionName = `${path.parse(filename).name}_motion.mp4`
          const motion = await this.create({
            type: 'http',
            uris: [asset.motionUrl],
            saveDir: req.directory,
            filename: motionName,
            headers: Object.entries(asset.headers).map(([name, value]) => ({
              name,
              value,
            })),
          })
          if (motion.outcome !== 'created') throw new Error('media.invalid')
          ids.push(motion.taskId)
          await this.deps.finish?.register({ taskId, motionId: motion.taskId })
        } else if (
          asset.kind === 'video' &&
          !asset.external &&
          !asset.audioUrl &&
          !/\.(m3u8|mpd)(?:[?#]|$)/i.test(asset.url) &&
          req.format !== asset.format
        )
          await this.deps.finish?.register({ taskId, container: req.format })
      }
      if (ids.length > 1)
        await this.deps.completedGroup?.(
          result.parsed.title,
          ids,
          req.directory
        )
      await this.deps.enqueue?.(ids)
      return { taskIds: ids }
    } finally {
      this.submitting = false
      if (ids.length) await this.deps.enqueue?.(ids)
    }
  }
}
