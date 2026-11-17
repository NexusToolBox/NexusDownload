import path from 'node:path'
import { EventBus } from '@core/events/event-bus'
import type { SettingsManager } from '@core/settings/settings-manager'
import { RunMode } from '@shared/constants'
import { Events } from '@shared/protocol/events'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  created: vi.fn(),
  menu: vi.fn((items: { label?: string; click?: () => void }[]) => items),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Tray: class extends EventEmitter {
      constructor(...args: unknown[]) {
        super()
        state.created(...args)
      }
      setImage() {}
      setToolTip() {}
      popUpContextMenu() {}
      destroy() {}
    },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    nativeTheme: Object.assign(new EventEmitter(), {
      shouldUseDarkColorsForSystemIntegratedUI: false,
    }),
    Menu: { buildFromTemplate: state.menu },
  }
})
vi.mock('../lib/i18n', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('./taskbar-theme', () => ({
  readWindowsTaskbarTheme: async () => null,
}))
vi.mock('./notification-identity', () => ({ createNexusNotification: vi.fn() }))

import { setupNexusWindowsTray } from './windows-tray'

afterEach(() => vi.clearAllMocks())

it('keeps a portable tray independent of the installation path and retains it on settings changes', () => {
  const events = new EventBus()
  const assets = path.join('portable-copy', 'resources', 'extra')
  const tray = setupNexusWindowsTray({
    eventBus: events,
    settingsManager: {
      getApp: () => ({ runMode: RunMode.Standard, lightweightMode: true }),
      get: () => ({ speedLimit: { turtle: 'off' } }),
    } as unknown as SettingsManager,
    extraResourceDir: assets,
    toggleMainWindow: vi.fn(),
    actions: {
      getTasks: () => [],
      getErrorCount: () => 0,
      showMain: vi.fn(),
      openAdd: vi.fn(),
      pauseAll: async () => {},
      resumeAll: async () => {},
      quit: vi.fn(),
      noticeShown: () => true,
      saveNoticeShown: async () => {},
    },
  })
  try {
    expect(state.created.mock.calls).toEqual([
      [path.join(assets, 'nexus', 'app-icon.ico')],
    ])
    events.emit(Events.SettingsChanged)
    expect(state.created).toHaveBeenCalledOnce()
  } finally {
    tray.destroy()
  }
})
