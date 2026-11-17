import { RequestProxyRouter } from '@core/proxy/request-proxy'
import { proxyToElectronConfig } from '@core/proxy/serializers'
import type { ProxySettings } from '@shared/types/settings'
import { session } from 'electron'
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici'

export function createRequestRouting(settings: () => ProxySettings) {
  const system = session.fromPartition('nexus-system-routing', { cache: false })
  const agents = new Map<string, Agent | ProxyAgent>()
  const router = new RequestProxyRouter({
    settings,
    resolveSystem: async (url) => {
      await system.setProxy({ mode: 'system' })
      await system.forceReloadProxyConfig()
      return system.resolveProxy(url)
    },
  })
  const request: typeof fetch = async (input, init) => {
    const original = new Request(input, init)
    let current = original
    for (let hop = 0; hop <= 10; hop++) {
      const proxy = await router.resolve(current.url)
      let dispatcher = agents.get(proxy)
      if (!dispatcher) {
        dispatcher = proxy ? new ProxyAgent(proxy) : new Agent()
        agents.set(proxy, dispatcher)
      }
      const response = (await undiciFetch(current.url, {
        method: current.method,
        headers: [...current.headers],
        body: ['GET', 'HEAD'].includes(current.method)
          ? undefined
          : new Uint8Array(await current.arrayBuffer()),
        signal: current.signal,
        redirect: 'manual',
        dispatcher,
      })) as unknown as Response
      if (
        ![301, 302, 303, 307, 308].includes(response.status) ||
        original.redirect === 'manual'
      )
        return response
      if (original.redirect === 'error') {
        await response.body?.cancel()
        throw new Error('Redirect refused')
      }
      const location = response.headers.get('location')
      if (!location) return response
      await response.body?.cancel()
      const next = new URL(location, current.url)
      const headers = new Headers(current.headers)
      if (next.origin !== new URL(current.url).origin) {
        headers.delete('authorization')
        headers.delete('cookie')
        headers.delete('proxy-authorization')
      }
      const method =
        response.status === 303 ||
        ([301, 302].includes(response.status) && current.method === 'POST')
          ? 'GET'
          : current.method
      if (!['GET', 'HEAD'].includes(method))
        throw new Error('Request body cannot be redirected')
      headers.delete('content-length')
      headers.delete('content-type')
      current = new Request(next, { method, headers, signal: original.signal })
    }
    throw new Error('Too many redirects')
  }
  return {
    router,
    fetch: request,
    sessionConfig: (domestic: boolean): Electron.ProxyConfig => {
      const selected = settings()
      if (selected.mode === 'none' || (domestic && !selected.domestic))
        return { mode: 'direct' }
      if (selected.mode === 'manual')
        return {
          mode: 'fixed_servers',
          ...proxyToElectronConfig({
            ...selected,
            enabled: true,
            scopes: { ...selected.scopes, updateApp: true },
          }),
        }
      return { mode: 'system' }
    },
    close: async () => {
      await router.close()
      await Promise.all([...agents.values()].map((agent) => agent.close()))
    },
  }
}
