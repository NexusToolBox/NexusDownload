import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  partitions: [] as string[],
  options: [] as Record<string, unknown>[],
  windows: [] as {
    emit: (name: string, ...args: unknown[]) => boolean
    close: () => void
  }[],
  cookies: [] as { name: string; value: string; domain?: string }[],
  clear: vi.fn(async () => undefined),
  url: 'https://pan.quark.cn/',
  stored: null as string | null,
  photo: undefined as string | undefined,
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      getURL: () => state.url,
      isLoading: () => false,
      executeJavaScript: vi.fn(async (script: string) =>
        script.includes('localStorage')
          ? state.stored
          : script.includes('photo_url')
            ? state.photo
            : undefined
      ),
    })
    constructor(options: Record<string, unknown>) {
      super()
      state.options.push(options)
      state.windows.push(this)
    }
    loadURL() {
      return Promise.resolve()
    }
    isDestroyed() {
      return false
    }
    setTitle() {}
    close() {
      this.emit('closed')
    }
  }
  return {
    BrowserWindow: Window,
    nativeTheme: { shouldUseDarkColors: false },
    safeStorage: {},
    session: {
      fromPartition: (partition: string) => {
        state.partitions.push(partition)
        return Object.assign(new EventEmitter(), {
          setProxy: vi.fn(async () => undefined),
          cookies: { get: async () => state.cookies },
          clearStorageData: state.clear,
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
        })
      },
    },
  }
})

import { authorizeAliyun, loginCloud } from './cloud-login'

