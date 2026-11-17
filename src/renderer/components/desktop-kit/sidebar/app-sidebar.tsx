import appIcon from '@renderer/assets/nexus-app-icon.svg?url'
import {
  AdjustIcon,
  CloudIcon,
  DownloadIcon,
  MediaIcon,
  ServicesIcon,
} from '@renderer/components/icons'
import {
  Sidebar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@renderer/components/ui/sidebar'
import { useTaskList } from '@renderer/hooks/use-task-list'
import { useNexusDiskSpace } from '@renderer/routes/nexus-downloads/use-disk-space'
import { useQueues } from '@renderer/routes/nexus-settings/queue-settings'
import { TaskStatus } from '@shared/types/task'
import { formatBytes } from '@shared/utils/format-bytes'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

const ITEMS = [
  { to: '/downloads/all', key: 'downloads', icon: DownloadIcon },
  { to: '/cloud', key: 'cloud', icon: CloudIcon },
  { to: '/media', key: 'media', icon: MediaIcon },
  { to: '/services', key: 'services', icon: ServicesIcon },
  { to: '/settings', key: 'settings', icon: AdjustIcon },
] as const

export function AppSidebar() {
  const { t } = useTranslation()
  const { tasks } = useTaskList()
  const disk = useNexusDiskSpace()
  const workflow = useQueues()
  const drive = disk?.volume.replace(/[\\/:]/g, '') || '—'
  const used =
    disk?.totalBytes && disk.freeBytes !== null
      ? 100 * (1 - disk.freeBytes / disk.totalBytes)
      : 0
  const active = tasks.filter(
    (task) => task.status === TaskStatus.Downloading
  ).length
  return (
    <Sidebar collapsible="none" className="sidebar">
      <div className="brand app-drag">
        <img src={appIcon} alt="" />
        <b>NexusDownload</b>
      </div>
      <SidebarMenu className="nav">
        {ITEMS.map((item) => (
          <SidebarMenuItem key={item.key}>
            <NavLink to={item.to}>
              {({ isActive }) => (
                <SidebarMenuButton
                  render={<span />}
                  isActive={isActive}
                  className="nexus-nav-item"
                >
                  <item.icon />
                  <span>{t(`nexus.nav.${item.key}`)}</span>
                  {item.key === 'downloads' && active > 0 && (
                    <span className="badge">{active}</span>
                  )}
                </SidebarMenuButton>
              )}
            </NavLink>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      <div className="side-group">
        <h3>{t('nexus.queue')}</h3>
        {(workflow?.queues ?? [{ id: 'main', name: t('nexus.mainQueue') }]).map(
          (queue) => {
            const count = tasks.filter(
              (task) =>
                task.status === TaskStatus.Downloading &&
                (workflow?.members[task.id]?.queueId ?? 'main') === queue.id
            ).length
            return (
              <NavLink
                key={queue.id}
                to="/settings?section=queues"
                className="queue"
              >
                <span className={`dot${count === 0 ? ' idle' : ''}`} />
                <span className="queue-name">
                  {queue.id === 'main' &&
                  ['主队列', 'Main queue'].includes(queue.name)
                    ? t('nexus.mainQueue')
                    : queue.name}
                </span>
                <small>{count}</small>
              </NavLink>
            )
          }
        )}
      </div>
      <div className="side-foot">
        <div className="disk">
          <span>{t('nexus.diskAvailable', { drive })}</span>
          <b>
            {disk?.freeBytes !== null && disk?.freeBytes !== undefined
              ? formatBytes(disk.freeBytes)
              : t('nexus.diskUnavailable')}
          </b>
        </div>
        <div className="track">
          <i style={{ width: `${used}%` }} />
        </div>
      </div>
    </Sidebar>
  )
}
