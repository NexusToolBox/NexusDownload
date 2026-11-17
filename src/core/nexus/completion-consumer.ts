import type { OccurrenceConsumer } from '@core/task/occurrences/occurrence-dispatcher'
import { type DownloadTask, TaskStatus } from '@shared/types/task'

export function createNexusCompletionConsumer(options: {
  getTask: (id: string) => DownloadTask | undefined
  mark: (task: DownloadTask) => Promise<void>
  completed: (fileCount: number) => Promise<void>
}): OccurrenceConsumer {
  return async (occurrence) => {
    if (
      occurrence.type !== 'terminal' ||
      occurrence.toStatus !== TaskStatus.Completed
    )
      return
    const task = options.getTask(occurrence.taskId)
    if (!task) return
    await options.mark(task)
    await options.completed(task.fileCount)
  }
}
