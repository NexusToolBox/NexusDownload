import path from 'node:path'
import type { EventBus } from '@core/events/event-bus'
import { getLogger } from '@core/logger'
import type { SettingsManager } from '@core/settings/settings-manager'
import { isActiveDownload } from '@core/task/active-downloads'
import { Events } from '@shared/protocol/events'
import type { DownloadTask } from '@shared/types/task'
import { TaskStatus } from '@shared/types/task'
import { formatBytes } from '@shared/utils/format-bytes'
import {
  Menu,
  type Notification,
  nativeImage,
  nativeTheme,
  Tray,
} from 'electron'
import { i18n } from '../lib/i18n'
import { resolveDesktopBackgroundPolicy } from '../platform/desktop-background-policy'
import { createNexusNotification } from './notification-identity'
import { readWindowsTaskbarTheme } from './taskbar-theme'

export interface NexusWindowsTrayActions {
  getTasks(): DownloadTask[]
  getErrorCount(): number
  showMain(): void
  openAdd(): void
  pauseAll(): Promise<unknown>
  resumeAll(): Promise<unknown>
  quit(): void
  noticeShown(): boolean
  saveNoticeShown(): Promise<unknown>
}

export function setupNexusWindowsTray({
  eventBus,
  settingsManager,
  extraResourceDir,
  toggleMainWindow,
  actions,
}: {
  eventBus: EventBus
  settingsManager: SettingsManager
  extraResourceDir: string
  toggleMainWindow(): void
  actions: NexusWindowsTrayActions
}) {
  const log = getLogger('nexus-tray')
  const assets = path.join(extraResourceDir, 'nexus')
  const images = new Map<string, Electron.NativeImage>()
  let tray: Tray | null = null
  let lastIcon = ''
  let lastTooltip = ''
  let downloadSpeed = 0
  let disposed = false
  let showingNotice = false
  let notice: Notification | undefined
  let systemTheme = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
    ? 'dark'
    : 'light'
  let readingTheme = false
  async function syncSystemTheme() {
    if (disposed || readingTheme) return
    readingTheme = true
    try {
      const detected = await readWindowsTaskbarTheme()
      if (!disposed && detected) {
        systemTheme = detected
        refresh()
      }
    } finally {
      readingTheme = false
    }
  }
  const themeTimer = setInterval(() => void syncSystemTheme(), 5000)
  themeTimer.unref()

  const activeCount = () => actions.getTasks().filter(isActiveDownload).length
  const statusText = () =>
    i18n.t('nexus.tray.status', {
      count: activeCount(),
      speed: formatBytes(downloadSpeed),
    })

  function refresh() {
    if (!tray || disposed) return
    const state =
      actions.getErrorCount() > 0
        ? 'error'
        : activeCount() > 0
          ? 'downloading'
          : 'idle'
    const theme = systemTheme
    const key = `tray-${state}-${theme}-taskbar`
    if (key !== lastIcon) {
      let image = images.get(key)
      if (!image) {
        image = nativeImage.createFromPath(path.join(assets, `${key}.ico`))
        if (image.isEmpty())
          image = nativeImage.createFromPath(path.join(assets, 'app-icon.ico'))
        images.set(key, image)
      }
      tray.setImage(image)
      lastIcon = key
    }
    const tooltip = `NexusDownload · ${statusText()}`
    if (tooltip !== lastTooltip) {
      tray.setToolTip(tooltip)
      lastTooltip = tooltip
    }
  }

  function run(action: string, work: () => Promise<unknown>) {
    void work().catch(() => {
      log.warn({ action }, 'Windows tray action failed')
      const failure = createNexusNotification({
        title: i18n.t('nexus.v12.trayFailure'),
        body: i18n.t('nexus.actionFailed'),
        icon: path.join(assets, 'app-icon-64.png'),
      })
      failure.show()
    })
  }

  function buildMenu() {
    const active = activeCount()
    const paused = actions
      .getTasks()
      .some((task) => task.status === TaskStatus.Paused)
    const selectedMode = settingsManager.get().speedLimit.turtle
    return Menu.buildFromTemplate([
      { label: statusText(), enabled: false },
      { label: i18n.t('nexus.tray.showMain'), click: actions.showMain },
      {
        label: i18n.t('nexus.tray.newDownload'),
        click: () => actions.openAdd(),
      },
      { type: 'separator' },
      {
        label: i18n.t(
          active > 0 ? 'nexus.pauseAll' : 'menu.task.resumeAllTask'
        ),
        enabled: active > 0 || paused,
        click: () =>
          run(
            active > 0 ? 'pause-all' : 'resume-all',
            active > 0 ? actions.pauseAll : actions.resumeAll
          ),
      },
      {
        label: i18n.t('nexus.tray.speedMode'),
        submenu: (['off', 'on', 'auto'] as const).map((mode) => ({
          label: i18n.t(`nexus.tray.${mode}`),
          type: 'radio' as const,
          checked: selectedMode === mode,
          click: () =>
            run('speed-mode', () =>
              settingsManager.update({ speedLimit: { turtle: mode } })
            ),
        })),
      },
      { type: 'separator' },
      { label: i18n.t('tray.quit'), click: actions.quit },
    ])
  }

  function destroyTray() {
    tray?.removeAllListeners()
    tray?.destroy()
    tray = null
    lastIcon = ''
    lastTooltip = ''
  }

  function syncTray() {
    if (disposed) return
    const current = settingsManager.getApp()
    const policy = resolveDesktopBackgroundPolicy({
      platform: 'win32',
      runMode: current.runMode,
      lightweightMode: current.lightweightMode,
    })
    if (!policy.keepTray) {
      destroyTray()
      return
    }
    if (!tray) {
      // Windows permanently binds an unsigned executable's GUID to its first
      // path. A shared GUID prevents portable copies in new folders appearing.
      tray = new Tray(path.join(assets, 'app-icon.ico'))
      tray.on('click', toggleMainWindow)
      tray.on('right-click', () => {
        const menu = buildMenu()
        tray?.popUpContextMenu(menu)
      })
    }
    refresh()
  }

  function onStats(payload: unknown) {
    const speed = (payload as { totalDownloadSpeed?: number })
      .totalDownloadSpeed
    downloadSpeed =
      typeof speed === 'number' && Number.isFinite(speed)
        ? Math.max(0, speed)
        : 0
    refresh()
  }

  eventBus.on(Events.TaskUpdated, refresh)
  eventBus.on(Events.NexusWorkspaceChanged, refresh)
  eventBus.on(Events.SettingsChanged, syncTray)
  eventBus.on(Events.LocaleChanged, refresh)
  eventBus.on(Events.StatsUpdated, onStats)
  nativeTheme.on('updated', syncSystemTheme)
  syncTray()
  void syncSystemTheme()

  function dispose() {
    if (disposed) return
    disposed = true
    eventBus.off(Events.TaskUpdated, refresh)
    eventBus.off(Events.NexusWorkspaceChanged, refresh)
    eventBus.off(Events.SettingsChanged, syncTray)
    eventBus.off(Events.LocaleChanged, refresh)
    eventBus.off(Events.StatsUpdated, onStats)
    nativeTheme.off('updated', syncSystemTheme)
    clearInterval(themeTimer)
    notice?.close()
    destroyTray()
    images.clear()
  }

  return {
    prepareForQuit: dispose,
    destroy: dispose,
    showCloseNotice() {
      if (!tray || disposed || showingNotice || actions.noticeShown()) return
      showingNotice = true
      void actions
        .saveNoticeShown()
        .then(() => {
          if (disposed) return
          notice = createNexusNotification({
            title: i18n.t('nexus.v12.trayTitle'),
            body: i18n.t('nexus.v12.trayBody'),
            icon: path.join(assets, 'app-icon-64.png'),
          })
          notice.on('click', actions.showMain)
          notice.show()
        })
        .catch(() => {
          log.warn('Unable to persist the first tray notice')
        })
        .finally(() => {
          showingNotice = false
        })
    },
  }
}
