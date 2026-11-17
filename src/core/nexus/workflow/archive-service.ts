import { execFile } from 'node:child_process'

import { lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'

import path from 'node:path'

import { getNexusDiskSpace } from '../disk-space'

import type { ToolManager } from '../tools/tool-manager'
import { volumeKey } from './package-manager'

export function passwordCandidates(...sources: string[]): string[] {
  const values: string[] = []

  for (const source of sources) {
    for (const m of source.matchAll(
      /(?:密码|密碼|解压码|解壓碼|password|pwd|pass)\s*[:：=＿_ -]\s*([^\s，。；;,<>[\]【】()（）]{1,128})/gi
    ))
      values.push(m[1])
  }

  return [...new Set(values)].slice(0, 200)
}
export function filenamePasswords(files: string[]): string[] {
  return passwordCandidates(
    ...files.map((file) =>
      path
        .basename(file)
        .replace(
          /(?:\.part\d+\.rar|\.(?:7z|zip)\.\d{3}|\.(?:7z|zip|rar|r\d\d|tar|gz|bz2|xz))$/i,
          ''
        )
    )
  )
}

export function archiveEntryList(output: string): {
  bytes: number
  paths: string[]
} {
  const entries = output.split(/\r?\n\r?\n/).filter((e) => /^Path = /m.test(e))

  const paths: string[] = []
  let bytes = 0

  for (const entry of entries) {
    const name = /^Path = (.*)$/m.exec(entry)?.[1]?.trim() ?? ''

    if (
      !name ||
      name.includes(':') ||
      [...name].some((c) => c.charCodeAt(0) < 32) ||
      /^[\\/]/.test(name) ||
      name
        .split(/[\\/]/)
        .some(
          (p) =>
            p === '..' ||
            /[. ]$/.test(p) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
        ) ||
      [
        ...entry.matchAll(
          /^(Symbolic Link|Hard Link|Copy Link|Reparse|Alternate Stream) = ([^\r\n]*)/gm
        ),
      ].some(
        ([, field, value]) =>
          value.trim() !== '' &&
          !(field === 'Alternate Stream' && value.trim() === '-')
      ) ||
      /^Attributes = .*l/im.test(entry)
    )
      throw new Error('processing.unsafeArchive')

    bytes += Number(/^Size = (\d+)/m.exec(entry)?.[1] ?? 0)

    if (!Number.isSafeInteger(bytes) || paths.length > 100000)
      throw new Error('processing.unsafeArchive')

    paths.push(name)
  }

  if (!paths.length) throw new Error('processing.archive')

  return { bytes, paths }
}

export function runArchive(
  binary: string,
  args: string[]
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      args,
      {
        windowsHide: true,
        timeout: 3600000,
        maxBuffer: 32 * 1024 ** 2,
        encoding: 'utf8',
      },
      (error, stdout) =>
        resolve({ code: error ? Number(error.code) || -1 : 0, output: stdout })
    )
    child.stdin?.end()
  })
}

export async function regularFiles(root: string): Promise<string[]> {
  const info = await lstat(root)

  if (info.isSymbolicLink()) throw new Error('processing.unsafeArchive')

  if (info.isFile()) return [root]

  if (!info.isDirectory()) throw new Error('processing.verify')

  const files: string[] = []

  for (const e of await readdir(root))
    files.push(...(await regularFiles(path.join(root, e))))

  return files
}

/** Only first volumes are archive roots; recycling never includes unrelated files. */
export function archiveInputs(files: string[]) {
  return files
    .filter(
      (file) =>
        /(?:\.part0*1\.rar|\.(?:7z|zip)\.001)$/i.test(file) ||
        (/\.(?:7z|zip|rar|tar|gz|bz2|xz)$/i.test(file) &&
          !/\.part\d+\.rar$/i.test(file))
    )
    .map((archive) => {
      const key = volumeKey(path.basename(archive))?.key
      return {
        archive,
        volumes: key
          ? files.filter(
              (file) =>
                path.resolve(path.dirname(file)).toLowerCase() ===
                  path.resolve(path.dirname(archive)).toLowerCase() &&
                volumeKey(path.basename(file))?.key === key
            )
          : [archive],
      }
    })
}
export class ArchiveService {
  constructor(
    private deps: {
      tools: ToolManager
      reserve(): number
      trash(file: string): Promise<void>
    }
  ) {}

  async recycle(files: string[]) {
    for (const file of files) {
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (!info) continue
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('processing.verify')
      await this.deps.trash(file)
    }
  }

  async extract(
    files: string[],
    directory: string,
    candidates: string[]
  ): Promise<{
    files: string[]
    password: string
    archives: string[]
  }> {
    const inputs = archiveInputs(files)
    if (!inputs.length) return { files, password: '', archives: [] }
    return this.deps.tools.using(['7zip'], async () => {
      const binary = await this.deps.tools.executable('7zip')
      const archives = [...new Set(inputs.flatMap((input) => input.volumes))]
      const outputs = files.filter((file) => !archives.includes(file))
      const destinations: string[] = []
      let successfulPassword = ''
      try {
        for (const { archive } of inputs) {
          let selected: { password: string; bytes: number } | undefined
          for (const password of [...new Set(['', ...candidates])]) {
            const args = [`-p${password}`, '-sccUTF-8', '--', archive]
            const listing = await runArchive(binary, [
              'l',
              '-slt',
              '-ba',
              ...args,
            ])
            if (listing.code !== 0) continue
            const manifest = archiveEntryList(listing.output)
            const test = await runArchive(binary, [
              't',
              '-bso0',
              '-bse0',
              ...args,
            ])
            if (test.code === 0) {
              selected = { password, bytes: manifest.bytes }
              break
            }
          }
          if (!selected) throw new Error('processing.passwordOrVolume')
          const free = getNexusDiskSpace(directory).freeBytes
          if (free === null || free < selected.bytes + this.deps.reserve())
            throw new Error('processing.space')
          await mkdir(directory, { recursive: true })
          const stage = await mkdtemp(path.join(directory, '.nexus-extract-'))
          try {
            const result = await runArchive(binary, [
              'x',
              '-y',
              '-aos',
              '-bso0',
              '-bse0',
              '-sccUTF-8',
              `-o${stage}`,
              `-p${selected.password}`,
              '--',
              archive,
            ])
            if (result.code !== 0) throw new Error('processing.archive')
            const extracted = await regularFiles(stage)
            const actual = (
              await Promise.all(extracted.map((file) => lstat(file)))
            ).reduce((n, stat) => n + stat.size, 0)
            if (actual !== selected.bytes)
              throw new Error('processing.unsafeArchive')
            const destination = `${stage}-complete`
            await rename(stage, destination)
            destinations.push(destination)
            outputs.push(
              ...extracted.map((file) =>
                path.join(destination, path.relative(stage, file))
              )
            )
            if (selected.password) successfulPassword = selected.password
          } finally {
            await rm(stage, { recursive: true, force: true })
          }
        }
        // No originals are recycled here. The caller first persists this complete result.
        return { files: outputs, password: successfulPassword, archives }
      } catch (error) {
        for (const directory of destinations)
          await rm(directory, { recursive: true, force: true })
        throw error
      }
    })
  }
}
