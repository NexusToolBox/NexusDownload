import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@renderer/components/desktop-kit/nexus'
import { PlatformLogo } from '@renderer/components/desktop-kit/nexus/platform-logo'
import type { VirtualListHandle } from '@renderer/components/desktop-kit/virtual-list/types'
import { VirtualList } from '@renderer/components/desktop-kit/virtual-list/virtual-list'
import {
  AddIcon,
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ConfluenceIcon,
  DiscImageIcon,
  DocumentIcon,
  DownloadPauseIcon,
  FilesIcon,
  FolderIcon,
  InspectorIcon,
  MediaIcon,
  RefreshIcon,
  ResumeIcon,
  SoftwareIcon,
  UserIcon,
} from '@renderer/components/icons'
import { toast } from '@renderer/components/ui/toast'
import { useEngineDisplayStatus } from '@renderer/hooks/use-engine-display-status'
import { useTaskList } from '@renderer/hooks/use-task-list'
import { resolveFailureReason } from '@renderer/lib/failure-reason'
import { i18n } from '@renderer/lib/i18n'
import { openMagnetFileSelection } from '@renderer/lib/open-magnet-file-selection'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import type { CloudSnapshot } from '@shared/schemas/nexus-cloud'
import {
  type DownloadTask,
  TaskKind,
  TaskStatus,
  TaskType,
} from '@shared/types/task'
import { formatBytes } from '@shared/utils/format-bytes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { DownloadsPage } from '../downloads/downloads-page'
import { useRetryParametersStore } from '../downloads/inspector/retry-parameters-store'
import { SpeedLimitBadge } from '../downloads/speed-limit-badge'
import { cloudCall, useCloud } from '../nexus-cloud/cloud-client'
import { ExternalJobs, useExternalJobs } from '../nexus-media/external-jobs'
import { QueueTaskControl } from '../nexus-settings/queue-settings'
import { NexusUpdateBanner, NexusUpdatePill } from '../nexus-settings/update-ui'
import { DownloadPackages, usePackages } from './download-packages'
import { openNexusAdd } from './nexus-events'
import { NexusMoreMenu } from './nexus-more-menu'
import { ProcessingSteps } from './processing-steps'
import { NexusPackageFiles } from './task-package-files'
import { NexusTaskSpeedChart } from './task-speed-chart'
import { NexusTransferSpeed } from './transfer-speed'
import { useNexusWorkspace } from './use-workspace'

function runAction(operation: Promise<unknown>) {
  void operation.catch(() =>
    toast.add({ type: 'error', title: i18n.t('nexus.actionFailed') })
  )
}
function storageFailure(task: DownloadTask) {
  return ['DL_DISK_FULL', 'DL_FILE_WRITE_ERROR', 'DL_PATH_TOO_LONG'].includes(
    task.errorCode ?? ''
  )
}

function TaskGlyph({ task }: { task: DownloadTask }) {
  if (task.fileCount > 1) return <FolderIcon />
  if (/\.(mp4|mkv|mov|avi|webm|flv|ts|m4v|wmv)$/i.test(task.name))
    return <MediaIcon />
  if (/\.(zip|rar|7z|tar|gz|bz2|xz|zst|\d{3})$/i.test(task.name))
    return <ArchiveIcon />
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|epub|rtf)$/i.test(task.name))
    return <DocumentIcon />
  if (/\.(iso|img|vhdx?|vmdk|dmg)$/i.test(task.name)) return <DiscImageIcon />
  if (/\.(exe|msi|msix|appx|apk|bat)$/i.test(task.name)) return <SoftwareIcon />
  return <FilesIcon />
}

function sourceKey(task: DownloadTask) {
  return task.type === TaskType.Bt || task.type === TaskType.Magnet
    ? 'magnet'
    : 'direct'
}

