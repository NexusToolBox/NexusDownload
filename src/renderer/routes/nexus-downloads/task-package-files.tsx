import { CheckIcon, DownloadIcon, QueuedIcon } from '@renderer/components/icons'
import { useTaskFiles } from '@renderer/hooks/use-task-files'
import type { DownloadTask } from '@shared/types/task'
import { TaskStatus } from '@shared/types/task'
import { formatBytes } from '@shared/utils/format-bytes'
import { useTranslation } from 'react-i18next'

export function NexusPackageFiles({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const { files, loading } = useTaskFiles(
    task.id,
    task.status === TaskStatus.Downloading,
    task.engineTaskId
  )
  return (
    <section className="children" aria-label={task.name}>
      {loading && files.length === 0 && (
        <p className="package-hint">{t('nexus.loadingFiles')}</p>
      )}
      {files.map((file) => {
        const progress =
          file.progress ?? (file.size ? file.completedBytes / file.size : 0)
        const complete = progress >= 1
        const moving =
          task.status === TaskStatus.Downloading && file.selected && !complete
        return (
          <div className="row" key={file.index}>
            <div className="ft">
              {complete ? (
                <CheckIcon />
              ) : moving ? (
                <DownloadIcon />
              ) : (
                <QueuedIcon />
              )}
            </div>
            <div className="min-w-0">
              <div className="name" title={file.path}>
                {file.path.split(/[\\/]/).at(-1)}
              </div>
            </div>
            <div className={`speed${moving ? ' live' : ''}`}>
              {t(
                complete
                  ? 'nexus.status.completed'
                  : moving
                    ? 'nexus.status.downloading'
                    : 'nexus.status.queued'
              )}
            </div>
            <div className="pct">
              {complete || progress === 0
                ? formatBytes(file.size)
                : `${Math.round(progress * 100)}%`}
            </div>
            <span />
            <div
              className={`water ${complete ? 'done' : moving ? 'flow' : 'paused'}`}
            >
              <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          </div>
        )
      })}
      {!loading && files.length === 0 && (
        <p className="package-hint">{t('nexus.filesPending')}</p>
      )}
    </section>
  )
}
