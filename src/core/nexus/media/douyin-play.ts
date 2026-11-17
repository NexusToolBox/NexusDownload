// YunX DouyinParser.probePlay behavior. SPDX-License-Identifier: AGPL-3.0-only
export interface MediaProbeResult {
  url: string
  bytes: number
}

/** Bounded two-byte probe; static CDN requests never carry account cookies. */
export async function probeDouyinMedia(
  address: string,
  headers: Record<string, string>,
  request: typeof fetch = fetch
): Promise<MediaProbeResult | null> {
  const initial = new URL(address)
  if (
    initial.username ||
    initial.password ||
    initial.origin !== 'https://aweme.snssdk.com' ||
    initial.pathname !== '/aweme/v1/play/'
  )
    return null
  const safeHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) =>
      ['user-agent', 'referer'].includes(key.toLowerCase())
    )
  )
  const signal = AbortSignal.timeout(5000)
  let current = initial.href
  try {
    for (let hop = 0; hop < 6; hop++) {
      const response = await request(current, {
        headers: { ...safeHeaders, Range: 'bytes=0-1' },
        redirect: 'manual',
        signal,
      })
      await response.body?.cancel()
      if (response.status >= 300 && response.status < 400) {
        const next = new URL(response.headers.get('location') || '', current)
        if (next.protocol !== 'https:' || next.username || next.password)
          return null
        current = next.href
        continue
      }
      const type = response.headers.get('content-type') || ''
      if (!response.ok || !/^(?:video\/|application\/octet-stream)/i.test(type))
        return null
      const range = response.headers
        .get('content-range')
        ?.match(/^bytes \d+-\d+\/(\d+)$/i)
      const bytes = Number(
        range?.[1] ??
          (response.status === 200 ? response.headers.get('content-length') : 0)
      )
      return Number.isSafeInteger(bytes) && bytes > 0
        ? { url: current, bytes }
        : null
    }
  } catch {
    /* A failed candidate must not hide the original direct URL. */
  }
  return null
}

export async function resolveDouyinPlay(
  play: unknown,
  fallback: string,
  headers: Record<string, string>,
  probe?: (
    url: string,
    headers: Record<string, string>
  ) => Promise<MediaProbeResult | null>
): Promise<MediaProbeResult | null> {
  if (!probe) return null
  const record =
    play && typeof play === 'object' ? (play as Record<string, unknown>) : {}
  let token = typeof record.uri === 'string' ? record.uri : ''
  if (!token && fallback) {
    try {
      token = new URL(fallback).searchParams.get('video_id') || ''
    } catch {
      return null
    }
  }
  if (!token || token.length > 512) return null
  let best: MediaProbeResult | null = null
  for (const ratio of ['1080p', '720p', '540p', '360p']) {
    try {
      const url = new URL('https://aweme.snssdk.com/aweme/v1/play/')
      url.search = new URLSearchParams({ video_id: token, ratio }).toString()
      const candidate = await probe(url.href, headers)
      if (
        candidate &&
        Number.isSafeInteger(candidate.bytes) &&
        candidate.bytes > (best?.bytes ?? 0)
      )
        best = candidate
    } catch {
      /* Continue with the remaining fixed candidates. */
    }
  }
  return best
}
