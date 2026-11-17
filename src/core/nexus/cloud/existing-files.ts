import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { type DownloadTask, TaskStatus } from '@shared/types/task'
import type { AdapterFile } from './cloud-adapter'
import { safeCloudName } from './cloud-path'

const hashWorker = `
const { parentPort, workerData } = require('node:worker_threads');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
(async () => {
  const hash = createHash(workerData.algorithm);
  for await (const chunk of createReadStream(workerData.path)) hash.update(chunk);
  parentPort.postMessage(hash.digest('hex'));
})().catch(() => parentPort.postMessage(null));`

export function platformHash(value?: string) {
  const match = /^(md5|sha1|sha256):([a-f0-9]+)$/i.exec(value ?? '')
  if (
    match &&
    match[2].length ===
      { md5: 32, sha1: 40, sha256: 64 }[match[1].toLowerCase()]
  )
    return { algorithm: match[1].toLowerCase(), hex: match[2].toLowerCase() }
  // v0.2 adapters expose only their actual md5 field without a prefix.
  if (/^[a-f0-9]{32}$/i.test(value ?? ''))
    return { algorithm: 'md5', hex: value?.toLowerCase() }
  return null
}

export class ExistingFileDetector {
  private cache = new Map<string, string>()
  private async digest(file: string, algorithm: string, stamp: string) {
    const key = `${file}:${algorithm}:${stamp}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const result = await new Promise<string | null>((resolve) => {
      const worker = new Worker(hashWorker, {
        eval: true,
        workerData: { path: file, algorithm },
      })
      const finish = (value: string | null) => {
        clearTimeout(timer)
        void worker.terminate()
        resolve(value)
      }
      const timer = setTimeout(() => finish(null), 300000)
      worker.once('message', finish)
      worker.once('error', () => finish(null))
      worker.once('exit', () => finish(null))
    })
    if (result) {
      if (this.cache.size >= 256) this.cache.clear()
      this.cache.set(key, result)
    }
    return result
  }
  async find(
    file: AdapterFile,
    parents: string[],
    root: string,
    tasks: DownloadTask[]
  ) {
    if (file.bytes === null) return null
    const target = path.resolve(
      root,
      ...parents.map(safeCloudName),
      safeCloudName(file.name)
    )
    const hash = platformHash(file.hash)
    const candidates = new Map<string, boolean>([[target, false]])
    for (const task of tasks) {
      if (
        task.status !== TaskStatus.Completed ||
        task.totalBytes !== file.bytes
      )
        continue
      const output = task.finalPath || task.diskPath
      if (
        output &&
        (hash ||
          path.basename(output).toLowerCase() === file.name.toLowerCase())
      )
        candidates.set(output, true)
    }
    for (const [output, history] of candidates) {
      if (/(?:\.motrix|\.aria2|\.part)$/i.test(output)) continue
      if (
        tasks.some(
          (t) =>
            t.status !== TaskStatus.Completed &&
            t.status !== TaskStatus.Removed &&
            [t.diskPath, t.finalPath].includes(output)
        )
      )
        continue
      if (await lstat(`${output}.aria2`).catch(() => null)) continue
      const info = await lstat(output).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink() || info.size !== file.bytes)
        continue
      if (hash) {
        const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
        const digest = await this.digest(output, hash.algorithm, stamp)
        const after = await lstat(output).catch(() => null)
        if (
          digest !== hash.hex ||
          !after ||
          `${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== stamp
        )
          continue
      }
      return {
        path: output,
        basis: hash
          ? history
            ? 'history-hash'
            : 'hash'
          : history
            ? 'history-name-size'
            : 'name-size',
      }
    }
    return null
  }
}
