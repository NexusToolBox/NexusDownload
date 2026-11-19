import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { inspectAccountHealth } from './account-health'
import { CloudHttp } from './cloud-http'
import {
  QUARK_UA,
  QuarkUcAdapter,
  UC_CLOUD_UA,
  UC_UA,
} from './quark-uc-adapter'

it.each(['quark', 'uc'] as const)(
  '%s accepts account code OK and uses the official quota headers',
  async (platform) => {
    const origin =
      platform === 'uc' ? 'https://drive.uc.cn' : 'https://pan.quark.cn'
    const secret = randomBytes(24).toString('hex')
    const requests: { url: URL; headers: Headers }[] = []
    const http = new CloudHttp({
      cookie: () => secret,
      merge: async () => {},
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        requests.push({ url, headers })
        return Response.json(
          url.pathname === '/account/info'
            ? { code: 'OK', success: true, data: { nickname: 'Account' } }
            : { status: 200, data: { total_capacity: 100, use_capacity: 25 } }
        )
      },
    })
    const adapter = new QuarkUcAdapter(platform, http)
    await adapter.checkLogin()
    expect(requests[0].url.href).toBe(`${origin}/account/info`)
    expect(requests[0].headers.get('User-Agent')).toBe(
      platform === 'uc' ? UC_UA : QUARK_UA
    )
    expect(await adapter.quota()).toEqual({ total: 100, used: 25 })
    expect(requests[1].headers.get('Origin')).toBe(origin)
    expect(requests[1].headers.get('Referer')).toBe(`${origin}/`)
    expect(requests[1].headers.get('User-Agent')).toBe(
      platform === 'uc' ? UC_CLOUD_UA : QUARK_UA
    )
  }
)

for (const platform of ['quark', 'uc'] as const) {
  it.each([
    ['VIP', true],
    ['SUPER_VIP', true],
    ['EXP_VIP', true],
    ['EXP_SVIP', true],
    ['NORMAL', false],
    ['UNRECOGNIZED', null],
    [undefined, null],
  ] as const)(
    '%s: reads membership tier with one quota probe',
    async (tier, member) => {
      const paths: string[] = []
      const adapter = new QuarkUcAdapter(
        platform,
        new CloudHttp({
          cookie: () => '',
          merge: async () => {},
          fetch: async (input) => {
            const url = new URL(String(input))
            paths.push(url.pathname)
            return Response.json(
              url.pathname === '/account/info'
                ? { code: 'OK', success: true, data: { nickname: 'Fixture' } }
                : {
                    status: 200,
                    data: {
                      member_type: tier,
                      total_capacity: 200,
                      use_capacity: 30,
                    },
                  }
            )
          },
        })
      )
      expect(await inspectAccountHealth(adapter)).toMatchObject({
        login: 'valid',
        member,
        quota: { total: 200, used: 30 },
      })
      expect(paths).toEqual(['/account/info', '/1/clouddrive/member'])
    }
  )
}
