import { DEFAULT_PROXY_SETTINGS } from '@shared/schemas/proxy-settings'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../settings/migrations'
import { RequestProxyRouter } from './request-proxy'

describe('per-request proxy policy', () => {
  it('re-resolves PAC for each task and observes system changes', async () => {
    const resolveSystem = vi
      .fn()
      .mockResolvedValueOnce('PROXY 127.0.0.1:7890')
      .mockResolvedValueOnce('DIRECT')
    const router = new RequestProxyRouter({
      settings: () => DEFAULT_PROXY_SETTINGS,
      resolveSystem,
    })
    expect(await router.resolve('https://github.com/a')).toBe(
      'http://127.0.0.1:7890'
    )
    expect(await router.resolve('https://github.com/b')).toBe('')
    expect(resolveSystem.mock.calls.map((call) => call[0])).toEqual([
      'https://github.com/a',
      'https://github.com/b',
    ])
    await router.close()
  })
  it('bypasses domestic services and loopback unless explicitly allowed', async () => {
    const settings = { ...DEFAULT_PROXY_SETTINGS, domestic: false }
    const resolveSystem = vi.fn().mockResolvedValue('PROXY 127.0.0.1:7890')
    const router = new RequestProxyRouter({
      settings: () => settings,
      resolveSystem,
    })
    for (const url of [
      'https://pan.baidu.com/',
      'https://cdn.bilivideo.com/a',
      'https://pan.quark.cn/',
      'http://127.0.0.1:1234/a',
    ])
      expect(await router.resolve(url)).toBe('')
    expect(resolveSystem).not.toHaveBeenCalled()
    settings.domestic = true
    expect(await router.resolve('https://pan.baidu.com/')).toContain(':7890')
    await router.close()
  })
  it('retains legacy manual proxy on upgrade', () => {
    expect(
      migrate({ version: 13, proxy: { enabled: true } }).proxy
    ).toMatchObject({ mode: 'manual', domestic: false })
    expect(
      migrate({ version: 13, proxy: { enabled: false } }).proxy
    ).toMatchObject({ mode: 'system' })
  })
  it('uses separate HTTP bridges for concurrent SOCKS PAC routes', async () => {
    const upstreams: string[] = []
    const router = new RequestProxyRouter({
      settings: () => DEFAULT_PROXY_SETTINGS,
      resolveSystem: async (url) =>
        url.includes('github')
          ? 'SOCKS5 127.0.0.1:1080'
          : 'SOCKS5 127.0.0.1:1081',
      bridge: () =>
        ({
          resolveForDownload: async (settings: { port: number }) => {
            upstreams.push(String(settings.port))
            return {
              allProxy: `http://127.0.0.1:${settings.port + 1000}`,
              noProxy: '',
            }
          },
          close: async () => {},
        }) as never,
    })
    expect(
      await Promise.all(
        ['https://github.com', 'https://youtube.com'].map((url) =>
          router.resolve(url)
        )
      )
    ).toEqual(['http://127.0.0.1:2080', 'http://127.0.0.1:2081'])
    expect(upstreams).toEqual(['1080', '1081'])
    await router.close()
  })
})