function TaskRow({
  task,
  selected,
  onSelect,
  child = false,
  markFailed = false,
  cloud,
  expanded = false,
  onToggle,
  engineReady = true,
}: {
  task: DownloadTask
  selected: boolean
  onSelect(): void
  child?: boolean
  markFailed?: boolean
  cloud?: CloudSnapshot['tasks'][number]
  expanded?: boolean
  onToggle?(): void
  engineReady?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const moving =
    engineReady &&
    [
      TaskStatus.Downloading,
      TaskStatus.Finalizing,
      TaskStatus.Seeding,
    ].includes(task.status)
  const done = task.status === TaskStatus.Completed
  const failure =
    task.status === TaskStatus.Error
      ? resolveFailureReason(task, { t, exists: (key) => i18n.exists(key) })
      : null
  return (
    <div className={task.fileCount > 1 ? 'pkg' : undefined}>
      <div
        className={`row${child ? ' child' : ''}`}
        role="option"
        id={`nexus-task-${task.id}`}
        tabIndex={selected ? 0 : -1}
        aria-selected={selected}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect()
          }
        }}
      >
        <div className="ft">
          <TaskGlyph task={task} />
        </div>
        <div className="min-w-0">
          <div className="name" title={task.name}>
            {task.name}
          </div>
          <div className="meta">
            {failure && !cloud?.reason && (
              <span className="chip error" title={failure.hint ?? undefined}>
                {failure.reason}
              </span>
            )}
            {markFailed && (
              <span className="task-error">
                {t('nexus.networkMark.failed')}
              </span>
            )}
            <span className="chip">
              {cloud && <PlatformLogo platform={cloud.platform} small />}
              {cloud
                ? t(`nexus.platform.${cloud.platform}`)
                : t(`nexus.source.${sourceKey(task)}`)}
            </span>
            {cloud?.reason && (
              <span className="chip error">
                {t(`nexus.cloudError.${cloud.reason}`)}
              </span>
            )}
            <span>
              {task.totalBytes > 0
                ? formatBytes(task.totalBytes)
                : t('nexus.v12.downloadedUnknown', {
                    size: formatBytes(task.downloadedBytes),
                  })}
            </span>
            <span>
              {task.fileCount > 1
                ? t('nexus.files', { count: task.fileCount })
                : t(`nexus.status.${task.status}`)}
            </span>
          </div>
        </div>
        <div className={`speed${moving ? ' live' : ''}`}>
          {moving && task.downloadSpeed > 0
            ? `${formatBytes(engineReady ? task.downloadSpeed : 0)}/s`
            : t(
                task.status === TaskStatus.Error
                  ? 'nexus.v12.stopped'
                  : !engineReady && task.status === TaskStatus.Downloading
                    ? 'nexus.v14.waitingEngine'
                    : `nexus.status.${task.status}`
              )}
          <small>
            {engineReady &&
            task.status === TaskStatus.Downloading &&
            task.etaSeconds > 0
              ? t('nexus.remaining', {
                  minutes: Math.ceil(task.etaSeconds / 60),
                })
              : moving && task.totalBytes <= 0
                ? t('nexus.v12.unknownEta')
                : ''}
          </small>
        </div>
        <div className="pct">
          {done ? (
            <CheckIcon className="completed-check" />
          ) : task.totalBytes <= 0 && task.status !== TaskStatus.Error ? (
            '—'
          ) : (
            `${Math.round(task.progress * 100)}%`
          )}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="act"
          aria-label={t(
            task.fileCount > 1
              ? 'nexus.togglePackage'
              : done
                ? 'nexus.reveal'
                : moving
                  ? 'nexus.pause'
                  : task.status === TaskStatus.Error ||
                      task.status === TaskStatus.MetadataReady
                    ? task.status === TaskStatus.MetadataReady
                      ? 'nexus.v13.selectFiles'
                      : cloud?.reason === 'login' ||
                          cloud?.reason === 'login-elsewhere'
                        ? 'nexus.cloudV3.reauthorize'
                        : storageFailure(task)
                          ? 'nexus.v13.changeLocation'
                          : cloud &&
                              ['size', 'identity', 'checkpoint'].includes(
                                cloud.reason ?? ''
                              )
                            ? 'nexus.v14.redownload'
                            : 'nexus.retry'
                    : 'nexus.resume'
          )}
          aria-expanded={task.fileCount > 1 ? expanded : undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (task.fileCount > 1) onToggle?.()
            else if (task.status === TaskStatus.MetadataReady)
              runAction(openMagnetFileSelection(task.id))
            else if (task.status === TaskStatus.Error) {
              if (
                cloud?.reason === 'login' ||
                cloud?.reason === 'login-elsewhere'
              )
                navigate(
                  `/cloud?platform=${cloud.platform}&account=${cloud.accountId ?? ''}`
                )
              else if (storageFailure(task))
                useRetryParametersStore.getState().openWith([task])
              else runAction(transport.invoke(Commands.RetryTasks, [task.id]))
            } else
              runAction(
                transport.invoke(
                  done
                    ? Commands.RevealInFolder
                    : moving
                      ? Commands.PauseTask
                      : Commands.ResumeTask,
                  task.id
                )
              )
          }}
        >
          {task.fileCount > 1 ? (
            <ChevronDownIcon />
          ) : done ? (
            <FolderIcon />
          ) : moving ? (
            <DownloadPauseIcon />
          ) : task.status === TaskStatus.Error ||
            task.status === TaskStatus.MetadataReady ? (
            <ChevronRightIcon />
          ) : (
            <ResumeIcon />
          )}
        </Button>
        <div
          className={
            'water ' +
            (done
              ? 'done'
              : task.status === TaskStatus.Error
                ? 'err'
                : moving
                  ? task.totalBytes > 0
                    ? 'flow'
                    : 'indet'
                  : 'paused')
          }
        >
          <i
            style={{
              width:
                task.status === TaskStatus.Error
                  ? '100%'
                  : task.totalBytes <= 0
                    ? undefined
                    : `${Math.min(100, Math.max(0, task.progress * 100))}%`,
            }}
          />
        </div>
      </div>
      {expanded && <NexusPackageFiles task={task} />}
    </div>
  )
}

