import { createHash } from 'node:crypto'
import { recognizeSources } from '@core/nexus/source-recognizer'
import type { NexusWorkspace } from '@core/nexus/workspace'
import { i18n } from '@main/lib/i18n'
import type { WindowManager } from '@main/window/window-manager'
import { clipboard, Notification } from 'electron'
import { createNexusNotification } from './notification-identity'

/** Reads clipboard text only while enabled and the main window is in the background. */
export function startNexusClipboard(
  workspace: NexusWorkspace,
  windows: WindowManager,
  openAdd: (ids?: string[]) => void
): () => void {
  let lastHash = ''
  let notification: Notification | undefined
  let pending = ''
  let expires = 0
  let stopped = false
  let reading = false
  const timer = setInterval(async () => {
    if (reading) return
    if (
      !workspace.getPreferences().clipboardEnabled ||
      windows.get('main')?.isFocused()
    ) {
      pending = ''
      return
    }
    reading = true
    try {
      const value = (await clipboard.readText()).slice(0, 32768)
      if (
        stopped ||
        !workspace.getPreferences().clipboardEnabled ||
        windows.get('main')?.isFocused()
      )
        return
      const hash = createHash('sha256').update(value).digest('hex')
      if (hash === lastHash) {
        if (Date.now() > expires) pending = ''
        return
      }
      lastHash = hash
      if (!recognizeSources(value).length || !Notification.isSupported()) return
      pending = value
      expires = Date.now() + 120_000
      notification?.close()
      notification = createNexusNotification({
        title: i18n.t('nexus.v12.clipboardTitle'),
        body: i18n.t('nexus.v12.clipboardBody'),
        silent: true,
      })
      notification.on('click', () => {
        const input = pending
        pending = ''
        windows.show('main')
        if (!input || Date.now() > expires) {
          openAdd()
          return
        }
        void workspace
          .collect({ input })
          .then((result) => openAdd(result?.items.map((item) => item.id)))
          .catch(() => openAdd())
      })
      notification.show()
    } catch {
      /* Clipboard access can be unavailable while another app owns it. */
    } finally {
      reading = false
    }
  }, 1000)
  timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
    pending = ''
    notification?.close()
  }
}
