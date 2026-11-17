import type { HttpProbe } from '@shared/schemas/nexus-workspace'

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export interface HttpPreflightResult {
  probe: HttpProbe
  size: number | null
  headers: Record<string, string>
}
/** Read response headers only. Never consume a potentially unbounded download body. */
export async function probeHttp(
  address: string,
  request = fetch
): Promise<HttpPreflightResult> {
  const headers: Record<string, string> = {}
  const signal = AbortSignal.timeout(10000)
  let retried = false
  const send = async (method: 'HEAD' | 'GET') => {
    for (;;) {
      let current = new URL(address)
      let response: Response | undefined
      for (let hop = 0; hop < 10; hop++) {
        if (
          !['http:', 'https:'].includes(current.protocol) ||
          current.username ||
          current.password
        )
          throw new Error('invalid-target')
        response = await request(current, {
          method,
          headers: {
            ...headers,
            ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
            'Accept-Encoding': 'identity',
          },
          redirect: 'manual',
          signal,
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new Error('redirect')
        current = new URL(location, current)
        response = undefined
      }
      if (!response) throw new Error('redirect')
      if (response.status !== 403 || retried) return response
      await response.body?.cancel()
      retried = true
      headers.Referer = `${new URL(address).origin}/`
      headers['User-Agent'] = BROWSER_UA
    }
  }
  const length = (response: Response) => {
    const total = /bytes\s+\d+-\d+\/(\d+)/i.exec(
      response.headers.get('content-range') ?? ''
    )?.[1]
    const raw =
      total ??
      (response.status === 206 ? null : response.headers.get('content-length'))
    const value = raw === null ? NaN : Number(raw)
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  try {
    let response: Response | undefined
    let rangedGet = false
    try {
      response = await send('HEAD')
    } catch {
      /* A GET can still work when HEAD is unsupported. */
    }
    if (!response?.ok || length(response) === null) {
      await response?.body?.cancel()
      rangedGet = true
      response = await send('GET')
    }
    const status = response.status
    const size = response.ok ? length(response) : null
    const range =
      response.status === 206 ||
      /bytes/i.test(response.headers.get('accept-ranges') ?? '')
        ? true
        : rangedGet ||
            response.headers.get('accept-ranges') === 'none' ||
            (response.ok &&
              response.status === 200 &&
              response.headers.has('transfer-encoding'))
          ? false
          : null
    const error = response.ok
      ? undefined
      : status === 401
        ? 'unauthorized'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not-found'
            : status >= 500
              ? 'server'
              : 'http'
    await response.body?.cancel()
    return {
      size,
      headers,
      probe: {
        status,
        range:
          response.status === 200 && response.ok && size === null
            ? false
            : range,
        retried,
        error,
      },
    }
  } catch {
    return {
      size: null,
      headers,
      probe: { status: 0, range: null, retried, error: 'network' },
    }
  }
}
