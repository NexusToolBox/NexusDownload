import { randomBytes } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { parseDomestic } from './domestic-parsers'
import { probeDouyinMedia, resolveDouyinPlay } from './douyin-play'

it('selects the largest successful ratio and leaves the direct URL when all probes fail', async () => {
  const probe = vi.fn(async (url: string) => {
    const ratio = new URL(url).searchParams.get('ratio')
    if (ratio === '1080p') throw new Error('unavailable')
    return {
      url: 'https://cdn.example.test/video.mp4',
      bytes: ratio === '720p' ? 200 : 100,
    }
  })
  expect(
    (await resolveDouyinPlay({ uri: 'fixture-video' }, '', {}, probe))?.bytes
  ).toBe(200)
  expect(probe).toHaveBeenCalledTimes(4)
  const result = await parseDomestic('https://www.douyin.com/video/1', '', {
    request: async (url) => {
      expect(new URL(url).pathname).toBe('/share/video/1/')
      return (
        'window._ROUTER_DATA=' +
        JSON.stringify({
          aweme_detail: {
            aweme_id: '1',
            desc: 'work',
            video: {
              play_addr: {
                uri: 'fixture-video',
                url_list: ['https://cdn.example.test/playwm/a.mp4'],
              },
            },
          },
        })
      )
    },
    probeMedia: async () => null,
  })
  expect(result.assets[0].url).toBe('https://cdn.example.test/play/a.mp4')
  expect(result.assets[0].headers).not.toHaveProperty('Cookie')
})

it('follows bounded HTTPS redirects, reads total length, cancels bodies and excludes credentials', async () => {
  const transient = randomBytes(32).toString('hex')
  const cancel = vi.fn()
  const request = vi.fn(
    async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.redirect).toBe('manual')
      expect(options?.headers).toEqual({
        'User-Agent': 'fixture',
        Range: 'bytes=0-1',
      })
      expect(JSON.stringify(options?.headers)).not.toContain(transient)
      return request.mock.calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example.test/video.mp4' },
          })
        : new Response(new ReadableStream({ cancel }), {
            status: 206,
            headers: new Headers({
              'content-type': 'video/mp4',
              'content-range': 'bytes 0-1/12345',
              'content-length': '2',
            }),
          })
    }
  )
  const url = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=fixture'
  expect(
    await probeDouyinMedia(
      url,
      { 'User-Agent': 'fixture', Cookie: transient, Authorization: transient },
      request as typeof fetch
    )
  ).toEqual({ url: 'https://cdn.example.test/video.mp4', bytes: 12345 })
  expect(cancel).toHaveBeenCalledOnce()
  const html = vi.fn(
    async () =>
      new Response('<html/>', {
        headers: { 'content-type': 'text/html', 'content-length': '7' },
      })
  )
  expect(await probeDouyinMedia(url, {}, html)).toBeNull()
  const loop = vi.fn(
    async () => new Response(null, { status: 302, headers: { location: url } })
  )
  expect(await probeDouyinMedia(url, {}, loop)).toBeNull()
  expect(loop).toHaveBeenCalledTimes(6)
})

it('retries incomplete XHS video data through the alternate route without choosing its cover image', async () => {
  const request = vi.fn(
    async () =>
      'window.__INITIAL_STATE__=' +
      JSON.stringify({
        noteData: {
          data: {
            noteData:
              request.mock.calls.length === 1
                ? {
                    video: {},
                    imageList: [{ url: 'https://cdn.example.test/cover.jpg' }],
                  }
                : {
                    video: {
                      media: {
                        stream: {
                          h264: [
                            { masterUrl: 'https://cdn.example.test/video.mp4' },
                          ],
                        },
                      },
                    },
                  },
          },
        },
      })
  )
  const result = await parseDomestic(
    'https://www.xiaohongshu.com/explore/1',
    '',
    { request }
  )
  expect(request).toHaveBeenCalledTimes(2)
  expect(result.assets[0].kind).toBe('video')
})
