// Constructed playback of OpenList v4.2.9 Aliyun Open/share drivers. AGPL-3.0-only.
import { randomBytes } from 'node:crypto'
import {
  aliyunCredentialSchema,
  aliyunLoginSchema,
} from '@shared/schemas/nexus-aliyun'
import { describe, expect, it } from 'vitest'
import { AliyunAdapter, exchangeAliyunCode } from './aliyun-adapter'
import { verifyResource } from './cloud-adapter'
import { CloudHttp } from './cloud-http'

describe('Aliyun shared CloudAdapter contract', () => {
  function fixture(
    mode: 'official' | 'online' | 'share' = 'official',
    consent = true
  ) {
    const secret = randomBytes(24).toString('hex')
    let state = JSON.stringify(
      aliyunCredentialSchema.parse({
        mode,
        clientId: secret,
        clientSecret: secret,
        redirectUri: 'https://client.invalid/callback',
        serviceUrl: 'https://refresh.invalid/renew',
        refreshToken: secret,
        consent,
      })
    )
    let error = ''
    const calls: {
      url: URL
      headers: Headers
      body: Record<string, unknown>
    }[] = []
    const http = new CloudHttp({
      cookie: () => state,
      merge: async () => {},
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        calls.push({ url, headers, body })
        if (error) return Response.json({ code: error, message: secret })
        if (
          url.pathname.endsWith('/access_token') ||
          url.pathname.endsWith('/account/token') ||
          url.hostname === 'refresh.invalid'
        )
          return Response.json({
            access_token: secret,
            refresh_token: secret,
            expires_in: 7200,
          })
        if (url.pathname.endsWith('getDriveInfo'))
          return Response.json({ resource_drive_id: 'drive' })
        if (url.pathname.endsWith('getSpaceInfo'))
          return Response.json({
            personal_space_info: { total_size: 100, used_size: 5 },
          })
        if (url.pathname.endsWith('get_share_token'))
          return Response.json({ share_token: secret })
        if (url.pathname.endsWith('list'))
          return Response.json({
            next_marker: body.marker ? '' : 'next',
            items: [
              {
                file_id: body.marker ? 'f2' : 'f1',
                parent_file_id: 'root',
                drive_id: 'drive',
                name: 'sample.bin',
                size: 5,
                type: 'file',
                updated_at: 'v1',
                content_hash_name: 'sha1',
                content_hash: 'a'.repeat(40),
              },
            ],
          })
        return Response.json({
          url: `https://cdn.invalid/file?sign=${secret}`,
          download_url: `https://cdn.invalid/file?sign=${secret}`,
        })
      },
    })
    const adapter = new AliyunAdapter(http, async (exchange) => {
      state = await exchange(state)
      return state
    })
    return {
      adapter,
      http,
      calls,
      secret,
      credential: () => aliyunCredentialSchema.parse(JSON.parse(state)),
      setError: (code: string) => {
        error = code
      },
    }
  }
  it('uses own app exchange/local refresh and preserves identity through renewal', async () => {
    const { adapter, http, calls, credential } = fixture()
    await exchangeAliyunCode(
      http,
      credential(),
      randomBytes(24).toString('hex')
    )
    await adapter.checkLogin()
    expect(await adapter.quota()).toEqual({ total: 100, used: 5 })
    const files = await adapter.listFiles('0')
    expect(files.length).toBe(2)
    const link = await adapter.getDownloadLink(files[0], 'own')
    verifyResource(files[0], await adapter.renew(files[0], 'own'), link)
    expect(link.headers).toEqual({})
    expect(calls.some((c) => c.url.hostname === 'refresh.invalid')).toBe(false)
    expect(
      calls.find((c) => c.url.pathname.endsWith('getDownloadUrl'))?.body
        .expire_sec
    ).toBe(14400)
    expect(() => verifyResource(files[0], { ...link, bytes: 6 })).toThrow(
      'cloud.size'
    )
  })
  it('requires explicit consent for online refresh and keeps the upstream query protocol', async () => {
    const off = fixture('online', false)
    await expect(off.adapter.checkLogin()).rejects.toThrow('cloud.permission')
    expect(off.calls.length).toBe(0)
    const on = fixture('online')
    await on.adapter.checkLogin()
    const refresh = on.calls.find((c) => c.url.hostname === 'refresh.invalid')
    expect(refresh?.url.searchParams.get('refresh_ui') === on.secret).toBe(true)
    expect(refresh?.url.searchParams.get('driver_txt')).toBe('alicloud_qr')
    expect(
      aliyunLoginSchema.safeParse({
        platform: 'aliyun',
        mode: 'online',
        refreshToken: on.secret,
        serviceUrl: 'http://refresh.invalid/',
        consent: true,
      }).success
    ).toBe(false)
  })
  it('isolates share authorization and uses anonymous listing plus share-bound links', async () => {
    const { adapter, calls } = fixture('share')
    await adapter.checkLogin()
    const session = await adapter.createSession(
      'https://www.alipan.com/s/example'
    )
    const files = await adapter.listFiles('0', session)
    const link = await adapter.getDownloadLink(
      files[0],
      'without-save',
      session
    )
    expect(link.headers).toEqual({ Referer: 'https://www.alipan.com/' })
    expect(
      calls
        .find((c) => c.url.pathname.endsWith('/list'))
        ?.headers.has('Authorization')
    ).toBe(false)
    const request = calls.find((c) =>
      c.url.pathname.endsWith('get_share_link_download_url')
    )
    expect(request?.body.expire_sec).toBe(600)
    expect(
      request?.headers.get('x-share-token')?.length === session.token.length
    ).toBe(true)
    await expect(adapter.listFiles('0')).rejects.toThrow('cloud.open-platform')
    const official = fixture()
    await official.adapter.checkLogin()
    await expect(
      official.adapter.getDownloadLink(files[0], 'without-save', session)
    ).rejects.toThrow('cloud.share-auth')
  })
  it.each([
    ['AccessTokenInvalid', 'login'],
    ['ShareLinkPwdNotMatch', 'extraction-code'],
    ['ShareLinkExpired', 'expired-share'],
  ] as const)('classifies %s and bounds retries', async (code, kind) => {
    const { adapter, setError, calls } = fixture()
    setError(code)
    await expect(adapter.checkLogin()).rejects.toThrow(`cloud.${kind}`)
    expect(calls.length <= 3).toBe(true)
  })
})
