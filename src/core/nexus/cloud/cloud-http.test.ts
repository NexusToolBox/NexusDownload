import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CloudHttp } from './cloud-http'
import { mergeCookies } from './credential-broker'
import { platformRequest } from './platform-request'

describe('cloud session transport', () => {
  it('follows platform redirects with refreshed cookies and persists each hop', async () => {
    const secret = randomBytes(24).toString('hex')
    let cookie = ''
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: 'https://pan.baidu.com/api/quota',
            'Set-Cookie': `STOKEN=${secret}; Path=/`,
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ errno: 0 }))
    const http = new CloudHttp({
      cookie: () => cookie,
      merge: async (values) => {
        cookie = mergeCookies(cookie, values)
      },
      fetch: send,
    })
    await http.json('https://pan.baidu.com/api/list', { Cookie: 'BDUSS' })
    expect(cookie.includes(secret)).toBe(true)
    expect(
      new Headers(send.mock.calls[1][1]?.headers)
        .get('Cookie')
        ?.includes(secret)
    ).toBe(true)
    expect(send.mock.calls[0][1]?.redirect).toBe('manual')
  })
  it.each([
    ['https://passport.baidu.com/login', 'login'],
    ['https://untrusted.invalid/api/info', 'network'],
    ['https://pan.baidu.com.evil.invalid/api/info', 'network'],
  ])(
    'blocks a redirect to %s before forwarding credentials',
    async (target, kind) => {
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { Location: target } })
        )
      const http = new CloudHttp({
        cookie: () => '',
        merge: async () => {},
        fetch: send,
      })
      await expect(
        http.json('https://pan.baidu.com/api/list', {})
      ).rejects.toThrow(`cloud.${kind}`)
      expect(send).toHaveBeenCalledOnce()
    }
  )
  it('persists cookies even on platform validation errors and emits only safe diagnostics', async () => {
    const secret = randomBytes(24).toString('hex')
    let cookie = ''
    const records: unknown[] = []
    const http = new CloudHttp({
      cookie: () => cookie,
      merge: async (v) => {
        cookie = mergeCookies(cookie, v)
      },
      diagnostic: (record) => records.push(record),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            state: false,
            errno: 401,
            error: `未登录 ${secret} private-file.txt`,
          },
          { headers: { 'Set-Cookie': `SEID=${secret}; Path=/` } }
        )
      ),
    })
    await expect(
      platformRequest(
        http,
        `https://webapi.115.com/user/info?token=${secret}`,
        { Cookie: secret },
        undefined,
        'request',
        () => {
          throw new Error('invalid')
        }
      )
    ).rejects.toThrow()
    expect(cookie.includes(secret)).toBe(true)
    const output = JSON.stringify(records)
    expect(output.includes(secret) || output.includes('private-file')).toBe(
      false
    )
    expect(records).toMatchObject([
      {
        path: '/user/info',
        status: 200,
        code: 401,
        message: '未登录',
        fields: ['state', 'errno', 'error'],
      },
    ])
  })
  it('records custom refresh services under their platform without trusting redirects', async () => {
    const records: unknown[] = []
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://api.alipan.com/api/user/info' },
      })
    )
    const http = new CloudHttp({
      platform: 'aliyun',
      cookie: () => '',
      merge: async () => {},
      diagnostic: (record) => records.push(record),
      fetch: send,
    })
    await expect(
      http.json('https://refresh.invalid/api/token', {})
    ).rejects.toThrow('cloud.network')
    expect(send).toHaveBeenCalledOnce()
    expect(records).toMatchObject([
      { platform: 'aliyun', path: '/api/token', status: 302 },
    ])
  })
})
