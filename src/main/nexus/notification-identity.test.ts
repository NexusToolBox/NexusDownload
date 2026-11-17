import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  exists: false,
  enabled: true,
  previous: {} as Record<string, unknown>,
  write: vi.fn(() => true),
  remove: vi.fn(),
  notification: vi.fn(),
  registry: vi.fn(),
}))
vi.mock('node:child_process', () => ({ execFileSync: state.registry }))
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: () => state.exists,
  unlinkSync: state.remove,
}))
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Profile', isPackaged: true },
  shell: {
    readShortcutLink: () => state.previous,
    writeShortcutLink: state.write,
  },
  Notification: class {
    constructor(options: unknown) {
      state.notification(options)
    }
  },
}))

import { APP_ID } from '@shared/constants'
import {
  configureNexusNotifications,
  createNexusNotification,
} from './notification-identity'

afterEach(() => {
  state.exists = false
  state.enabled = true
  state.previous = {}
  vi.clearAllMocks()
})
describe.skipIf(process.platform !== 'win32')('portable toast identity', () => {
  it('creates the shortcut on the first notification with the app ID, current executable and app icon', () => {
    configureNexusNotifications(() => state.enabled, 'C:\\Portable\\icon.ico')
    expect(state.write).not.toHaveBeenCalled()
    createNexusNotification({ title: 'Download complete', body: 'sample.zip' })
    expect(state.write).toHaveBeenCalledWith(
      expect.stringContaining('NexusDownload.lnk'),
      'create',
      expect.objectContaining({
        target: process.execPath,
        appUserModelId: APP_ID,
        icon: 'C:\\Portable\\icon.ico',
      })
    )
    expect(state.notification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Download complete',
        body: 'sample.zip',
      })
    )
    expect(state.registry).toHaveBeenCalledWith(
      expect.stringContaining('reg.exe'),
      expect.arrayContaining(['DisplayName', 'NexusDownload']),
      expect.objectContaining({ windowsHide: true, stdio: 'ignore' })
    )
    expect(state.registry).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['IconUri', 'file:///C:/Portable/icon.ico']),
      expect.any(Object)
    )
  })
  it('updates an obsolete portable location and removes the shortcut when disabled', () => {
    state.exists = true
    state.previous = { target: 'C:\\OldPortable\\NexusDownload.exe' }
    configureNexusNotifications(() => state.enabled, 'C:\\Portable\\icon.ico')
    createNexusNotification({ title: 'Link found' })
    expect(state.write).toHaveBeenCalledWith(
      expect.any(String),
      'replace',
      expect.objectContaining({ target: process.execPath })
    )
    state.enabled = false
    configureNexusNotifications(() => state.enabled, '')
    expect(state.remove).toHaveBeenCalledOnce()
    expect(state.registry).toHaveBeenCalledWith(
      expect.any(String),
      [
        'delete',
        `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`,
        '/f',
        '/reg:64',
      ],
      expect.any(Object)
    )
  })
})
