import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { CredentialBroker } from '@core/nexus/cloud/credential-broker'
import {
  type ToolId,
  toolActionSchema,
  toolManifest,
} from '@shared/schemas/nexus-tools'
import * as yauzl from 'yauzl'
import { z } from 'zod'
import { downloadTool } from './download-tool'
import { fileSha256 } from './file-sha256'

export { fileSha256 } from './file-sha256'

const run = promisify(execFile)
const receiptSchema = z.record(
  z.string(),
  z.object({ version: z.string(), hashes: z.record(z.string(), z.string()) })
)
export function toolDownloadUrl(url: string, prefix: string): string {
  if (!prefix || !url.startsWith('https://github.com/')) return url
  const u = new URL(prefix)
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    throw new Error('tools.mirror')
  return `${prefix.replace(/\/$/, '')}/${url}`
}
/** Only selected regular files from an authenticated archive are extracted. */
export async function extractToolZip(
  archive: string,
  directory: string,
  names: readonly string[]
): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error)
        return
      }
      const found = new Set<string>()
      let total = 0
      const fail = (e: unknown) => {
        zip.close()
        reject(e)
      }
      zip.on('error', fail)
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = path.posix.basename(entry.fileName)
        if (!names.includes(name)) {
          zip.readEntry()
          return
        }
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        total += entry.uncompressedSize
        if (found.has(name) || mode === 0o120000 || total > 1024 ** 3) {
          fail(new Error('tools.archive'))
          return
        }
        found.add(name)
        zip.openReadStream(entry, (err, input) => {
          if (err || !input) {
            fail(err)
            return
          }
          void pipeline(
            input,
            createWriteStream(path.join(directory, name), { flags: 'wx' })
          ).then(() => zip.readEntry(), fail)
        })
      })
      zip.once('end', () =>
        found.size === names.length
          ? resolve()
          : reject(new Error('tools.archive'))
      )
      zip.readEntry()
    })
  )
}
export class ToolManager {
  private busy = new Set<ToolId>()
  private leases = new Map<ToolId, number>()
  constructor(
    readonly root: string,
    private broker: CredentialBroker,
    private changed: () => void,
    private fetcher: typeof fetch = fetch,
    private downloadPrefix?: () => string
  ) {}
  private receipts() {
    return receiptSchema.parse(
      JSON.parse(this.broker.get('tool-receipts') || '{}')
    )
  }
  snapshot() {
    const receipts = this.receipts()
    return {
      prefix: this.downloadPrefix?.() ?? this.broker.get('tool-mirror'),
      tools: Object.entries(toolManifest).map(([id, m]) => ({
        id,
        ...m,
        installed: receipts[id]?.version ?? null,
        busy: this.busy.has(id as ToolId),
      })),
    }
  }
  async executable(id: ToolId): Promise<string> {
    const receipt = this.receipts()[id]
    const manifest = toolManifest[id]
    if (!receipt || receipt.version !== manifest.version)
      throw new Error(`tools.${id}`)
    for (const name of manifest.files)
      if (
        (await fileSha256(path.join(this.root, id, manifest.version, name))) !==
        receipt.hashes[name]
      )
        throw new Error('tools.hash')
    return path.join(this.root, id, manifest.version, manifest.files[0])
  }
  async using<T>(ids: ToolId[], operation: () => Promise<T>): Promise<T> {
    if (ids.some((id) => this.busy.has(id))) throw new Error('tools.busy')
    for (const id of ids) {
      this.leases.set(id, (this.leases.get(id) ?? 0) + 1)
    }
    try {
      return await operation()
    } finally {
      for (const id of ids)
        this.leases.set(id, Math.max(0, (this.leases.get(id) ?? 1) - 1))
    }
  }
  async action(raw: unknown) {
    const req = toolActionSchema.parse(raw)
    if (req.action === 'mirror') {
      if (req.prefix) toolDownloadUrl('https://github.com/a/b', req.prefix)
      await this.broker.update('tool-mirror', () => req.prefix)
      return this.snapshot()
    }
    if (this.busy.has(req.id) || (this.leases.get(req.id) ?? 0) > 0)
      throw new Error('tools.busy')
    this.busy.add(req.id)
    this.changed()
    try {
      const receipts = this.receipts()
      if (req.action === 'uninstall') {
        await rm(path.join(this.root, req.id), { recursive: true, force: true })
        delete receipts[req.id]
      } else {
        if (process.platform !== 'win32' || process.arch !== 'x64')
          throw new Error('tools.platform')
        const m = toolManifest[req.id],
          stage = path.join(this.root, `stage-${randomUUID()}`)
        await mkdir(stage, { recursive: true })
        try {
          const pending = path.join(
            this.root,
            '.downloads',
            `${req.id}-${m.sha256}.${m.kind}`
          )
          await downloadTool({
            url: toolDownloadUrl(
              m.url,
              this.downloadPrefix?.() ?? this.broker.get('tool-mirror')
            ),
            file: pending,
            sha256: m.sha256,
            fetcher: this.fetcher,
          })
          const archive = path.join(stage, `download.${m.kind}`)
          await rename(pending, archive)
          const payload = path.join(stage, 'payload')
          await mkdir(payload)
          if (m.kind === 'exe')
            await rename(archive, path.join(payload, m.files[0]))
          else if (m.kind === 'zip')
            await extractToolZip(archive, payload, m.files)
          else {
            // Administrative image extraction only; does not install 7-Zip or file associations.
            const extracted = path.join(stage, 'msi')
            await mkdir(extracted)
            await run(
              path.join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'msiexec.exe'
              ),
              ['/a', archive, '/qn', `TARGETDIR=${extracted}`],
              { windowsHide: true, timeout: 120000 }
            )
            const walk = async (dir: string): Promise<string[]> => {
              const out: string[] = []
              for (const e of await readdir(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name)
                if (e.isDirectory()) out.push(...(await walk(p)))
                else if (e.isFile()) out.push(p)
              }
              return out
            }
            const files = await walk(extracted)
            for (const name of m.files) {
              const source = files.find((f) => path.basename(f) === name)
              if (!source) throw new Error('tools.archive')
              await writeFile(
                path.join(payload, name),
                await readFile(source),
                { flag: 'wx' }
              )
            }
          }
          const hashes: Record<string, string> = {}
          for (const name of m.files)
            hashes[name] = await fileSha256(path.join(payload, name))
          const target = path.join(this.root, req.id, m.version)
          await mkdir(path.dirname(target), { recursive: true })
          await rm(target, { recursive: true, force: true })
          await rename(payload, target)
          receipts[req.id] = { version: m.version, hashes }
        } finally {
          await rm(stage, { recursive: true, force: true })
        }
      }
      await this.broker.update('tool-receipts', () => JSON.stringify(receipts))
      return this.snapshot()
    } finally {
      this.busy.delete(req.id)
      this.changed()
    }
  }
}
