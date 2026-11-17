import { describe, expect, it } from 'vitest'
import { detectMedia, inlineJson, parseDomestic } from './domestic-parsers'

describe('YunX media contract replay', () => {
  const url = 'https://cdn.example.test/asset.mp4'
  const request = (body: unknown) => async () =>
    typeof body === 'string' ? body : JSON.stringify(body)
  it('extracts nested JSON without evaluating scripts', () => {
    expect(
      inlineJson('window.data = {"s":"}", "a":[{}]}; evil()', 'window.data')
    ).toEqual({ s: '}', a: [{}] })
    expect(detectMedia('https://bilibili.com.evil.test/video/BV1')).toBe(
      'external'
    )
  })
  it('preserves Bilibili playlists and prefers AVC', async () => {
    const result = await parseDomestic(
      'https://www.bilibili.com/video/BV1',
      '',
      {
        request: async (address) =>
          JSON.stringify(
            address.includes('/view?')
              ? {
                  code: 0,
                  data: {
                    bvid: 'BV1',
                    title: 'sample',
                    pages: [
                      { cid: 1, part: 'one' },
                      { cid: 2, part: 'two' },
                    ],
                  },
                }
              : {
                  data: {
                    dash: {
                      video: [
                        { id: 80, codecid: 12, baseUrl: `${url}?hevc` },
                        { id: 80, codecid: 7, baseUrl: `${url}?avc` },
                      ],
                      audio: [{ baseUrl: url }],
                    },
                  },
                }
          ),
      }
    )
    expect(result.assets).toHaveLength(2)
    expect(result.assets[0].url).toContain('?avc')
    expect(result.assets[0].audioUrl).toBe(url)
  })
  it.each([
    [
      'pixiv',
      'https://www.pixiv.net/artworks/1',
      { body: [{ urls: { original: 'https://i.pximg.net/image.png' } }] },
      'image',
    ],
    [
      'weibo',
      'https://m.weibo.cn/detail/1',
      {
        data: {
          text: 'sample',
          pics: [
            {
              large: { url: 'https://cdn.example.test/pic.jpg' },
              videoSrc: url,
            },
          ],
        },
      },
      'image',
    ],
    [
      'acfun',
      'https://www.acfun.cn/v/ac1',
      `window.videoInfo=${JSON.stringify({ title: 'sample', currentVideoInfo: { ksPlayJson: JSON.stringify({ adaptationSet: [{ representation: [{ url: 'https://cdn.example.test/stream.m3u8' }] }] }) } })}`,
      'video',
    ],
    [
      'kuaishou',
      'https://v.kuaishou.com/1',
      `window.INIT_STATE=${JSON.stringify({ one: { photo: { caption: 'sample', mainMvUrls: [{ url }] } } })}`,
      'video',
    ],
    [
      'xiaohongshu',
      'https://www.xiaohongshu.com/explore/1',
      `window.__INITIAL_STATE__=${JSON.stringify({ note: { noteDetailMap: { one: { note: { title: 'sample', imageList: [{ urlDefault: 'https://sns.example.test/bucket/hash/token!watermark' }] } } } } })}`,
      'image',
    ],
    [
      'douyin',
      'https://www.douyin.com/video/1',
      `<script id="RENDER_DATA">${encodeURIComponent(JSON.stringify({ app: { videoDetail: { desc: 'sample', video: { play_addr: { url_list: [url] } } } } }))}</script>`,
      'video',
    ],
  ])(
    '%s maps platform responses to reusable assets',
    async (platform, address, body, kind) => {
      const result = await parseDomestic(address, '', {
        request: request(body),
        probe: async () => true,
      })
      expect(result.platform).toBe(platform)
      expect(result.assets[0].kind).toBe(kind)
      if (platform === 'xiaohongshu')
        expect(result.assets[0].url).toBe('https://sns-img-bd.xhscdn.com/token')
      if (platform === 'weibo') expect(result.assets[0].motionUrl).toBe(url)
    }
  )
})
