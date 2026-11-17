import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CredentialBroker } from '../cloud/credential-broker'
import type { ToolManager } from '../tools/tool-manager'
import {
  type MediaAsset,
  mediaName,
  mediaUrl,
  obj,
  type ParsedMedia,
  rows,
  str,
} from './domestic-parsers'

export interface ExternalJob {
  createdAt: number
  id: string
  name: string
  directory: string
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error'
  progress: number
  downloadedBytes: number
  totalBytes: number
  error?: string
  files: string[]
}
interface StoredJob extends ExternalJob {
  range: string
  url: string
  gallery: boolean
  formatId: string
  subtitle?: string
  container: 'mp4' | 'mkv'
  cookie: string
}
export class ExternalMedia {
  private jobs: StoredJob[] = []
  private running = new Map<string, AbortController>()
  constructor(
    private deps: {
      tools: ToolManager
      broker: CredentialBroker
      changed(): void
      complete?(job: ExternalJob): Promise<void>
    }
  ) {}
  async load() {
    const data = this.deps.broker.get('external-jobs')
    if (data) {
      this.jobs = JSON.parse(data)
      for (const job of this.jobs) {
        job.createdAt ??= 0
        if (job.status === 'downloading') job.status = 'paused'
      }
    }
  }
  snapshot(): ExternalJob[] {
    return this.jobs.map(
      ({
        url: _url,
        gallery: _gallery,
        formatId: _format,
        subtitle: _sub,
        container: _container,
        cookie: _cookie,
        ...job
      }) => ({ ...job })
    )
  }
  private async save() {
    await this.deps.broker.update('external-jobs', () =>
      JSON.stringify(this.jobs)
    )
    this.deps.changed()
  }
  private async cookieFile(
    address: string,
    cookie: string,
    operation: (file: string) => Promise<string>
  ): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-cookies-'))
    const file = path.join(dir, 'cookies.txt')
    try {
      const host = new URL(address).hostname
      const lines = cookie
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const p = c.indexOf('=')
          return p > 0
            ? `${host}\tFALSE\t/\tTRUE\t0\t${c.slice(0, p)}\t${c.slice(p + 1).replace(/[\r\n\t]/g, '')}`
            : ''
        })
      await writeFile(
        file,
        `# Netscape HTTP Cookie File\n${lines.join('\n')}\n`,
        { mode: 0o600 }
      )
      return await operation(file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  private process(
    binary: string,
    args: string[],
    signal?: AbortSignal,
    onLine?: (line: string) => void,
    timeout = 300000
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = '',
        line = ''
      let size = 0
      const kill = () => {
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn(
            path.join(
              process.env.SystemRoot ?? 'C:\\Windows',
              'System32',
              'taskkill.exe'
            ),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' }
          )
          killer.once('error', () => child.kill())
        } else child.kill()
      }
      signal?.addEventListener('abort', kill, { once: true })
      if (signal?.aborted) kill()
      const timer = setTimeout(kill, timeout)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 32 * 1024 ** 2) {
          kill()
          return
        }
        stdout += chunk.toString()
        line += chunk.toString()
        let end = line.indexOf('\n')
        while (end >= 0) {
          onLine?.(line.slice(0, end))
          line = line.slice(end + 1)
          end = line.indexOf('\n')
        }
      })
      // Tool diagnostics may contain signed URLs or credentials; never forward or retain them.
      child.stderr.resume()
      child.once('error', () => {
        clearTimeout(timer)
        reject(new Error('media.failed'))
      })
      child.once('close', (code) => {
        signal?.removeEventListener('abort', kill)
        clearTimeout(timer)
        code === 0 && size <= 32 * 1024 ** 2
          ? resolve(stdout)
          : reject(new Error('media.failed'))
      })
    })
  }
  async parse(
    address: string,
    cookie: string,
    gallery: boolean
  ): Promise<ParsedMedia & { subtitles: string[] }> {
    mediaUrl(address)
    const id = gallery ? 'gallery-dl' : 'yt-dlp'
    return this.deps.tools.using(
      gallery ? ['gallery-dl'] : ['yt-dlp', 'deno'],
      async () => {
        const tool = await this.deps.tools.executable(id)
        const raw = await this.cookieFile(address, cookie, async (file) => {
          const args = gallery
            ? [
                '--config-ignore',
                '--dump-json',
                '--range',
                '1-500',
                '--cookies',
                file,
                '--',
                address,
              ]
            : [
                '--ignore-config',
                '--no-warnings',
                '--dump-single-json',
                '--skip-download',
                '--playlist-end',
                '200',
                '--no-js-runtimes',
                '--js-runtimes',
                `deno:${await this.deps.tools.executable('deno')}`,
                '--cookies',
                file,
                '--',
                address,
              ]
          return this.process(tool, args)
        })
        const parsed: unknown = JSON.parse(raw)
        const assets: MediaAsset[] = []
        const subtitles = new Set<string>()
        if (gallery) {
          for (const entry of Array.isArray(parsed) ? parsed : []) {
            if (!Array.isArray(entry) || entry[0] !== 3) continue
            const meta = obj(entry[2])
            assets.push({
              id: String(assets.length),
              url: mediaUrl(entry[1]),
              kind: 'image',
              label: str(meta.filename),
              format: str(meta.extension) || 'jpg',
              bytes: null,
              entry: String(assets.length + 1),
              headers: {},
              external: { page: address, gallery: true, formatId: '' },
            })
          }
        } else {
          const root = obj(parsed),
            entries = Array.isArray(root.entries) ? rows(root.entries) : [root]
          for (const [index, entry] of entries.entries()) {
            for (const lang of Object.keys(obj(entry.subtitles)))
              subtitles.add(lang)
            for (const f of rows(entry.formats).filter(
              (f) => f.vcodec !== 'none' && !f.has_drm
            )) {
              assets.push({
                id: String(assets.length),
                url: mediaUrl(str(entry.webpage_url) || address),
                kind: 'video',
                label: `${str(f.height) || '?'}P ${str(f.ext)} ${str(f.format_note)}`,
                format: str(f.ext) || 'mp4',
                bytes: Number(f.filesize ?? f.filesize_approx) || null,
                entry: `${index + 1} ${str(entry.title)}`,
                headers: {},
                external: {
                  page: str(entry.webpage_url) || address,
                  gallery: false,
                  formatId: str(f.format_id),
                },
              })
            }
          }
        }
        if (!assets.length) throw new Error('media.blocked')
        return {
          platform: 'external',
          title: str(obj(parsed).title) || new URL(address).hostname,
          assets,
          subtitles: [...subtitles],
        }
      }
    )
  }
  async download(
    asset: MediaAsset,
    directory: string,
    name: string,
    cookie: string,
    container: 'mp4' | 'mkv',
    subtitle?: string
  ): Promise<string> {
    if (!asset.external) throw new Error('media.invalid')
    const job: StoredJob = {
      createdAt: Date.now(),
      range: asset.entry,
      id: randomUUID(),
      name: mediaName(name),
      directory,
      status: 'queued',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: asset.bytes ?? 0,
      files: [],
      url: asset.external.page,
      gallery: asset.external.gallery,
      formatId: asset.external.formatId,
      container,
      subtitle,
      cookie,
    }
    this.jobs.push(job)
    await this.save()
    return job.id
  }
  async pause(id: string) {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return
    job.status = 'paused'
    this.running.get(id)?.abort()
    await this.save()
  }
  async start(id: string) {
    const job = this.jobs.find((j) => j.id === id)
    if (!job || this.running.has(id) || job.status === 'completed') return
    const cancel = new AbortController()
    this.running.set(id, cancel)
    job.status = 'downloading'
    await this.save()
    try {
      await this.deps.tools.using(
        job.gallery ? ['gallery-dl'] : ['yt-dlp', 'deno', 'ffmpeg'],
        async () => {
          const binary = await this.deps.tools.executable(
            job.gallery ? 'gallery-dl' : 'yt-dlp'
          )
          const target = path.join(job.directory, job.id)
          await mkdir(target, { recursive: true })
          await this.cookieFile(job.url, job.cookie, async (file) => {
            const args = job.gallery
              ? [
                  '--config-ignore',
                  '--cookies',
                  file,
                  '--destination',
                  target,
                  '--range',
                  job.range,
                  '--',
                  job.url,
                ]
              : [
                  '--ignore-config',
                  '--no-warnings',
                  '--no-playlist',
                  '--continue',
                  '--no-overwrites',
                  '--newline',
                  '--progress-template',
                  'download:NEXUS:%(progress.downloaded_bytes)s:%(progress.total_bytes_estimate)s',
                  '--no-js-runtimes',
                  '--js-runtimes',
                  `deno:${await this.deps.tools.executable('deno')}`,
                  '--ffmpeg-location',
                  path.dirname(await this.deps.tools.executable('ffmpeg')),
                  '--cookies',
                  file,
                  '--format',
                  `${job.formatId}+bestaudio/${job.formatId}`,
                  '--merge-output-format',
                  job.container,
                  '--paths',
                  target,
                  '--output',
                  `${job.name}.%(ext)s`,
                  ...(job.subtitle
                    ? ['--write-subs', '--sub-langs', job.subtitle]
                    : []),
                  '--',
                  job.url,
                ]
            return this.process(
              binary,
              args,
              cancel.signal,
              (line) => {
                const match = line.match(/^NEXUS:(\d+):(\d+)/)
                if (!match) return
                job.downloadedBytes = Number(match[1])
                job.totalBytes = Number(match[2])
                job.progress = job.totalBytes
                  ? Math.min(0.99, job.downloadedBytes / job.totalBytes)
                  : 0
                this.deps.changed()
              },
              24 * 3600000
            )
          })
          const walk = async (dir: string): Promise<string[]> => {
            const out: string[] = []
            for (const e of await readdir(dir, { withFileTypes: true })) {
              const p = path.join(dir, e.name)
              if (e.isDirectory()) out.push(...(await walk(p)))
              else if (e.isFile() && !/\.(part|ytdl|temp)$/.test(e.name))
                out.push(p)
            }
            return out
          }
          job.files = await walk(target)
          if (!job.files.length) throw new Error('media.failed')
          job.downloadedBytes = (
            await Promise.all(job.files.map((f) => stat(f)))
          ).reduce((a, s) => a + s.size, 0)
          job.totalBytes = job.downloadedBytes
          job.progress = 1
          await this.deps.complete?.(job)
          job.status = 'completed'
        }
      )
    } catch {
      if (!cancel.signal.aborted) {
        job.status = 'error'
        job.error = 'media.failed'
      }
    } finally {
      this.running.delete(id)
      await this.save()
    }
  }
  async stop() {
    for (const id of this.running.keys()) await this.pause(id)
    while (this.running.size)
      await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