function TaskInspector({
  task,
  engineReady,
}: {
  task: DownloadTask
  engineReady: boolean
}) {
  const { t } = useTranslation()
  const workspace = useNexusWorkspace()
  const binding = workspace?.bindings.find((item) => item.taskId === task.id)
  const cloudState = useCloud()
  const cloud = cloudState?.tasks.find((item) => item.taskId === task.id)
  const markStatus =
    workspace?.preferences.markInternet === false
      ? 'disabled'
      : workspace?.networkMarks[task.id]
  const markFailed = markStatus === 'failed'
  const navigate = useNavigate()
  const done = task.status === TaskStatus.Completed
  const failure =
    task.status === TaskStatus.Error
      ? resolveFailureReason(task, { t, exists: (key) => i18n.exists(key) })
      : null
  const needsAttention = [TaskStatus.Error, TaskStatus.MetadataReady].includes(
    task.status
  )
  const accountAction =
    cloud?.accountId &&
    cloud.reason &&
    ['permission', 'captcha', 'risk', 'login', 'login-elsewhere'].includes(
      cloud.reason
    )
      ? cloud.reason === 'permission'
        ? 'checkAccount'
        : ['captcha', 'risk'].includes(cloud.reason)
          ? 'verify'
          : 'login'
      : undefined
  const moving =
    engineReady &&
    [TaskStatus.Downloading, TaskStatus.Seeding].includes(task.status)
  return (
    <aside className="inspector">
      <div className="ins-scroll">
        <div className="ins-top">
          <div className="ft">
            <TaskGlyph task={task} />
          </div>
          <div>
            <h2 className="ins-title">{task.name}</h2>
            <small className="ins-sub">
              {t(
                cloud?.kind === 'playback-stream' ||
                  task.kind === TaskKind.Hls ||
                  task.kind === TaskKind.Mux
                  ? 'nexus.playbackStream'
                  : 'nexus.originalFile'
              )}
            </small>
          </div>
        </div>
        {done && (
          <div className="nx-completed-summary">
            <p>
              {t('nexus.status.completed')} ·{' '}
              {formatBytes(task.totalBytes || task.downloadedBytes)}
            </p>
            {task.finishedAt && (
              <time dateTime={new Date(task.finishedAt).toISOString()}>
                {new Date(task.finishedAt).toLocaleString(
                  i18n.resolvedLanguage
                )}
              </time>
            )}
          </div>
        )}
        {!failure && !done && (
          <>
            <div className="bignum">
              <b>
                {task.totalBytes > 0 ? Math.round(task.progress * 100) : '—'}
              </b>
              <span>{task.totalBytes > 0 ? '%' : ''}</span>
              <span className="r">
                {formatBytes(task.downloadedBytes)} /{' '}
                {task.totalBytes > 0
                  ? formatBytes(task.totalBytes)
                  : t('nexus.v12.unknownSize')}
              </span>
            </div>
            <div
              className={`bar ${task.totalBytes <= 0 && moving ? 'indet' : ''}`}
            >
              <i style={{ width: `${task.progress * 100}%` }} />
            </div>
            <div className="spark">
              <b>{formatBytes(engineReady ? task.downloadSpeed : 0)}/s</b>
              <span>
                {engineReady &&
                task.status === TaskStatus.Downloading &&
                task.etaSeconds > 0
                  ? t('nexus.remaining', {
                      minutes: Math.ceil(task.etaSeconds / 60),
                    })
                  : t(
                      !engineReady && task.status === TaskStatus.Downloading
                        ? 'nexus.v14.waitingEngine'
                        : `nexus.status.${task.status}`
                    )}
              </span>
            </div>
            {moving && <NexusTaskSpeedChart taskId={task.id} />}
          </>
        )}
        <div className="hr" />
        <dl className="facts">
          <dt>{t('nexus.fact.source')}</dt>
          <dd>
            {cloud ? (
              t(`nexus.platform.${cloud.platform}`)
            ) : binding ? (
              <>
                {t(`nexus.platform.${binding.source.platform}`)}
                <small>{binding.source.host}</small>
              </>
            ) : (
              t(`nexus.source.${sourceKey(task)}`)
            )}
          </dd>
          <dt>{t('nexus.fact.account')}</dt>
          <dd>
            {cloud?.accountId
              ? t('nexus.cloudV2.accountNumber', {
                  count:
                    (cloudState?.accounts
                      .filter((a) => a.platform === cloud.platform)
                      .findIndex((a) => a.id === cloud.accountId) ?? -1) + 1,
                })
              : t('nexus.noAccount')}
          </dd>
          <dt>{t('nexus.fact.resolve')}</dt>
          <dd>
            {cloud
              ? t(`nexus.cloudV2.method.${cloud.method}`)
              : t('nexus.directResolve')}
          </dd>
          <dt>{t('nexus.fact.route')}</dt>
          <dd>{t('nexus.localRoute')}</dd>
          <dt>{t('nexus.fact.save')}</dt>
          <dd className="save-path" title={task.saveDir}>
            {task.saveDir}
          </dd>
          {markFailed && (
            <>
              <dt>{t('nexus.networkMark.label')}</dt>
              <dd>{t(`nexus.networkMark.${markStatus}`)}</dd>
            </>
          )}
        </dl>
        {cloud?.reason && (
          <p className="task-error" role="alert">
            {t(`nexus.cloudError.${cloud.reason}`)}
          </p>
        )}
        {cloud && cloud.phase !== 'ready' && cloud.phase !== 'blocked' && (
          <p role="status">{t('nexus.cloudV2.renewing')}</p>
        )}
        {cloud && !done && !cloud.reason && (
          <Button
            onClick={() =>
              runAction(transport.invoke(Commands.ResumeTask, task.id))
            }
          >
            {t('nexus.cloudV2.renewNow')}
          </Button>
        )}
        {failure && !cloud?.reason && (
          <div className="task-error task-failure" role="alert">
            <strong>{failure.reason}</strong>
          </div>
        )}
        <div className="hr" />
        {!failure && !done && (
          <ol className="steps">
            <li className="done">
              <span className="mk">
                <CheckIcon />
              </span>
              {t('nexus.stage.identify')}
            </li>
            <li
              className={
                moving
                  ? 'now'
                  : task.status === TaskStatus.Completed
                    ? 'done'
                    : ''
              }
            >
              <span className="mk">
                {task.status === TaskStatus.Completed && <CheckIcon />}
              </span>
              {t('nexus.stage.download')}
              <small>
                {task.totalBytes > 0
                  ? `${Math.round(task.progress * 100)}%`
                  : t('nexus.v12.unknownSize')}
              </small>
            </li>
          </ol>
        )}
        {!failure && <ProcessingSteps taskId={task.id} completed={done} />}
      </div>
      <div className="ins-actions">
        <Button
          variant="primary"
          onClick={() => {
            if (accountAction && cloud) {
              if (accountAction === 'checkAccount')
                runAction(cloudCall(Commands.NexusCloudHealth, cloud.accountId))
              else if (cloud.platform !== 'aliyun')
                runAction(
                  cloudCall(Commands.NexusCloudLogin, {
                    accountId: cloud.accountId,
                    credentials: cloud.platform,
                  })
                )
              else navigate(`/settings?section=accounts`)
            } else if (markFailed)
              runAction(
                transport.invoke(Commands.NexusRetryNetworkMark, task.id)
              )
            else if (task.status === TaskStatus.MetadataReady)
              runAction(openMagnetFileSelection(task.id))
            else if (needsAttention) {
              if (
                cloud?.reason === 'login' ||
                cloud?.reason === 'login-elsewhere'
              )
                navigate(
                  `/cloud?platform=${cloud.platform}&account=${cloud.accountId ?? ''}`
                )
              else if (storageFailure(task))
                useRetryParametersStore.getState().openWith([task])
              else runAction(transport.invoke(Commands.RetryTasks, [task.id]))
            } else
              runAction(
                transport.invoke(
                  done
                    ? Commands.RevealInFolder
                    : moving
                      ? Commands.PauseTask
                      : Commands.ResumeTask,
                  task.id
                )
              )
          }}
        >
          {moving ? (
            <DownloadPauseIcon />
          ) : done || storageFailure(task) ? (
            <FolderIcon />
          ) : needsAttention ? (
            cloud?.reason === 'login' || cloud?.reason === 'login-elsewhere' ? (
              <UserIcon />
            ) : (
              <RefreshIcon />
            )
          ) : (
            <ResumeIcon />
          )}
          {t(
            accountAction
              ? accountAction === 'login'
                ? 'nexus.cloudV2.login'
                : `nexus.v14.${accountAction}`
              : markFailed
                ? 'nexus.networkMark.retry'
                : done
                  ? 'nexus.reveal'
                  : needsAttention
                    ? task.status === TaskStatus.MetadataReady
                      ? 'nexus.v13.selectFiles'
                      : cloud?.reason === 'login' ||
                          cloud?.reason === 'login-elsewhere'
                        ? 'nexus.cloudV3.reauthorize'
                        : storageFailure(task)
                          ? 'nexus.v13.changeLocation'
                          : 'nexus.retry'
                    : moving
                      ? 'nexus.pause'
                      : 'nexus.resume'
          )}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('nexus.reveal')}
          onClick={() =>
            runAction(transport.invoke(Commands.RevealInFolder, task.id))
          }
        >
          <FolderIcon />
        </Button>
        <NexusMoreMenu
          taskId={task.id}
          source={task.bt?.magnetUri || task.uris[0]}
        />
      </div>
    </aside>
  )
}

