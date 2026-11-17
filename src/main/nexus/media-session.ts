// YunX Desktop 1.3.4 DouyinParser.kt SSR/XHR fallback behavior. AGPL-3.0-only.
import { randomUUID } from 'node:crypto'
import {
  chromeUa,
  detectMedia,
  platformRoots,
} from '@core/nexus/media/domestic-parsers'
import { douyinDetail } from '@core/nexus/media/douyin-data'
import type { MediaPlatform } from '@shared/schemas/nexus-media'
import { BrowserWindow, session } from 'electron'
import { i18n } from '../lib/i18n'

/** Same isolated, sandboxed login boundary as v0.2; no privileged preload. */
export async function mediaSession(
  platform: MediaPlatform,
  url?: string,
  readPage = false,
  cookie = '',
  proxy: Electron.ProxyConfig = { mode: 'direct' }
): Promise<string> {
  const address =
    url ??
    (platform === 'bilibili'
      ? 'https://www.bilibili.com/'
      : platform === 'pixiv'
        ? 'https://www.pixiv.net/'
        : platform === 'external'
          ? ''
          : `https://www.${platformRoots[platform][0]}/`)
  const origin = new URL(address)
  if (
    origin.protocol !== 'https:' ||
    (platform !== 'external' && detectMedia(address) !== platform)
  )
    throw new Error('media.invalid')
  const roots =
    platform === 'external'
      ? [
          origin.hostname,
          ...(origin.hostname.endsWith('youtube.com') ? ['google.com'] : []),
        ]
      : platformRoots[platform]
  const isolated = session.fromPartition(`nexus-media-${randomUUID()}`, {
    cache: false,
  })
  await isolated.setProxy(proxy)
  const win = new BrowserWindow({
    show: !readPage,
    width: 1000,
    height: 740,
    title: i18n.t('nexus.v4.loginTitle'),
    autoHideMenuBar: true,
    webPreferences: {
      session: isolated,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
      backgroundThrottling: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  isolated.setPermissionRequestHandler((_w, _p, done) => done(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', (e) => e.preventDefault())
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  const guard = (e: { preventDefault(): void }, target: string) => {
    const u = new URL(target)
    if (
      u.protocol !== 'https:' ||
      !roots.some((r) => u.hostname === r || u.hostname.endsWith(`.${r}`))
    )
      e.preventDefault()
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
  if (readPage) {
    win.webContents.setUserAgent(chromeUa)
    let detail: unknown = null
    const pending = new Set<string>()
    try {
      for (const pair of cookie.split(';')) {
        const index = pair.indexOf('=')
        if (index > 0)
          await isolated.cookies.set({
            url: origin.origin,
            name: pair.slice(0, index).trim(),
            value: pair.slice(index + 1).trim(),
            secure: true,
          })
      }
      await win.loadURL('about:blank')
      win.webContents.debugger.attach('1.3')
      win.webContents.debugger.on('message', (_event, method, params) => {
        if (
          method === 'Network.responseReceived' &&
          typeof params.response?.url === 'string' &&
          params.response.url.includes('/aweme/v1/web/aweme/detail/')
        )
          pending.add(params.requestId)
        if (
          method === 'Network.loadingFinished' &&
          pending.delete(params.requestId)
        )
          void win.webContents.debugger
            .sendCommand('Network.getResponseBody', {
              requestId: params.requestId,
            })
            .then((response) => {
              try {
                const body = response.base64Encoded
                  ? Buffer.from(response.body, 'base64').toString()
                  : response.body
                if (body.length < 16 * 1024 ** 2) detail = JSON.parse(body)
              } catch {
                /* Page response cannot become executable code. */
              }
            })
            .catch(() => undefined)
      })
      await win.webContents.debugger.sendCommand('Network.enable')
      await win.loadURL(address)
      const deadline = Date.now() + 40000
      const expected = address.match(/(?:video|note)\/(\d+)/)?.[1]
      while (!win.isDestroyed() && Date.now() < deadline) {
        const data: unknown = await win.webContents.executeJavaScript(
          `JSON.stringify(window._ROUTER_DATA || window.SSR_RENDER_DATA || (()=>{try{return JSON.parse(decodeURIComponent(document.getElementById('RENDER_DATA')?.textContent || 'null'))}catch{return null}})())`
        )
        if (
          typeof data === 'string' &&
          data.length < 16 * 1024 ** 2 &&
          douyinDetail(data, expected)
        )
          return data
        if (douyinDetail(detail, expected)) return JSON.stringify(detail)
        if (Date.now() > deadline - 5000) {
          const fallback: unknown = await win.webContents.executeJavaScript(
            `JSON.stringify((()=>{const images=[...document.querySelectorAll('img')].map(i=>i.src).filter(s=>s.includes('douyinpic')&&!s.includes('WEBPC_RELATED')&&(s.includes('biz_tag=aweme_images')||s.includes('tplv-dy-aweme-images')));return images.length?{desc:document.title,images:[...new Set(images)].map(s=>({url_list:[s]})),nexusStatic:true}:null})())`
          )
          if (
            typeof fallback === 'string' &&
            fallback.length < 1024 * 1024 &&
            douyinDetail(fallback, expected)
          )
            return fallback
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error('media.blocked')
    } finally {
      if (!win.isDestroyed()) win.destroy()
      await isolated.clearStorageData()
    }
  }
  return new Promise((resolve, reject) => {
    let cookies = ''
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void isolated.cookies
        .get({ domain: origin.hostname.replace(/^www\./, '') })
        .then((all) => {
          cookies = all.map((c) => `${c.name}=${c.value}`).join('; ')
        })
        .finally(() => {
          polling = false
        })
    }, 500)
    win.once('closed', () => {
      clearInterval(timer)
      void isolated.clearStorageData()
      if (cookies) resolve(cookies)
      else reject(new Error('media.login'))
    })
    void win.loadURL(address).catch(() => {
      if (!win.isDestroyed()) win.close()
    })
  })
}