afterEach(() => {
  vi.useRealTimers()
  state.partitions = []
  state.options = []
  state.windows = []
  state.cookies = []
  state.clear.mockClear()
  state.url = 'https://pan.quark.cn/'
  state.stored = null
  state.photo = undefined
})
describe('isolated official login host', () => {
  it('intercepts only the exact OAuth callback with matching state', async () => {
    const secret = randomBytes(24).toString('hex')
    const result = authorizeAliyun(
      'https://openapi.alipan.com/oauth/authorize',
      'https://client.invalid/callback',
      secret
    )
    const preventDefault = vi.fn()
    await Promise.resolve()
    const win = state.windows[0] as unknown as {
      webContents: { emit: (name: string, ...args: unknown[]) => void }
    }
    win.webContents.emit(
      'will-redirect',
      { preventDefault },
      `https://client.invalid/callback?state=${secret}&code=${secret}`
    )
    expect((await result) === secret).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
  })
  it('rejects mismatched OAuth state without exposing the response', async () => {
    const secret = randomBytes(24).toString('hex')
    const result = authorizeAliyun(
      'https://openapi.alipan.com/oauth/authorize',
      'https://client.invalid/callback',
      secret
    )
    const rejected = expect(result).rejects.toThrow('cloud.login')
    await Promise.resolve()
    const win = state.windows[0] as unknown as {
      webContents: { emit: (name: string, ...args: unknown[]) => void }
    }
    win.webContents.emit(
      'will-navigate',
      { preventDefault: vi.fn() },
      'https://client.invalid/callback?state=wrong&code=wrong'
    )
    await rejected
  })
  it('uses unique nonpersistent sessions with no Node/preload and clears all cookies on close', async () => {
    vi.useFakeTimers()
    const secret = randomBytes(24).toString('hex')
    state.cookies = [
      { name: '__pus', value: secret },
      { name: '__puus', value: secret },
    ]
    const first = loginCloud('quark', async (value) => value)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await first).includes(secret)).toBe(true)
    const second = loginCloud('quark', async (value) => value)
    await vi.advanceTimersByTimeAsync(2000)
    await second
    expect(state.partitions[0] !== state.partitions[1]).toBe(true)
    expect(state.partitions.every((p) => !p.startsWith('persist:'))).toBe(true)
    for (const options of state.options) {
      const web = options.webPreferences as Record<string, unknown>
      expect(
        web.nodeIntegration === false &&
          web.contextIsolation === true &&
          web.sandbox === true &&
          web.webSecurity === true &&
          !('preload' in web)
      ).toBe(true)
    }
    expect(state.clear).toHaveBeenCalledTimes(2)
  })
  it('closing an unfinished login rejects without saving credentials', async () => {
    vi.useFakeTimers()
    const result = loginCloud('baidu', async (value) => value)
    const rejected = expect(result).rejects.toThrow('cloud.login')
    await Promise.resolve()
    state.windows[0].close()
    await rejected
    expect(state.clear).toHaveBeenCalledTimes(1)
  })
  it('waits for the Baidu homepage, STOKEN and a successful account probe', async () => {
    vi.useFakeTimers()
    const value = randomBytes(24).toString('hex')
    state.url = 'https://passport.baidu.com/login'
    state.cookies = [{ name: 'BDUSS', value }]
    const validate = vi.fn(async (credential: string) => credential)
    validate.mockRejectedValueOnce(new Error('cloud.network'))
    const result = loginCloud('baidu', validate)
    await vi.advanceTimersByTimeAsync(3000)
    expect(validate).not.toHaveBeenCalled()
    state.url = 'https://pan.baidu.com/disk/main'
    await vi.advanceTimersByTimeAsync(3000)
    expect(validate).not.toHaveBeenCalled()
    state.cookies.push({ name: 'STOKEN', value })
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.clear).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(typeof (await result)).toBe('string')
    expect(validate).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['https://pan.baidu.com/disk/main', 'https://himg.bdimg.com/fixture', true],
    [
      'https://pan.baidu.com/disk/main',
      'https://unrelated.invalid/fixture',
      false,
    ],
    ['https://pan.baidu.com/s/shared', 'https://himg.bdimg.com/fixture', false],
  ] as const)(
    'only accepts Baidu avatar from its validated profile page (%s)',
    async (page, photo, accepted) => {
      vi.useFakeTimers()
      state.url = page
      state.photo = photo
      const value = randomBytes(24).toString('hex')
      state.cookies = [
        { name: 'BDUSS', value },
        { name: 'STOKEN', value },
      ]
      const validate = vi.fn(async (credential: string) => credential)
      const onAvatar = vi.fn(() => {
        expect(validate).toHaveBeenCalledOnce()
        expect(state.clear).not.toHaveBeenCalled()
      })
      const result = loginCloud(
        'baidu',
        validate,
        undefined,
        undefined,
        onAvatar
      )
      await vi.advanceTimersByTimeAsync(2500)
      await result
      if (accepted)
        expect(onAvatar).toHaveBeenCalledExactlyOnceWith({
          address: photo,
          field: 'window.locals.userInfo.photo_url',
        })
      else expect(onAvatar).not.toHaveBeenCalled()
      expect(state.clear).toHaveBeenCalledOnce()
    }
  )
  it('reads 123 authorToken in the main process and validates before closing', async () => {
    vi.useFakeTimers()
    state.url = 'https://www.123pan.com/'
    state.stored = JSON.stringify(randomBytes(24).toString('hex'))
    const validate = vi.fn(async (credential: string) => credential)
    const result = loginCloud('123', validate)
    await vi.advanceTimersByTimeAsync(2000)
    expect(typeof (await result)).toBe('string')
    expect(validate).toHaveBeenCalledOnce()
    expect(state.clear).toHaveBeenCalledOnce()
  })
  it.each(['uc', 'quark'] as const)(
    'collects host and parent-domain cookies for %s and supports manual verification',
    async (platform) => {
      vi.useFakeTimers()
      const secret = randomBytes(24).toString('hex')
      const root = platform === 'uc' ? 'uc.cn' : 'quark.cn'
      const host = platform === 'uc' ? 'drive.uc.cn' : 'pan.quark.cn'
      state.url = `https://${host}/login`
      state.cookies = [
        { name: '__pus', value: secret, domain: host },
        { name: '__puus', value: secret, domain: `.${root}` },
        { name: 'foreign', value: secret, domain: '.unrelated.invalid' },
      ]
      const validate = vi.fn(async (value: string) => value)
      const result = loginCloud(platform, validate)
      await Promise.resolve()
      const win = state.windows[0] as unknown as {
        webContents: { emit(name: string, ...args: unknown[]): void }
      }
      const preventDefault = vi.fn()
      win.webContents.emit(
        'will-navigate',
        { preventDefault },
        'https://nexus-login.invalid/verify'
      )
      expect((await result).includes('foreign=')).toBe(false)
      expect(validate).toHaveBeenCalledOnce()
      expect(preventDefault).toHaveBeenCalledOnce()
    }
  )
  it('records the failed validation step without retaining the error or credential', async () => {
    vi.useFakeTimers()
    const secret = randomBytes(24).toString('hex')
    state.url = 'https://drive.uc.cn/'
    state.cookies = [
      { name: '__pus', value: secret, domain: '.uc.cn' },
      { name: '__puus', value: secret, domain: 'drive.uc.cn' },
    ]
    const diagnostic = vi.fn()
    const result = loginCloud(
      'uc',
      async () => {
        throw new Error(secret)
      },
      diagnostic
    )
    const rejected = expect(result).rejects.toThrow('cloud.login')
    await vi.advanceTimersByTimeAsync(2500)
    expect(diagnostic).toHaveBeenCalledWith('validate', 'validate')
    expect(JSON.stringify(diagnostic.mock.calls).includes(secret)).toBe(false)
    state.windows[0].close()
    await rejected
  })
})
