import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
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
