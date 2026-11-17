import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: (...args: unknown[]) => mocks.fromWebContents(...args),
  },
  ipcMain: { handle: mocks.handle },
}))

import { initializeRendererUrlPolicy } from '../window/renderer-url-policy'
import {
  assertTrustedIpcSender,
  isTrustedRendererUrl,
  registerTrustedIpcHandler,
} from './trusted-ipc'

const packagedAppPath = path.resolve('/opt/Motrix/resources/app.asar')
const rendererUrl = `${pathToFileURL(path.join(packagedAppPath, 'dist/renderer/index.html')).href}?w=main`

initializeRendererUrlPolicy({
  isPackaged: true,
  appPath: packagedAppPath,
})

function trustedEvent(url = rendererUrl) {
  const frame = { url }
  const sender = {
    mainFrame: frame,
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
  }
  mocks.fromWebContents.mockReturnValue({
    webContents: sender,
    isDestroyed: vi.fn(() => false),
  })
  return {
    sender,
    senderFrame: frame,
  } as unknown as Electron.IpcMainInvokeEvent
}

describe('trusted IPC sender validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts only the packaged renderer entry point', () => {
    expect(isTrustedRendererUrl(rendererUrl)).toBe(true)
    expect(
      isTrustedRendererUrl(
        pathToFileURL(path.join(packagedAppPath, 'dist/renderer/other.html'))
          .href
      )
    ).toBe(false)
    expect(isTrustedRendererUrl('https://motrix.app/')).toBe(false)
  })

  it('accepts the current main frame of an owned BrowserWindow', () => {
    expect(() => assertTrustedIpcSender(trustedEvent())).not.toThrow()
  })

  it('rejects subframes, detached windows, and navigated senders', () => {
    const subframe = trustedEvent()
    Object.assign(subframe, { senderFrame: { url: rendererUrl } })
    expect(() => assertTrustedIpcSender(subframe)).toThrow('untrusted renderer')

    const detached = trustedEvent()
    mocks.fromWebContents.mockReturnValue(null)
    expect(() => assertTrustedIpcSender(detached)).toThrow('untrusted renderer')

    expect(() =>
      assertTrustedIpcSender(trustedEvent('https://attacker.example/'))
    ).toThrow('untrusted renderer')
  })

  it('validates before dispatching a registered handler', async () => {
    const listener = vi.fn().mockResolvedValue('ok')
    registerTrustedIpcHandler('query:test', listener)
    const wrapper = mocks.handle.mock.calls[0]?.[1]
    const event = trustedEvent()

    await expect(wrapper(event, 'value')).resolves.toBe('ok')
    expect(listener).toHaveBeenCalledWith(event, 'value')

    await expect(
      wrapper(trustedEvent('https://attacker.example/'))
    ).rejects.toThrow('untrusted renderer')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

import path from 'node:path'
import { pathToFileURL } from 'node:url'
