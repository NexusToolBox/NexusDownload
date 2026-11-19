// Sanitized, constructed playback of YunX Desktop 1.3.4 API response shapes.
// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BAIDU_DOWNLOAD_UA, BaiduAdapter } from './baidu-adapter'
import { type AdapterFile, verifyResource } from './cloud-adapter'
import { CloudHttp } from './cloud-http'
import {
  parseCloudShare,
  QUARK_UA,
  QuarkUcAdapter,
  UC_CLOUD_UA,
} from './quark-uc-adapter'

describe('UC non-original resource contract', () => {
  it('never authorizes playback stitching using the original file timestamp', () => {
    const file = {
      id: 'f',
      parent: '0',
      path: 'f.mp4',
      name: 'f.mp4',
      directory: false,
      bytes: 5,
      version: 'v1',
    }
    const stream = {
      fileId: 'f',
      kind: 'playback-stream' as const,
      bytes: null,
      version: 'v1',
      url: 'https://playback.invalid/file',
      headers: {},
    }
    expect(() => verifyResource(file, stream, stream)).toThrow('cloud.identity')
  })
  it.each(['mp4', 'm3u8'])(
    'explicitly separates %s playback from original bytes',
    async (format) => {
      const secret = randomBytes(24).toString('hex')
      const http = new CloudHttp({
        cookie: () => secret,
        merge: async () => undefined,
        fetch: async (input, init) => {
          if (String(input).includes('/download'))
            return Response.json({ code: 23018, message: 'permission' })
          const body = JSON.parse(String(init?.body))
          expect(body).toEqual({
            fid: 'f',
            resolutions: 'low,normal,high,super,2k,4k',
            supports: 'fmp4_av,m3u8,dolby_vision',
          })
          return Response.json({
            status: 200,
            data: {
              video_list: [
                {
                  video_info: {
                    url: `https://playback.invalid/file?sign=${secret}`,
                    format,
                  },
                },
              ],
            },
          })
        },
      })
      const adapter = new QuarkUcAdapter('uc', http)
      const pending = adapter.getDownloadLink(
        {
          id: 'f',
          parent: '0',
          path: 'f.mp4',
          name: 'f.mp4',
          directory: false,
          bytes: 5000000000,
          version: 'v1',
        },
        'own'
      )
      {
        const resource = await pending
        expect(resource.mediaType).toBe(format === 'm3u8' ? 'hls' : undefined)
        expect(resource.kind).toBe('playback-stream')
        expect(resource.bytes).toBe(null)
      }
    }
  )
})

