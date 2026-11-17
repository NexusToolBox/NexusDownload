import type { CloudErrorKind, CloudPlatform } from '@shared/schemas/nexus-cloud'
import { z } from 'zod'
import { CloudError } from './cloud-adapter'
import { mergeCookies } from './credential-broker'
import {
  type CloudRequestRecord,
  diagnosticCode,
  diagnosticMessage,
  diagnosticPath,
  isLoginPage,
  requestPlatform,
} from './request-diagnostics'

export const object = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value)
export const array = (value: unknown): Record<string, unknown>[] =>
  z.array(z.record(z.string(), z.unknown())).parse(value)
export const text = (value: unknown): string =>
  value == null ? '' : z.union([z.string(), z.number()]).parse(value).toString()
export const bytes = (value: unknown): number | null =>
  value == null
    ? null
    : z.coerce.number().int().nonnegative().safe().parse(value)
/** Only explicit absolute expiry timestamps; never guess a platform's TTL. */
export function signedExpiry(address: string): number | undefined {
  const url = new URL(address)
  for (const key of ['expires', 'expire', 'expiration', 'e']) {
    const value = Number(url.searchParams.get(key))
    const time = value < 100000000000 ? value * 1000 : value
    if (
      Number.isSafeInteger(time) &&
      time > Date.now() &&
      time < Date.now() + 365 * 86400000
    )
      return time
  }
  return undefined
}
export const encode = (value: string): string =>
  encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(
      /[!'()~]/g,
      (s) => `%${s.charCodeAt(0).toString(16).toUpperCase()}`
    )
export function classifyCloudError(
  code: number,
  message: string,
  status = 200
): CloudErrorKind {
  if (/验证码|驗證碼|captcha|verify.?code/i.test(message)) return 'captcha'
  if (/风控|風控|risk|安全验证|安全驗證/i.test(message)) return 'risk'
  if (
    code === 8888 ||
    status === 429 ||
    /频繁|频率|頻繁|rate.?limit|too many/i.test(message)
  )
    return 'rate'
  if ([-6, 31001, 401].includes(code) || status === 401) return 'login'
  if (
    /未登录|登录(?:已)?(?:失效|过期)|not logged in|login expired|unauthorized/i.test(
      message
    )
  )
    return 'login'
  if ([-12, 41001].includes(code) || /提取码|passcode/i.test(message))
    return 'extraction-code'
  if (
    [14001, 41020, 31066].includes(code) ||
    /分享.*失效|share.*expir/i.test(message)
  )
    return 'expired-share'
  if (code === 23018 || /会员|权限|permission/i.test(message))
    return 'permission'
  // A bare 403/412 is ambiguous. Never start a renewal loop based only on it.
  if (status === 403 || status === 412) return 'permission'
  return 'network'
}
export interface CloudHttpOptions {
  platform?: CloudPlatform
  diagnostic?: (record: CloudRequestRecord) => void
  cookie: () => string
  merge: (cookies: string[]) => Promise<void>
  fetch?: typeof fetch
  request?: <T>(
    operation: () => Promise<T>,
    kind: 'request' | 'link' | 'transfer'
  ) => Promise<T>
}
export class CloudHttp {
  constructor(readonly options: CloudHttpOptions) {}
  async response(
    url: string,
    headers: Record<string, string>,
    body?: unknown,
    guest = false
  ) {
    let current = new URL(url)
    const platform = requestPlatform(current.hostname)
    let method = body === undefined ? 'GET' : 'POST'
    let payload =
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body)
    const requestHeaders = new Headers(headers)
    if (guest) requestHeaders.delete('Cookie')
    const signal = AbortSignal.timeout(30000)
    for (let hop = 0; hop <= 8; hop++) {
      let response: Response
      try {
        response = await (this.options.fetch ?? fetch)(current.toString(), {
          method,
          redirect: 'manual',
          signal,
          headers: requestHeaders,
          body: payload,
        })
      } catch {
        this.record(current, 0)
        throw new CloudError('network')
      }
      const cookies = response.headers.getSetCookie()
      if (!guest && cookies.length) {
        await this.options.merge(cookies)
        if (requestHeaders.has('Cookie'))
          requestHeaders.set(
            'Cookie',
            mergeCookies(requestHeaders.get('Cookie') ?? '', cookies)
          )
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      let next: URL
      try {
        next = new URL(response.headers.get('Location') ?? '', current)
      } catch {
        throw new CloudError('network')
      }
      this.record(current, response.status, undefined, next)
      await response.body?.cancel()
      if (
        next.protocol !== 'https:' ||
        !platform ||
        requestPlatform(next.hostname) !== platform
      )
        throw new CloudError('network')
      if (isLoginPage(next)) throw new CloudError('login')
      if (hop === 8 || !response.headers.has('Location'))
        throw new CloudError('network')
      if (
        response.status === 303 ||
        ([301, 302].includes(response.status) && method === 'POST')
      ) {
        method = 'GET'
        payload = undefined
        requestHeaders.delete('Content-Type')
        requestHeaders.delete('Content-Length')
      }
      current = next
    }
    throw new CloudError('network')
  }
  record(
    url: URL,
    status: number,
    json?: Record<string, unknown>,
    redirect?: URL
  ) {
    const platform = requestPlatform(url.hostname) ?? this.options.platform
    if (!platform || !this.options.diagnostic) return
    const code =
      json?.errno ?? json?.errNo ?? json?.errcode ?? json?.errCode ?? json?.code
    this.options.diagnostic({
      at: Date.now(),
      platform,
      path: diagnosticPath(url),
      status,
      redirect: redirect
        ? `${redirect.hostname}${diagnosticPath(redirect)}`.slice(0, 256)
        : undefined,
      code: diagnosticCode(code),
      message: diagnosticMessage(
        json?.message ??
          json?.err_msg ??
          json?.show_msg ??
          json?.error ??
          json?.msg
      ),
      fields: Object.keys(json ?? {})
        .filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))
        .slice(0, 64),
    })
  }
  async json(
    url: string,
    headers: Record<string, string>,
    body?: unknown,
    guest = false
  ): Promise<{ json: Record<string, unknown>; cookies: string[] }> {
    const operation = async () => {
      const cookie = guest ? '' : this.options.cookie()
      const response = await this.response(
        url,
        { ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body,
        guest
      )
      const cookies = response.headers.getSetCookie()
      const raw = await response.text()
      let json: Record<string, unknown>
      try {
        json = object(JSON.parse(raw))
      } catch {
        this.record(new URL(url), response.status)
        throw new CloudError(
          classifyCloudError(0, raw.slice(0, 4096), response.status)
        )
      }
      this.record(new URL(url), response.status, json)
      const code =
        json.success === true && json.code === 'OK'
          ? 0
          : Number(json.errno ?? json.code ?? 0)
      const message = text(json.message ?? json.err_msg ?? json.show_msg ?? '')
      if (
        !response.ok ||
        json.success === false ||
        code !== 0 ||
        (json.status !== undefined && Number(json.status) !== 200)
      )
        throw new CloudError(classifyCloudError(code, message, response.status))
      return { json, cookies }
    }
    try {
      return await (this.options.request
        ? this.options.request(
            operation,
            /share\/transfer|sharepage\/save/.test(url)
              ? 'transfer'
              : /file\/download|locatedownload|filemetas/.test(url)
                ? 'link'
                : 'request'
          )
        : operation())
    } catch (error) {
      if (error instanceof CloudError) throw error
      throw new CloudError('network')
    }
  }
}
