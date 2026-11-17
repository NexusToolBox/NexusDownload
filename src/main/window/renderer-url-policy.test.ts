import { describe, expect, it, vi } from 'vitest'

import { createRendererUrlPolicy } from './renderer-url-policy'

function createWindowLoader() {
  return {
    loadFile: vi.fn().mockResolvedValue(undefined),
    loadURL: vi.fn().mockResolvedValue(undefined),
  }
}
const packagedAppPath = path.resolve('/opt/Motrix/resources/app.asar')
const packagedRenderer = path.join(packagedAppPath, 'dist/renderer/index.html')

describe('renderer URL policy', () => {
  it.skipIf(process.platform !== 'win32')(
    'loads and trusts the canonical Windows portable path',
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'nexus-renderer-path-'))
      try {
        const renderer = path.join(directory, 'dist/renderer/index.html')
        mkdirSync(path.dirname(renderer), { recursive: true })
        writeFileSync(renderer, '<main>fixture</main>')
        const policy = createRendererUrlPolicy({
          isPackaged: true,
          appPath: directory,
        })
        const canonical = path.join(
          realpathSync.native(directory),
          'dist/renderer/index.html'
        )
        expect(policy.rendererFilePath).toBe(canonical)
        expect(
          policy.isTrustedUrl(pathToFileURL(canonical).href + '?w=main')
        ).toBe(true)
        expect(
          policy.isTrustedUrl(
            pathToFileURL(canonical).href.toLowerCase() + '?w=main'
          )
        ).toBe(true)
        expect(
          policy.isTrustedUrl(
            pathToFileURL(path.join(path.dirname(canonical), 'other.html')).href
          )
        ).toBe(false)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
  it('ignores a hostile dev-server environment in packaged builds', () => {
    const policy = createRendererUrlPolicy({
      isPackaged: true,
      appPath: packagedAppPath,
      devServerUrl: 'https://attacker.example/',
    })
    const win = createWindowLoader()

    policy.loadWindow(win as never, '?w=main&locale=en-US')

    expect(Object.isFrozen(policy)).toBe(true)
    expect(policy.isDevelopmentServer).toBe(false)
    expect(policy.devServerOrigin).toBeNull()
    expect(win.loadURL).not.toHaveBeenCalled()
    expect(win.loadFile).toHaveBeenCalledWith(packagedRenderer, {
      search: '?w=main&locale=en-US',
    })
    expect(
      policy.isTrustedUrl(`${pathToFileURL(packagedRenderer).href}?w=main`)
    ).toBe(true)
    expect(policy.isTrustedUrl('https://attacker.example/')).toBe(false)
  })

  it.each([
    'http://0.0.0.0:5173/',
    'http://192.168.1.20:5173/',
    'https://attacker.example/',
  ])('rejects a non-loopback development origin: %s', (devServerUrl) => {
    expect(() =>
      createRendererUrlPolicy({
        isPackaged: false,
        appPath: '/app',
        devServerUrl,
      })
    ).toThrow('loopback hostname')
  })

  it.each([
    'http://localhost:5173/',
    'http://127.0.0.1:5173/',
    'https://[::1]:5173/',
  ])('trusts only the resolved loopback origin: %s', (devServerUrl) => {
    const policy = createRendererUrlPolicy({
      isPackaged: false,
      appPath: '/app',
      devServerUrl,
    })
    const win = createWindowLoader()

    policy.loadWindow(win as never, '?w=add-task&locale=zh-CN')

    expect(policy.devServerOrigin).toBe(new URL(devServerUrl).origin)
    expect(win.loadFile).not.toHaveBeenCalled()
    expect(win.loadURL).toHaveBeenCalledWith(
      `${new URL(devServerUrl).origin}/?w=add-task&locale=zh-CN`
    )
    expect(policy.isTrustedUrl(`${new URL(devServerUrl).origin}/?w=main`)).toBe(
      true
    )
    expect(policy.isTrustedUrl('http://localhost:6553/')).toBe(false)
  })

  it.each([
    'file:///tmp/dev.html',
    'ftp://localhost:5173/',
    'http://localhost:5173/path',
    'http://localhost:5173/?token=unsafe',
  ])('rejects a malformed development origin: %s', (devServerUrl) => {
    expect(() =>
      createRendererUrlPolicy({
        isPackaged: false,
        appPath: '/app',
        devServerUrl,
      })
    ).toThrow(/VITE_DEV_SERVER_URL/)
  })

  it('rejects renderer routes that are not query-only', () => {
    const policy = createRendererUrlPolicy({
      isPackaged: true,
      appPath: '/app',
    })
    const win = createWindowLoader()

    expect(() => policy.loadWindow(win as never, '/other.html')).toThrow(
      'query string'
    )
    expect(() => policy.loadWindow(win as never, '?w=main#fragment')).toThrow(
      'query string'
    )
  })
})

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
