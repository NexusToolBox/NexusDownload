import { statfsSync, statSync } from 'node:fs'
import path from 'node:path'
import { AppError, ErrorCode } from '@shared/errors'
import type { NexusDiskSpace } from '@shared/schemas/nexus-disk'

/** Probe the closest existing parent without creating directories. */
export function getNexusDiskSpace(directory: string): NexusDiskSpace {
  if (!path.isAbsolute(directory) || directory.includes('\0')) {
    throw new AppError(ErrorCode.IpcInvalidPayload, 'nexus.invalidDirectory')
  }
  const resolved = path.resolve(directory)
  let parent = resolved
  const result: NexusDiskSpace = {
    directory: resolved,
    volume: path.parse(resolved).root,
    freeBytes: null,
    totalBytes: null,
  }
  for (;;) {
    try {
      if (!statSync(parent).isDirectory()) {
        throw new AppError(
          ErrorCode.IpcInvalidPayload,
          'nexus.invalidDirectory'
        )
      }
      const disk = statfsSync(parent)
      result.freeBytes = Math.max(0, disk.bavail * disk.bsize)
      result.totalBytes = Math.max(0, disk.blocks * disk.bsize)
      return result
    } catch (error) {
      if (error instanceof AppError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return result
      const next = path.dirname(parent)
      if (next === parent) return result
      parent = next
    }
  }
}
