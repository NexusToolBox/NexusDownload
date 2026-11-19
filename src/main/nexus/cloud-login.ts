import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  baiduWindowAvatar,
  type ProfileAvatar,
} from '@core/nexus/cloud/account-profile'
import type { CredentialCipher } from '@core/nexus/cloud/credential-broker'
import {
  CLOUD_LOGIN_ROOTS,
  isCloudLoginAddress,
} from '@shared/nexus-cloud-sites'
import type { CloudPlatform } from '@shared/schemas/nexus-cloud'
import { app, BrowserWindow, nativeTheme, safeStorage, session } from 'electron'
import { i18n } from '../lib/i18n'

export const cloudCipher: CredentialCipher = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptStringAsync(value),
  decrypt: async (value) =>
    (await safeStorage.decryptStringAsync(value)).result,
}
const sites = {
  quark: 'https://pan.quark.cn/?fr=pc&platform=pc',
  uc: 'https://drive.uc.cn/',
  baidu: 'https://pan.baidu.com/',
  '115': 'https://115.com/',
  '123':
    'https://user.123pan.cn/centerlogin?redirect_url=https%3A%2F%2Fyun.123pan.cn%2F%3Fnotoken%3D1&source_page=website',
} as const
export type LoginStep = 'page' | 'cookie' | 'token' | 'validate'

/** Some official login pages have a fixed desktop canvas wider than our window. */
function fitLoginPage(win: BrowserWindow) {
  const resizePage = async () => {
    if (win.isDestroyed()) return
    try {
      win.webContents.setZoomFactor(1)
      const width: unknown = await win.webContents.executeJavaScript(
        'Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0)'
      )
      if (win.isDestroyed() || typeof width !== 'number' || width <= 0) return
      win.webContents.setZoomFactor(
        Math.max(0.65, Math.min(1, win.getContentSize()[0] / width))
      )
    } catch {
      // A navigation can invalidate the previous document while sizing.
    }
  }
  win.webContents.on('did-finish-load', () => void resizePage())
  win.on('resize', () => void resizePage())
}
const baiduProfilePage = (address: string) => {
  try {
    const { origin, pathname } = new URL(address)
    return (
      origin === 'https://pan.baidu.com' &&
      ['/', '/disk/main', '/disk/home'].includes(pathname)
    )
  } catch {
    return false
  }
}

