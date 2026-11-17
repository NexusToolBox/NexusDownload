import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_ID, APP_NAME } from '@shared/constants'
import { app, Notification, shell } from 'electron'

let enabled = () => true
let iconPath = ''
let registeredIcon: string | undefined

/** Windows can cache Electron's display name even when the shortcut has an AUMID. */
function registerNotificationIdentity(install: boolean): void {
  const icon = iconPath || process.execPath
  if (registeredIcon === (install ? icon : '')) return
  const registry = path.win32.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'reg.exe'
  )
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`
  const options = { windowsHide: true, timeout: 2000, stdio: 'ignore' as const }
  if (install) {
    for (const [name, value] of [
      ['DisplayName', APP_NAME],
      ['IconUri', pathToFileURL(icon).href],
    ])
      execFileSync(
        registry,
        ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f', '/reg:64'],
        options
      )
  } else {
    try {
      execFileSync(registry, ['delete', key, '/f', '/reg:64'], options)
    } catch {
      // An absent registration already satisfies opt-out.
    }
  }
  registeredIcon = install ? icon : ''
}
export function configureNexusNotifications(
  readEnabled: () => boolean,
  icon: string
) {
  enabled = readEnabled
  iconPath = icon
  syncNotificationShortcut()
}
function shortcutPath() {
  return path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'NexusDownload.lnk'
  )
}
export function syncNotificationShortcut(create = false): boolean {
  if (process.platform !== 'win32') return true
  try {
    const file = shortcutPath()
    if (!enabled()) {
      if (existsSync(file)) unlinkSync(file)
      registerNotificationIdentity(false)
      return true
    }
    if (!create && !existsSync(file)) return true
    registerNotificationIdentity(true)
    mkdirSync(path.dirname(file), { recursive: true })
    const target = process.execPath
    const options = {
      target,
      cwd: path.dirname(target),
      appUserModelId: APP_ID,
      icon: iconPath || target,
      iconIndex: 0,
      description: APP_NAME,
      args: app.isPackaged ? '' : app.getAppPath(),
    }
    if (existsSync(file)) {
      try {
        const previous = shell.readShortcutLink(file)
        if (
          previous.target === target &&
          previous.icon === options.icon &&
          previous.appUserModelId === APP_ID &&
          previous.args === options.args
        )
          return true
      } catch {
        /* Replace an obsolete shortcut. */
      }
    }
    return shell.writeShortcutLink(
      file,
      existsSync(file) ? 'replace' : 'create',
      options
    )
  } catch {
    return false
  }
}
export function createNexusNotification(
  options: Electron.NotificationConstructorOptions
): Notification {
  syncNotificationShortcut(true)
  return new Notification({
    ...(iconPath ? { icon: iconPath } : {}),
    ...options,
  })
}
