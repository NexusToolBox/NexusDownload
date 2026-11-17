import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { InitSegment, MediaPart } from '@core/media/segment-plan'
import type {
  MediaJob,
  MediaTaskCoordinator,
} from '@core/task/media-task-coordinator'
import type { DownloadTask } from '@shared/types/task'
import writeFileAtomic from 'write-file-atomic'
import type { CredentialBroker } from '../cloud/credential-broker'

async function hashFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const identity = (part: InitSegment | MediaPart) =>
  createHash('sha256').update(JSON.stringify(part)).digest('hex')
/** Only completed, fsynced pieces with a matching plan and local SHA-256 can be reused. */
export const segmentCheckpoints = {
  async read(
    file: string,
    part: InitSegment | MediaPart
  ): Promise<number | null> {
    try {
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) return null
      const record = JSON.parse(await readFile(`${file}.complete.json`, 'utf8'))
      return record.identity === identity(part) &&
        record.bytes === stat.size &&
        record.hash === (await hashFile(file))
        ? stat.size
        : null
    } catch {
      return null
    }
  },
  async write(file: string, part: InitSegment | MediaPart) {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('media.integrity')
    await writeFileAtomic(
      `${file}.complete.json`,
      JSON.stringify({
        identity: identity(part),
        bytes: stat.size,
        hash: await hashFile(file),
      }),
      { mode: 0o600 }
    )
  },
  async reset(file: string) {
    for (const suffix of ['', '.aria2', '.complete.json']) {
      await unlink(`${file}${suffix}`).catch((e) => {
        if (e.code !== 'ENOENT') throw e
      })
    }
  },
}
type Saved = {
  id: string
  job: MediaJob
  paths: { tmpDir: string; mediaMetaPath: string }
}
/** Signed URLs, request headers and AES IVs stay in the existing encrypted broker. */
export class MediaRecovery {
  constructor(
    private broker: CredentialBroker,
    private tmpRoot: string
  ) {}
  private records(): Saved[] {
    return JSON.parse(
      this.broker.get('media-recovery') || '[]',
      (_key, value) => (value?.__iv ? new Uint8Array(value.__iv) : value)
    )
  }
  has(id: string) {
    return this.records().some((r) => r.id === id)
  }
  private encode(records: Saved[]) {
    return JSON.stringify(records, (_key, value) =>
      value instanceof Uint8Array ? { __iv: [...value] } : value
    )
  }
  async save(id: string, job: MediaJob, paths: Saved['paths']) {
    const { resume: _resume, ...plan } = job
    await this.broker.update('media-recovery', () =>
      this.encode([
        ...this.records().filter((r) => r.id !== id),
        { id, job: plan, paths },
      ])
    )
  }
  async remove(id: string) {
    await this.broker.update('media-recovery', () =>
      this.encode(this.records().filter((r) => r.id !== id))
    )
  }
  async restore(coordinator: MediaTaskCoordinator, tasks: DownloadTask[]) {
    for (const record of this.records()) {
      const task = tasks.find((t) => t.id === record.id)
      if (!task || task.status === 'completed' || task.status === 'removed') {
        await this.remove(record.id)
        continue
      }
      try {
        const canonical = await realpath(record.paths.tmpDir)
        const root = await realpath(this.tmpRoot)
        const rel = path.relative(root, canonical)
        if (
          !rel ||
          rel.startsWith('..') ||
          path.isAbsolute(rel) ||
          (await lstat(record.paths.tmpDir)).isSymbolicLink() ||
          path.resolve(record.job.saveDir) !== path.resolve(task.saveDir)
        )
          throw new Error('media.recovery')
        // Rejoin the saved queue's admission policy before doing any network IO.
        await coordinator.submit({
          ...record.job,
          taskId: task.id,
          startPaused: true,
          resume: record.paths,
        })
      } catch {
        task.status = 'error' as DownloadTask['status']
        task.errorMessage = 'media.recovery'
      }
    }
  }
}
