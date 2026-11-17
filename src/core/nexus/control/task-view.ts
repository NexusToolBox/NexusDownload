import { DownloadErrorCode } from '@shared/errors'
import type { ControlTask } from '@shared/schemas/nexus-control'
import type { DownloadTask } from '@shared/types/task'

/** No filenames, paths, request metadata, source text or raw errors cross here. */
export function controlTaskView(tasks: DownloadTask[]): ControlTask[] {
  return tasks
    .filter((t) => t.status !== 'removed')
    .map((t) => ({
      id: t.id,
      status: t.status,
      type: t.type,
      bytes: t.totalBytes,
      completed: t.downloadedBytes,
      speed: t.downloadSpeed,
      failure:
        t.status === 'error'
          ? t.errorMessage?.startsWith('cloud.') &&
            /^cloud\.(login|permission|rate|risk|expired|size|identity|space|network|playback)$/.test(
              t.errorMessage
            )
            ? t.errorMessage
            : t.errorCode &&
                Object.values(DownloadErrorCode).includes(t.errorCode)
              ? t.errorCode
              : 'download.failed'
          : null,
    }))
}
