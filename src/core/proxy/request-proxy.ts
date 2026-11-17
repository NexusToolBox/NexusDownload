import type { ProxySettings } from '@shared/types/settings'
import { decideAria2ProxyRoute } from './aria2-proxy-routing'
import { ProxyBridgeManager } from './proxy-bridge-manager'
import { parseElectronProxyChain } from './system-proxy'

const DOMESTIC_ROOTS = [
  'baidu.com',
  'baidupcs.com',
  'baidubce.com',
  'bdstatic.com',
  'quark.cn',
  'quarkcloud.cn',
  'uc.cn',
  'ucweb.com',
  'aliyundrive.com',
  'aliyundrive.net',
  'alipan.com',
  'aliyuncs.com',
  '115.com',
  '115cdn.com',
  '115cdn.net',
  '115pan.com',
  'anxia.com',
  '123pan.com',
  '123pan.cn',
  '123pancloud.com',
  '123panyun.com',
  '123684.com',
  '123865.com',
  'bilibili.com',
  'b23.tv',
  'bilivideo.com',
  'bilivideo.cn',
  'hdslb.com',
  'douyin.com',
  'iesdouyin.com',
  'douyinvod.com',
  'bytecdn.cn',
  'byteimg.com',
  'bytedance.com',
  'snssdk.com',
  'kuaishou.com',
  'gifshow.com',
  'kwimgs.com',
  'ksapisrv.com',
  'kwaicdn.com',
  'xiaohongshu.com',
  'xhslink.com',
  'xhscdn.com',
  'xhscdn.net',
  'weibo.com',
  'weibo.cn',
  'sinaimg.cn',
  'weibocdn.com',
]
export function isDomesticPlatform(address: string): boolean {
  try {
    const host = new URL(address).hostname.toLowerCase()
    return DOMESTIC_ROOTS.some(
      (root) => host === root || host.endsWith(`.${root}`)
    )
  } catch {
    return false
  }
}

/** Resolve on every admission. Separate SOCKS bridges keep concurrent PAC routes stable. */
export class RequestProxyRouter {
  private bridges = new Map<string, ProxyBridgeManager>()
  constructor(
    private options: {
      settings(): ProxySettings
      resolveSystem(url: string): Promise<string>
      bridge?(): ProxyBridgeManager
    }
  ) {}
  async resolve(
    url: string,
    domestic = isDomesticPlatform(url)
  ): Promise<string> {
    const settings = this.options.settings()
    const mode = settings.mode ?? (settings.enabled ? 'manual' : 'system')
    const hostname = (() => {
      try {
        return new URL(url).hostname
      } catch {
        return ''
      }
    })()
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return ''
    if (mode === 'none' || (domestic && !settings.domestic)) return ''
    let selected = settings
    if (mode === 'system') {
      const system = parseElectronProxyChain(
        await this.options.resolveSystem(url)
      )
      if (!system) return ''
      selected = { ...settings, ...system, user: '', password: '', bypass: [] }
    }
    if (decideAria2ProxyRoute(url, selected.bypass.join(',')) !== 'proxy')
      return ''
    selected = {
      ...selected,
      mode: undefined,
      enabled: true,
      scopes: {
        download: true,
        updateApp: true,
        updateTrackers: true,
        plugins: true,
      },
    }
    const key = JSON.stringify([
      selected.protocol,
      selected.host,
      selected.port,
      selected.user,
      selected.password,
    ])
    let bridge = this.bridges.get(key)
    if (!bridge) {
      bridge = this.options.bridge?.() ?? new ProxyBridgeManager()
      this.bridges.set(key, bridge)
    }
    return (await bridge.resolveForDownload(selected))?.allProxy ?? ''
  }
  async close() {
    await Promise.all(
      [...this.bridges.values()].map((bridge) => bridge.close())
    )
    this.bridges.clear()
  }
}
