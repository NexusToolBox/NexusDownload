import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TaskFileRow } from '@core/session/motrix-database'
import { getBtPayloadPath } from '@core/task/bt-storage-layout'
import { type DownloadTask, TaskStatus } from '@shared/types/task'

export type NetworkMarkStatus =
  | 'marked'
  | 'failed'
  | 'policy-skipped'
  | 'unsupported'
  | 'disabled'
export async function markNetworkFile(
  file: string,
  policy: 'preserve' | 'skip',
  platform = process.platform
): Promise<NetworkMarkStatus> {
  if (platform !== 'win32') return 'unsupported'
  if (policy === 'skip') return 'policy-skipped'
  if (
    !path.isAbsolute(file) ||
    file.includes('\0') ||
    file.slice(path.parse(file).root.length).includes(':')
  )
    return 'failed'
  try {
    if (!(await lstat(file)).isFile()) return 'failed'
    const stream = `${file}:Zone.Identifier`
    const previous = await readFile(stream, 'utf8').catch(() => '')
    if (/^ZoneId=3\s*$/m.test(previous)) return 'marked'
    // Do not retain source URLs, signed parameters, referrers, or account information in ADS.
    await writeFile(stream, '[ZoneTransfer]\r\nZoneId=3\r\n', 'utf8')
    return 'marked'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOTSUP' || code === 'EINVAL' || code === 'ENOSYS'
      ? 'unsupported'
      : 'failed'
  }
}
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}
export class NexusNetworkMarker {
  private running = new Map<string, Promise<void>>()
  constructor(
    private options: {
      enabled: () => boolean
      policy: () => Promise<'preserve' | 'skip'>
      files: (taskId: string) => TaskFileRow[]
      record: (taskId: string, status: NetworkMarkStatus) => Promise<void>
    }
  ) {}
  mark(task: DownloadTask): Promise<void> {
    if (
      ![TaskStatus.Completed, TaskStatus.Seeding].includes(task.status) ||
      task.progress < 1
    )
      return Promise.resolve()
    const current = this.running.get(task.id)
    if (current) return current
    const operation = this.markComplete(task).finally(() =>
      this.running.delete(task.id)
    )
    this.running.set(task.id, operation)
    return operation
  }
  private async markComplete(task: DownloadTask): Promise<void> {
    if (!this.options.enabled()) return
    let status: NetworkMarkStatus = 'marked'
    try {
      const policy = await this.options.policy()
      const target =
        getBtPayloadPath(task) ||
        task.finalPath ||
        path.join(task.saveDir, task.finalName || task.filename || task.name)
      const info = await stat(target)
      if (info.isFile()) {
        if (task.totalBytes > 0 && info.size < task.totalBytes)
          status = 'failed'
        else status = await markNetworkFile(target, policy)
      } else if (info.isDirectory()) {
        const rows = this.options.files(task.id).filter((row) => row.selected)
        if (!rows.length) status = 'failed'
        const realRoot = await realpath(target)
        for (const row of rows) {
          const relative = path.isAbsolute(row.path)
            ? path.relative(
                inside(target, row.path) ? target : task.diskPath,
                row.path
              )
            : row.path
          const file = path.resolve(target, relative)
          if (!inside(target, file)) {
            status = 'failed'
            continue
          }
          try {
            const resolved = await realpath(file)
            const fileInfo = await stat(file)
            if (
              !inside(realRoot, resolved) ||
              !fileInfo.isFile() ||
              fileInfo.size !== row.size
            ) {
              status = 'failed'
              continue
            }
            const result = await markNetworkFile(file, policy)
            if (result !== 'marked' && status !== 'failed') status = result
          } catch {
            status = 'failed'
          }
        }
      } else status = 'failed'
    } catch {
      status = 'failed'
    }
    await this.options.record(task.id, status).catch(() => undefined)
  }
}