for (const platform of ['quark', 'uc', 'baidu'] as const) {
  describe(`${platform} shared adapter contract`, () => {
    function setup() {
      const secret = randomBytes(24).toString('hex')
      const cookie =
        platform === 'baidu'
          ? `BDUSS=${secret}`
          : `__pus=${secret}; __puus=${secret}`
      let mode = 'normal'
      const calls: { url: URL; headers: Headers; body: unknown }[] = []
      const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        const body = init?.body ? String(init.body) : ''
        calls.push({
          url,
          headers,
          body: body.startsWith('{') ? JSON.parse(body) : body,
        })
        let data: unknown
        if (mode === 'risk')
          data =
            platform === 'baidu'
              ? { errno: 8888 }
              : { status: 400, code: 500, message: '风控安全验证' }
        else if (url.pathname === '/api/loginStatus')
          data = {
            errno: 0,
            login_info: {
              username: 'Fixture',
              photo_url: 'http://himg.bdimg.com/sample',
            },
          }
        else if (url.pathname === '/account/info')
          data = {
            success: true,
            code: 'OK',
            data: { nickname: 'Fixture', avatarUri: '//image.uc.cn/sample' },
          }
        else if (url.pathname.includes('gettemplatevariable'))
          data = { errno: 0, result: { bdstoken: secret } }
        else if (url.pathname.endsWith('/token'))
          data = { status: 200, data: { stoken: secret, title: '回放目录' } }
        else if (url.pathname.endsWith('/verify'))
          data = { errno: 0, randsk: secret }
        else if (url.pathname.endsWith('/filemetas'))
          data = {
            errno: 0,
            info: [
              {
                dlink: `https://download.invalid/original?sign=${secret}`,
                size: mode === 'size' ? 2 : 5000000000,
              },
            ],
          }
        else if (url.pathname.endsWith('/download'))
          data = {
            status: 200,
            code: 0,
            data: [
              {
                fid: 'file1',
                file_name: 'original.zip',
                size: mode === 'size' ? 2 : 5000000000,
                download_url: `https://original-host.invalid/original?sign=${secret}`,
              },
            ],
          }
        else {
          const page = Number(
            url.searchParams.get('_page') ?? url.searchParams.get('page') ?? '1'
          )
          const list =
            page === 1
              ? platform === 'baidu'
                ? [
                    {
                      fs_id: 'file1',
                      server_filename: 'original.zip',
                      size: 5000000000,
                      isdir: 0,
                      path: '/original.zip',
                      server_mtime: 123,
                    },
                  ]
                : [
                    {
                      fid: 'file1',
                      file_name: 'original.zip',
                      size: 5000000000,
                      dir: false,
                      pdir_fid: '0',
                      updated_at: 123,
                      share_fid_token: secret,
                    },
                  ]
              : []
          data =
            platform === 'baidu'
              ? { errno: 0, list, share_id: 'share1', uk: 'user1' }
              : { status: 200, data: { list } }
        }
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `__pugs=${secret}; Secure`,
          },
        })
      }
      const http = new CloudHttp({
        cookie: () => cookie,
        merge: async () => undefined,
        fetch: fetcher,
      })
      const adapter =
        platform === 'baidu'
          ? new BaiduAdapter(http)
          : new QuarkUcAdapter(platform, http)
      return {
        adapter,
        calls,
        mode: (value: string) => {
          mode = value
        },
      }
    }
    it('selects the official account avatar field and sends the expected site context', async () => {
      const { adapter, calls } = setup()
      expect(await adapter.fetchProfile()).toMatchObject({
        nickname: 'Fixture',
        avatar:
          platform === 'baidu'
            ? 'https://himg.bdimg.com/sample'
            : 'https://image.uc.cn/sample',
        avatarField:
          platform === 'baidu' ? 'login_info.photo_url' : 'data.avatarUri',
      })
      expect(calls).toHaveLength(1)
      const expected = {
        baidu: [
          'https://pan.baidu.com/api/loginStatus',
          'https://pan.baidu.com/disk/main',
        ],
        quark: ['https://pan.quark.cn/account/info', 'https://pan.quark.cn/'],
        uc: ['https://drive.uc.cn/account/info', 'https://drive.uc.cn/'],
      }[platform]
      expect(calls[0].url.href).toBe(expected[0])
      expect(calls[0].headers.get('Referer')).toBe(expected[1])
    })
    it('lists original metadata including files larger than 4 GiB, resolves and renews with matching identity', async () => {
      const { adapter, calls } = setup()
      const files = await adapter.listFiles('0')
      expect(files.length).toBe(1)
      expect(files[0].bytes).toBe(5000000000)
      const resource = await adapter.getDownloadLink(files[0], 'own')
      const renewed = await adapter.renew(files[0], 'own')
      expect(() => verifyResource(files[0], renewed, resource)).not.toThrow()
      expect(Object.keys(resource.headers).includes('Cookie')).toBe(true)
      expect(resource.headers['User-Agent']).toBe(
        platform === 'baidu'
          ? BAIDU_DOWNLOAD_UA
          : platform === 'quark'
            ? QUARK_UA
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )
      if (platform === 'quark')
        expect(new URL(resource.url).hostname).toBe('original-host.invalid')
      if (platform === 'uc')
        expect(
          calls.some((call) => call.headers.get('User-Agent') === UC_CLOUD_UA)
        ).toBe(true)
    })
    it('stops on inconsistent size, different versions, and missing identity evidence', async () => {
      const test = setup()
      const file = (await test.adapter.listFiles('0'))[0]
      const first = await test.adapter.getDownloadLink(file, 'own')
      test.mode('size')
      await expect(test.adapter.getDownloadLink(file, 'own')).rejects.toThrow(
        'cloud.size'
      )
      expect(() =>
        verifyResource(file, { ...first, version: 'different' }, first)
      ).toThrow('cloud.identity')
      expect(() =>
        verifyResource(
          file,
          { ...first, version: undefined },
          { ...first, version: undefined }
        )
      ).toThrow('cloud.identity')
    })
    it('classifies risk and frequency signals without automatic retries', async () => {
      const test = setup()
      test.mode('risk')
      await expect(test.adapter.listFiles('0')).rejects.toThrow(
        platform === 'baidu' ? 'cloud.rate' : 'cloud.risk'
      )
      expect(test.calls.length).toBe(1)
    })
    it('opens shares with platform-specific token and listing parameters', async () => {
      const test = setup()
      const host =
        platform === 'baidu'
          ? 'pan.baidu.com'
          : platform === 'uc'
            ? 'drive.uc.cn'
            : 'pan.quark.cn'
      const session = await test.adapter.createSession(
        `https://${host}/s/1share 提取码：${randomBytes(2).toString('hex')}`
      )
      await test.adapter.listFiles('0', session)
      if (platform === 'uc')
        expect(
          test.calls.some((c) =>
            c.url.pathname.endsWith('/transfer_share/detail')
          )
        ).toBe(true)
      if (platform === 'quark')
        expect(
          test.calls.some((c) => c.url.searchParams.get('ver') === '2')
        ).toBe(true)
      if (platform === 'baidu')
        expect(
          test.calls.some((c) => c.headers.get('Cookie')?.includes('BDCLND='))
        ).toBe(true)
    })
    if (platform !== 'baidu')
      it('binds guest cookies to the same response and excludes the account cookie', async () => {
        const test = setup()
        const file = (await test.adapter.listFiles('0'))[0]
        const session = {
          shareId: 'share1',
          token: randomBytes(12).toString('hex'),
          title: '',
        }
        const resource = await test.adapter.getDownloadLink(
          file,
          'guest',
          session
        )
        expect(resource.headers.Cookie.startsWith('__pugs=')).toBe(true)
        expect(test.calls.at(-1)?.headers.has('Cookie')).toBe(false)
        expect(
          test.calls.at(-1)?.body &&
            Object.keys(test.calls.at(-1)?.body as object).includes(
              'fids_token'
            )
        ).toBe(true)
      })
  })
}
describe('share parser', () => {
  it('rejects a platform name placed inside another hostname', () => {
    expect(() =>
      parseCloudShare('https://pan.quark.cn.evil.invalid/s/share1', 'quark')
    ).toThrow()
  })
  it('never authorizes a size-only renewal', () => {
    const file: AdapterFile = {
      id: '1',
      bytes: 10,
      name: 'a',
      directory: false,
      parent: '0',
      path: 'a',
    }
    const resource = {
      fileId: '1',
      bytes: 10,
      kind: 'original-file' as const,
      url: 'https://invalid.test/a',
      headers: {},
    }
    expect(() => verifyResource(file, resource, resource)).toThrow(
      'cloud.identity'
    )
  })
})
