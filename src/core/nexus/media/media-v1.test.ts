import { describe, expect, it, vi } from 'vitest'
import { archiveEntryList } from '../workflow/archive-service'
import { parseDomestic } from './domestic-parsers'
import { douyinDetail } from './douyin-data'
import { livePhotoExif } from './live-photo-writer'
import { ugoiraFramesSchema } from './ugoira'

describe('media completion and fallback contracts', () => {
  it('resolves Weibo TV through its post id instead of treating the video id as a post', async () => {
    const requested: string[] = []
    const result = await parseDomestic(
      'https://weibo.com/tv/show/1034:1?mid=3501756485200075',
      '',
      {
        request: async (url) => {
          requested.push(url)
          return JSON.stringify({
            data: {
              text: 'video',
              page_info: {
                urls: { mp4_hd_mp4: 'https://cdn.example.test/video.mp4' },
              },
            },
          })
        },
      }
    )
    expect(new URL(requested[0]).searchParams.get('id')).toBe('z0JH2lOMb')
    expect(result.assets[0].url).toBe('https://cdn.example.test/video.mp4')
  })
  it('accepts ordinary RAR negative fields and rejects actual links or streams', () => {
    const entry =
      'Path = local.bin\r\nSize = 10\r\nAttributes = A\r\nAlternate Stream = -\r\nSymbolic Link = \r\nHard Link = \r\n'
    expect(archiveEntryList(entry).bytes).toBe(10)
    for (const extra of [
      'Symbolic Link = target',
      'Hard Link = -',
      'Copy Link = other',
      'Alternate Stream = +',
    ])
      expect(() => archiveEntryList(`${entry}${extra}`)).toThrow(
        'processing.unsafeArchive'
      )
  })
  it('parses Pixiv animation timing, rejecting traversal and duplicate frames', async () => {
    const frames = [
      { file: '000000.jpg', delay: 120 },
      { file: '000001.jpg', delay: 80 },
    ]
    const result = await parseDomestic('https://www.pixiv.net/artworks/1', '', {
      request: async (u) =>
        JSON.stringify({
          body: u.endsWith('ugoira_meta')
            ? { originalSrc: 'https://i.pximg.net/animation.zip', frames }
            : { illustType: 2, title: 'animation' },
        }),
    })
    expect(result.assets[0].ugoira).toEqual(frames)
    for (const bad of [
      [{ file: '../escape.jpg', delay: 10 }],
      [frames[0], frames[0]],
      [{ file: 'image.jpg', delay: 0 }],
    ])
      expect(ugoiraFramesSchema.safeParse(bad).success).toBe(false)
  })
  it('does not mistake recommendations for the selected Douyin work; retries missing SSR and accepts serialized page JSON', async () => {
    const detail = {
      aweme_id: '1',
      desc: 'work',
      video: { playAddr: [{ src: 'https://cdn.example.test/video.mp4' }] },
    }
    expect(
      douyinDetail({ aweme_detail: { ...detail, aweme_id: '2' } }, '1')
    ).toBeUndefined()
    const anonymousCookie = vi.fn(async () => ''),
      page = vi.fn(async () => JSON.stringify({ aweme_detail: detail }))
    const result = await parseDomestic('https://www.douyin.com/video/1', '', {
      anonymousCookie,
      page,
      request: async () => 'window._ROUTER_DATA={"loaderData":{}}',
    })
    expect(anonymousCookie.mock.calls).toEqual([[false], [true]])
    expect(page).toHaveBeenCalledOnce()
    expect(result.assets[0].url).toBe('https://cdn.example.test/video.mp4')
  })
  it('keeps XHS share parameters on the alternate path and preserves fallback notices', async () => {
    const urls: string[] = []
    const result = await parseDomestic(
      'https://www.xiaohongshu.com/explore/1',
      '',
      {
        request: async (u) => {
          urls.push(u)
          if (urls.length === 1) return '<html></html>'
          return (
            'window.__INITIAL_STATE__=' +
            JSON.stringify({
              noteData: {
                data: {
                  noteData: {
                    imageList: [
                      { url: 'https://cdn.example.test/a/b/c/image.jpg' },
                    ],
                  },
                },
              },
            })
          )
        },
        probe: async () => false,
      }
    )
    expect(urls[1]).toContain('/discovery/item/1')
    expect(result.notice).toBe('media.originalFallback')
  })
  it('encodes Apple MakerApple identifier with self-contained TIFF offsets', () => {
    const exif = livePhotoExif('local-asset-id'),
      tiff = exif.subarray(10)
    const exifIfd = tiff.readUInt32BE(18),
      maker = tiff.subarray(tiff.readUInt32BE(exifIfd + 10))
    expect(maker.subarray(0, 10).toString()).toBe('Apple iOS\0')
    expect(maker.readUInt16BE(16)).toBe(17)
    expect(maker.toString('ascii', maker.readUInt32BE(24))).toBe(
      'local-asset-id\0'
    )
  })
})
