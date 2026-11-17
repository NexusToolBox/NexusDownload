import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveKouling } from './kouling'

describe('explicitly enabled command conversion', () => {
  it('uses Thunder first and never sends the secondary service key there', async () => {
    const key = randomBytes(24).toString('hex')
    let count = 0
    const url = await resolveKouling('示例口令', key, async (_input, init) => {
      count++
      expect(new Headers(init?.headers).get('X-API-Key') === null).toBe(true)
      return Response.json({
        ext: { kouling_type: 'share_page' },
        location: 'https://pan.xunlei.com/s/example',
      })
    })
    expect(count).toBe(1)
    expect(url).toBe('https://pan.xunlei.com/s/example')
  })
  it('falls back once, sends only the command and the explicit service key', async () => {
    const key = randomBytes(24).toString('hex')
    let count = 0
    const result = await resolveKouling(
      '示例口令',
      key,
      async (_input, init) => {
        count++
        if (count === 1) return Response.json({})
        const headers = new Headers(init?.headers)
        expect(
          headers.get('X-API-Key') === key && headers.get('Cookie') === null
        ).toBe(true)
        expect(JSON.parse(String(init?.body))).toEqual({
          clipboard: '示例口令',
          platform: 'auto',
          step: 'parse',
        })
        return Response.json({
          success: true,
          data: { pwdId: 'example', platform: 'uc' },
        })
      }
    )
    expect(result).toBe('https://drive.uc.cn/s/example')
    expect(count).toBe(2)
  })
})