/** Remote login pages receive no preload or application IPC. */
export async function loginCloud(
  platform: CloudPlatform,
  validate: (credential: string) => Promise<string>,
  diagnostic?: (step: LoginStep, reason: string) => void,
  proxy: Electron.ProxyConfig = { mode: 'direct' },
  onAvatar?: (avatar: ProfileAvatar) => void
): Promise<string> {
  if (platform === 'aliyun') throw new Error('cloud.login')
  const isolated = session.fromPartition(
    `nexus-login-${platform}-${randomUUID()}`,
    { cache: false }
  )
  await isolated.setProxy(proxy)
  const win = new BrowserWindow({
    width: 1000,
    height: 740,
    autoHideMenuBar: true,
    webPreferences: {
      session: isolated,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  })
  win.setIcon?.(
    app?.isPackaged
      ? path.join(process.resourcesPath, 'cloud-logos', `${platform}.png`)
      : path.join(
          app?.getAppPath?.() ?? '',
          'src/renderer/assets/cloud-logos',
          `${platform}.png`
        )
  )
  fitLoginPage(win)
  isolated.setPermissionRequestHandler((_contents, _permission, done) =>
    done(false)
  )
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  return new Promise((resolve, reject) => {
    let finished = false,
      polling = false,
      page = '',
      settledAt = Date.now(),
      lastFailure = ''
    let hintKey = 'waiting'
    const hint = async (key = hintKey) => {
      hintKey = key
      if (win.isDestroyed()) return
      const message = i18n.t(`nexus.v12.login.${key}`)
      const dark = nativeTheme.shouldUseDarkColors
      win.setTitle(
        `${i18n.t(`nexus.platform.${platform}`)} · ${i18n.t('nexus.cloudV2.login')}`
      )
      await win.webContents.executeJavaScript(`(() => {
        let host = document.getElementById('nexus-login-hint');
        if (!host) { host = document.createElement('div'); host.id = 'nexus-login-hint'; document.documentElement.appendChild(host); }
        host.replaceChildren();
        host.dir = ${JSON.stringify(i18n.dir())};
        host.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:2147483647;padding:12px 16px;border:1px solid ${dark ? '#353A43' : '#DDE1E7'};border-radius:12px;background:${dark ? '#20242B' : '#FFFFFF'};color:${dark ? '#F1F3F6' : '#171A20'};font:13.5px system-ui;display:flex;align-items:center;gap:16px;box-shadow:0 8px 32px #0002';
        const text = document.createElement('span'); text.textContent = ${JSON.stringify(message)}; text.style.flex = '1';
        const button = document.createElement('button'); button.textContent = ${JSON.stringify(i18n.t('nexus.v12.login.verify'))};
        button.style.cssText = 'height:32px;padding:0 14px;flex-shrink:0;border:1px solid ${dark ? '#505762' : '#C8CDD5'};border-radius:999px;background:transparent;color:inherit;font:500 13px system-ui;cursor:pointer';
        button.onclick = () => location.assign('https://nexus-login.invalid/verify');
        host.append(text, button);
      })()`)
    }
    const localeChanged = () => {
      void hint().catch(() => undefined)
    }
    i18n.on('languageChanged', localeChanged)
    const failed = async (step: LoginStep, reason: string) => {
      if (lastFailure !== `${step}:${reason}`) {
        diagnostic?.(step, reason)
        lastFailure = `${step}:${reason}`
      }
      await hint(reason).catch(() => undefined)
    }
    const check = async (manual = false) => {
      if (polling || finished || win.isDestroyed()) return
      polling = true
      let step: LoginStep = 'page'
      try {
        const address = win.webContents.getURL()
        if (!isCloudLoginAddress(platform, address)) return
        if (address !== page) {
          page = address
          settledAt = Date.now()
          if (!manual) {
            await hint()
            return
          }
        }
        if (
          !manual &&
          (win.webContents.isLoading() || Date.now() - settledAt < 1000)
        )
          return
        if (
          !manual &&
          platform === 'baidu' &&
          new URL(address).origin !== 'https://pan.baidu.com'
        )
          return
        let candidate = ''
        if (platform === '123') {
          step = 'token'
          const stored: unknown = await win.webContents.executeJavaScript(
            "localStorage.getItem('authorToken')"
          )
          if (typeof stored !== 'string' || !stored) {
            if (manual) await failed(step, 'token')
            return
          }
          let token = stored
          try {
            const parsed = JSON.parse(stored)
            token =
              typeof parsed === 'string'
                ? parsed
                : (parsed.token ?? parsed.access_token ?? '')
          } catch {
            /* Plain token storage is supported. */
          }
          token = token.replace(/^Bearer\s+/i, '')
          if (
            !token ||
            token.length > 16384 ||
            [...token].some(
              (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127
            )
          ) {
            if (manual) await failed(step, 'token')
            return
          }
          candidate = JSON.stringify({
            token,
            device: randomUUID().replaceAll('-', ''),
          })
        } else {
          step = 'cookie'
          const all = await isolated.cookies.get({})
          const roots = CLOUD_LOGIN_ROOTS[platform]
          const cookies = all.filter((c) => {
            const domain = (c.domain ?? '').replace(/^\./, '')
            return (
              !domain ||
              roots.some(
                (root) => domain === root || domain.endsWith(`.${root}`)
              )
            )
          })
          const names = new Set(
            cookies.filter((c) => c.value).map((c) => c.name)
          )
          const required =
            platform === '115'
              ? ['UID', 'SEID']
              : platform === 'baidu'
                ? ['BDUSS', 'STOKEN']
                : ['__pus', '__puus']
          if (!required.every((name) => names.has(name))) {
            if (manual) await failed(step, 'cookie')
            return
          }
          const values = new Map(cookies.map((c) => [c.name, c.value]))
          candidate = [...values]
            .map(([name, value]) => `${name}=${value}`)
            .join('; ')
        }
        step = 'validate'
        const credential = await validate(candidate)
        if (win.isDestroyed() || finished) return
        if (
          platform === 'baidu' &&
          onAvatar &&
          baiduProfilePage(win.webContents.getURL())
        ) {
          try {
            // Read the same signed-in profile field consumed by Baidu's own disk page.
            const photo: unknown =
              await win.webContents.executeJavaScript(`(() => {
              if (location.origin !== 'https://pan.baidu.com' || !['/', '/disk/main', '/disk/home'].includes(location.pathname)) return;
              const account = window.locals;
              if (account?.isLogin !== true && account?.isLogin !== 1) return;
              const photo = account.userInfo?.photo_url;
              return typeof photo === 'string' && photo.length <= 8192 ? photo : undefined;
            })()`)
            if (
              !win.isDestroyed() &&
              baiduProfilePage(win.webContents.getURL())
            ) {
              const avatar = baiduWindowAvatar(photo)
              if (avatar) onAvatar(avatar)
            }
          } catch {
            // Profile lookup must not roll back a validated login.
          }
        }
        if (win.isDestroyed() || finished) return
        finished = true
        resolve(credential)
        win.close()
      } catch {
        if (manual) await failed(step, step === 'validate' ? 'validate' : step)
        else if (step === 'validate') diagnostic?.('validate', 'validate')
      } finally {
        polling = false
      }
    }
    const navigate = (event: { preventDefault(): void }, target: string) => {
      if (target === 'https://nexus-login.invalid/verify') {
        event.preventDefault()
        void check(true)
        return
      }
      if (!isCloudLoginAddress(platform, target)) event.preventDefault()
    }
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isCloudLoginAddress(platform, url))
        void win.loadURL(url).catch(() => failed('page', 'page'))
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', navigate)
    win.webContents.on('will-redirect', navigate)
    win.webContents.on('did-finish-load', () => {
      void hint().catch(() => undefined)
    })
    const timer = setInterval(() => {
      void check()
    }, 1000)
    win.on('closed', () => {
      clearInterval(timer)
      i18n.off('languageChanged', localeChanged)
      void isolated.clearStorageData()
      if (!finished) reject(new Error('cloud.login'))
    })
    void win.loadURL(sites[platform]).catch(() => failed('page', 'page'))
  })
}

/** Only an authorization code returns to core; the application secret stays outside the page. */
export async function authorizeAliyun(
  address: string,
  redirectUri: string,
  state: string,
  proxy: Electron.ProxyConfig = { mode: 'direct' }
): Promise<string> {
  const callback = new URL(redirectUri)
  const isolated = session.fromPartition(`nexus-oauth-${randomUUID()}`, {
    cache: false,
  })
  await isolated.setProxy(proxy)
  const win = new BrowserWindow({
    width: 1000,
    height: 740,
    autoHideMenuBar: true,
    webPreferences: {
      session: isolated,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  })
  fitLoginPage(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isCloudLoginAddress('aliyun', url))
      void win.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  isolated.setPermissionRequestHandler((_contents, _permission, done) =>
    done(false)
  )
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  return new Promise((resolve, reject) => {
    let finished = false
    const timer = setTimeout(() => win.close(), 300000)
    const navigate = (event: { preventDefault(): void }, target: string) => {
      let url: URL
      try {
        url = new URL(target)
      } catch {
        event.preventDefault()
        return
      }
      if (
        url.origin === callback.origin &&
        url.pathname === callback.pathname
      ) {
        event.preventDefault()
        const code = url.searchParams.get('code')
        if (
          url.searchParams.get('state') === state &&
          code &&
          !url.searchParams.has('error')
        ) {
          finished = true
          resolve(code)
        }
        win.close()
        return
      }
      if (
        url.protocol !== 'https:' ||
        !['alipan.com', 'aliyundrive.com', 'aliyun.com'].some(
          (root) => url.hostname === root || url.hostname.endsWith(`.${root}`)
        )
      )
        event.preventDefault()
    }
    win.webContents.on('will-navigate', navigate)
    win.webContents.on('will-redirect', navigate)
    win.on('closed', () => {
      clearTimeout(timer)
      void isolated.clearStorageData()
      if (!finished) reject(new Error('cloud.login'))
    })
    void win.loadURL(address).catch(() => {
      if (!win.isDestroyed()) win.close()
    })
  })
}
