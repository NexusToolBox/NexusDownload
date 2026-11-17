// Constructed playback of YunX Desktop 1.3.4 Pan123 API shapes; AGPL-3.0-only.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyResource } from './cloud-adapter'
import { CloudHttp } from './cloud-http'
import { Pan123Adapter } from './pan123-adapter'
import { pan123PasswordLogin, pan123Sign } from './pan123-auth'

describe('123 shared CloudAdapter contract', () => {
  function fixture() {
    const token = randomBytes(24).toString('hex')
    const device = randomBytes(16).toString('hex')
    let code = 0
    const calls: {
      url: URL
      headers: Headers
      body: Record<string, unknown>
    }[] = []
    const http = new CloudHttp({
      cookie: () => JSON.stringify({ token, device }),
      merge: async () => {},
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        calls.push({ url, headers, body })
        if (code) return Response.json({ code, message: token })
        if (url.hostname === 'cdn.invalid')
          return new Response('bytes', { headers: { 'Content-Length': '5' } })
        if (url.pathname.endsWith('/sign_in'))
          return Response.json({ code: 200, data: { token } })
        if (url.pathname.endsWith('/user/info'))
          return Response.json({
            code: 0,
            data: {
              Nickname: 'user',
              SpacePermanent: 100,
              SpaceTemp: 5,
              SpaceUsed: 20,
            },
          })
        if (url.pathname.includes('download'))
          return Response.json({
            code: 0,
            data: {
              DownloadURL: `https://download.invalid/download-v2?params=${Buffer.from(`https://cdn.invalid/file?sign=${token}`).toString('base64url')}`,
            },
          })
        const last = Number(url.searchParams.get('Page')) === 2
        return Response.json({
          code: 0,
          data: {
            Next: last ? '-1' : '',
            InfoList: [
              {
                FileId: last ? '2' : '1',
                FileName: 'sample.bin',
                Size: 5,
                Type: 0,
                ParentFileId: '0',
                S3KeyFlag: 'flag',
                Etag: 'a'.repeat(32),
                StorageNode: 'node',
                UpdateAt: 'v1',
              },
            ],
          },
        })
      },
    })
    return {
      adapter: new Pan123Adapter(http),
      http,
      token,
      device,
      calls,
      setCode: (n: number) => {
        code = n
      },
    }
  }
  it('matches the upstream CRC32/time offset signing vector', () => {
    expect(
      pan123Sign('/b/api/share/download/info', 1700000000, 123456)
    ).toEqual({
      'auth-key': 'f2ac3dd',
      'auth-value': '1700000000-123456-f8916b2e',
    })
  })
  it('exchanges a password without trimming it, preserves device and uses the login success code', async () => {
    const { http, calls, token, device } = fixture()
    const password = ` ${randomBytes(16).toString('hex')} `
    const result = await pan123PasswordLogin(http, device, ' user ', password)
    expect(result.token === token && result.device === device).toBe(true)
    expect(calls[0].body.password === password).toBe(true)
    expect(calls[0].body.passport).toBe('user')
    expect(calls[0].headers.get('app-version')).toBe('132')
    expect(calls[0].headers.has('auth-key')).toBe(false)
  })
  it('paginates own/share files, downloads and renews without transfer or CDN authorization', async () => {
    const { adapter, calls } = fixture()
    await adapter.checkLogin()
    expect(await adapter.quota()).toEqual({ total: 105, used: 20 })
    const own = await adapter.listFiles('0')
    expect(own.length).toBe(2)
    expect(own[0].hash).toBe(`md5:${'a'.repeat(32)}`)
    const session = await adapter.createSession(
      'https://www.123pan.com/s/example'
    )
    const files = await adapter.listFiles('0', session)
    expect(files.length).toBe(2)
    const resource = await adapter.getDownloadLink(own[0], 'own')
    verifyResource(own[0], await adapter.renew(own[0], 'own'), resource)
    verifyResource(
      files[0],
      await adapter.getDownloadLink(files[0], 'without-save', session)
    )
    expect(resource.headers.Referer).toBe('https://yun.123pan.cn/')
    expect(
      calls
        .filter((c) => c.url.hostname === 'cdn.invalid')
        .every(
          (c) => !c.headers.has('authorization') && !c.headers.has('cookie')
        )
    ).toBe(true)
    expect(
      calls
        .find((c) => c.url.pathname === '/b/api/share/download/info')
        ?.headers.get('platform')
    ).toBe('android')
    expect(
      calls
        .filter((c) => c.url.pathname === '/b/api/share/get')
        .every(
          (c) =>
            !c.headers.has('authorization') &&
            !c.url.searchParams.has('SharePwd')
        )
    ).toBe(true)
    await expect(adapter.ensureTempDir()).rejects.toThrow('cloud.unsupported')
    expect(() => verifyResource(own[0], { ...resource, bytes: 6 })).toThrow(
      'cloud.size'
    )
  })
  it.each([
    [401, 'login'],
    [429, 'rate'],
    [5103, 'extraction-code'],
  ] as const)(
    'classifies %i without leaking server messages',
    async (code, kind) => {
      const { adapter, setCode } = fixture()
      setCode(code)
      await expect(adapter.checkLogin()).rejects.toThrow(`cloud.${kind}`)
    }
  )
})