export function NexusDownloadsPage() {
  const { t } = useTranslation()
  const { tasks, status, retry } = useTaskList()
  const packages = usePackages()
  const externalJobs = useExternalJobs()
  const packageMembers = useMemo(
    () => new Set(packages.flatMap((p) => p.taskIds)),
    [packages]
  )
  const workspace = useNexusWorkspace()
  const cloud = useCloud()
  const navigate = useNavigate()
  const { state: engineState } = useEngineDisplayStatus()
  const accountIssues =
    cloud?.accounts.filter(
      (a) => a.health?.login === 'expired' || a.reason || a.needsLocalLogin
    ) ?? []
  const [params] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    const task = params.get('task')
    if (task) setSelected(task)
  }, [params])
  const [inspector, setInspector] = useState(true)
  const [sort, setSort] = useState('added')
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(
    new Set()
  )
  const listRef = useRef<VirtualListHandle>(null)
  const sorted = useMemo(
    () =>
      [...tasks]
        .filter(
          (task) =>
            task.status !== TaskStatus.Removed && !packageMembers.has(task.id)
        )
        .sort((a, b) => {
          const rank = (task: DownloadTask) =>
            task.status === TaskStatus.Error ||
            task.status === TaskStatus.MetadataReady ||
            (workspace?.preferences.markInternet !== false &&
              workspace?.networkMarks[task.id] === 'failed')
              ? 0
              : task.status === TaskStatus.Completed
                ? 3
                : task.status === TaskStatus.Paused ||
                    task.status === TaskStatus.Queued
                  ? 2
                  : 1
          const priority = rank(a) - rank(b)
          if (priority) return priority
          if (rank(a) === 3) {
            const day = (task: DownloadTask) =>
              new Date(task.finishedAt ?? task.createdAt).setHours(0, 0, 0, 0)
            const dateOrder = day(b) - day(a)
            if (dateOrder) return dateOrder
          }
          return (
            (sort === 'name'
              ? a.name.localeCompare(b.name, undefined, { numeric: true })
              : sort === 'size'
                ? b.totalBytes - a.totalBytes
                : sort === 'oldest'
                  ? a.createdAt - b.createdAt
                  : b.createdAt - a.createdAt) || a.id.localeCompare(b.id)
          )
        }),
    [
      tasks,
      sort,
      workspace?.networkMarks,
      workspace?.preferences.markInternet,
      packageMembers,
    ]
  )
  const counts = {
    all: sorted.length,
    active: sorted.filter((task) =>
      [
        TaskStatus.Downloading,
        TaskStatus.Seeding,
        TaskStatus.Finalizing,
        TaskStatus.FetchingMetadata,
      ].includes(task.status)
    ).length,
    waiting: sorted.filter((task) =>
      [TaskStatus.Paused, TaskStatus.Queued].includes(task.status)
    ).length,
    completed: sorted.filter((task) => task.status === TaskStatus.Completed)
      .length,
    attention: sorted.filter(
      (task) =>
        (workspace?.preferences.markInternet !== false &&
          workspace?.networkMarks[task.id] === 'failed') ||
        [TaskStatus.Error, TaskStatus.MetadataReady].includes(task.status)
    ).length,
  }
  const visible = sorted.filter(
    (task) =>
      filter === 'all' ||
      (filter === 'active' &&
        [
          TaskStatus.Downloading,
          TaskStatus.Seeding,
          TaskStatus.Finalizing,
          TaskStatus.FetchingMetadata,
        ].includes(task.status)) ||
      (filter === 'waiting' &&
        [TaskStatus.Paused, TaskStatus.Queued].includes(task.status)) ||
      (filter === 'completed' && task.status === TaskStatus.Completed) ||
      (filter === 'attention' &&
        ((workspace?.preferences.markInternet !== false &&
          workspace?.networkMarks[task.id] === 'failed') ||
          [TaskStatus.Error, TaskStatus.MetadataReady].includes(task.status)))
  )
  const current = tasks.find((task) => task.id === selected) ?? visible[0]
  const group = (task: DownloadTask | undefined) => {
    if (!task) return ''
    if (
      (workspace?.preferences.markInternet !== false &&
        workspace?.networkMarks[task.id] === 'failed') ||
      [TaskStatus.Error, TaskStatus.MetadataReady].includes(task.status)
    )
      return 'attention'
    if ([TaskStatus.Paused, TaskStatus.Queued].includes(task.status))
      return 'waiting'
    if (task.status === TaskStatus.Completed)
      return new Date(task.finishedAt ?? task.createdAt).toDateString()
    return 'active'
  }
  if (params.get('view') === 'classic') return <DownloadsPage />
  return (
    <div
      className={`page on${sorted.length === 0 && packages.length === 0 && externalJobs.length === 0 ? ' show-empty' : ''}`}
    >
      <NexusUpdateBanner />
      <header className="phead">
        <h1>{t('nexus.nav.downloads')}</h1>
        <div className="spacer" />
        <Button
          variant="ghost"
          className="addbar"
          onClick={() => openNexusAdd()}
        >
          <AddIcon />
          <span>{t('nexus.addPlaceholder')}</span>
          <kbd>Ctrl K</kbd>
        </Button>
        <div className="pillgroup">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('nexus.pauseAll')}
            onClick={() => runAction(transport.invoke(Commands.PauseAllTasks))}
          >
            <DownloadPauseIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('nexus.toggleInspector')}
            aria-pressed={inspector}
            onClick={() => setInspector((value) => !value)}
          >
            <InspectorIcon />
          </Button>
          <NexusMoreMenu />
        </div>
      </header>
      <div className="filters">
        <div className="seg">
          {Object.entries(counts).map(([key, count]) => (
            <Button
              key={key}
              variant="ghost"
              className={
                key === 'attention' && counts.attention > 0 ? 'err' : ''
              }
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(`nexus.filter.${key}`)}
              <em>{count}</em>
            </Button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="sortby"
                aria-label={t('nexus.sortLabel')}
              />
            }
          >
            {t(sort === 'added' ? 'nexus.sortAdded' : `nexus.sort.${sort}`)}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => setSort(value)}
            >
              {['added', 'oldest', 'name', 'size'].map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {t(`nexus.sort.${value}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {sorted.length === 0 &&
      packages.length === 0 &&
      externalJobs.length === 0 ? (
        <div className="empty">
          <ConfluenceIcon className="glyph" />
          <h2
            role={status === 'loading' ? 'status' : undefined}
            aria-busy={status === 'loading'}
          >
            {t(
              status === 'error'
                ? 'nexus.unavailable'
                : status === 'loading'
                  ? 'nexus.loadingTasks'
                  : 'nexus.emptyTitle'
            )}
          </h2>
          <Button
            variant="primary"
            className="empty-add"
            onClick={() => (status === 'error' ? void retry() : openNexusAdd())}
          >
            <AddIcon />
            {t(status === 'error' ? 'nexus.retry' : 'nexus.addDownload')}
          </Button>
        </div>
      ) : (
        <div className="split">
          <div className="nexus-task-area">
            <DownloadPackages onSelect={setSelected} />
            <QueueTaskControl taskId={current?.id} />
            <ExternalJobs exclude={[...packageMembers]} />
            <VirtualList
              ref={listRef}
              items={visible}
              getId={(task) => task.id}
              rowHeight={68}
              measureRows
              className="list"
              activeIndex={visible.findIndex((task) => task.id === current?.id)}
              containerProps={{
                role: 'listbox',
                'aria-label': t('nexus.taskList'),
                tabIndex: 0,
                'aria-activedescendant': current
                  ? `nexus-task-${current.id}`
                  : undefined,
                onKeyDown: (event) => {
                  if (
                    !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                      event.key
                    ) ||
                    !visible.length
                  )
                    return
                  if ((event.target as HTMLElement).closest('button')) return
                  event.preventDefault()
                  const index = visible.findIndex(
                    (task) => task.id === current?.id
                  )
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? visible.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              visible.length - 1,
                              index + (event.key === 'ArrowDown' ? 1 : -1)
                            )
                          )
                  setSelected(visible[next].id)
                  listRef.current?.scrollToIndex(next)
                },
              }}
              renderEmpty={() => (
                <div className="nexus-filter-empty">
                  <p>{t('nexus.noMatchingTasks')}</p>
                  <Button variant="ghost" onClick={() => setFilter('all')}>
                    {t('nexus.filter.all')}
                  </Button>
                </div>
              )}
              renderRow={({ item: task, index }) => {
                const key = group(task),
                  previous = group(visible[index - 1])
                const label =
                  key === 'waiting'
                    ? t('nexus.waitingGroup')
                    : task.status === TaskStatus.Completed &&
                        key !== 'attention'
                      ? key === new Date().toDateString()
                        ? t('nexus.completedGroup')
                        : t('nexus.completedDate', {
                            date: new Date(
                              task.finishedAt ?? task.createdAt
                            ).toLocaleDateString(),
                          })
                      : ''
                return (
                  <div>
                    {key !== previous && label && (
                      <div className="list-section">{label}</div>
                    )}
                    <TaskRow
                      engineReady={engineState === 'ready'}
                      task={task}
                      cloud={cloud?.tasks.find(
                        (item) => item.taskId === task.id
                      )}
                      markFailed={
                        workspace?.preferences.markInternet !== false &&
                        workspace?.networkMarks[task.id] === 'failed'
                      }
                      selected={current?.id === task.id}
                      onSelect={() => setSelected(task.id)}
                      expanded={expandedPackages.has(task.id)}
                      onToggle={() =>
                        setExpandedPackages((old) => {
                          const next = new Set(old)
                          if (next.has(task.id)) next.delete(task.id)
                          else next.add(task.id)
                          return next
                        })
                      }
                    />
                  </div>
                )
              }}
            />
          </div>
          {inspector && current && (
            <TaskInspector
              task={current}
              engineReady={engineState === 'ready'}
            />
          )}
        </div>
      )}
      <footer className="statusbar">
        <SpeedLimitBadge nexus />
        <NexusTransferSpeed />
        <div className="spacer" />
        <NexusUpdatePill />
        {accountIssues.length > 0 && (
          <Button
            variant="quiet"
            className="spill nx-account-warning"
            onClick={() =>
              navigate(
                `/cloud?platform=${accountIssues[0].platform}&account=${accountIssues[0].id}`
              )
            }
          >
            {accountIssues.length === 1
              ? t('nexus.v13.accountIssue', {
                  platform: t(`nexus.platform.${accountIssues[0].platform}`),
                })
              : t('nexus.v13.accountIssues', { count: accountIssues.length })}
          </Button>
        )}
        {engineState !== 'ready' && (
          <Button
            variant="quiet"
            className={`spill nx-engine-status ${engineState}`}
            disabled={
              engineState === 'starting' || engineState === 'reconnecting'
            }
            onClick={() => runAction(transport.invoke(Commands.RestartEngine))}
          >
            <i aria-hidden="true" />
            {t(
              engineState === 'starting' || engineState === 'reconnecting'
                ? 'nexus.v13.engineStarting'
                : 'nexus.v13.engineStopped'
            )}
          </Button>
        )}
      </footer>
    </div>
  )
}
