// Ported from YunX Desktop 1.3.4 data/network/video/{Douyin,Kuaishou,Weibo,Xhs,Bilibili,AcFun,Pixiv}Parser.kt.
// Copyright YunX contributors. SPDX-License-Identifier: AGPL-3.0-only
import type { MediaPlatform } from '@shared/schemas/nexus-media'
import { z } from 'zod'
import { douyinDetail } from './douyin-data'
import { type MediaProbeResult, resolveDouyinPlay } from './douyin-play'
import { type UgoiraFrame, ugoiraFramesSchema } from './ugoira'

type Json = Record<string, unknown>
export const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
export const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : [])
export const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
export const at = (v: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((a, k) => obj(a)[k], v)
const first = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return first(v[0])
  return (
    str(obj(v).url ?? obj(v).src) || first(obj(v).url_list ?? obj(v).urlList)
  )
}
export const mediaUrl = (v: unknown): string => {
  const value = str(v)
  const url = new URL(value.startsWith('//') ? `https:${value}` : value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('media.invalid')
  return url.href
}
export const mediaName = (v: string): string =>
  (
    v
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((c) => (c.charCodeAt(0) < 32 ? '_' : c))
      .join('')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'media'
  ).replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i, '_$&')
export interface MediaAsset {
  ugoira?: UgoiraFrame[]
  external?: { page: string; gallery: boolean; formatId: string }
  id: string
  url: string
  audioUrl?: string
  motionUrl?: string
  kind: 'video' | 'image'
  label: string
  format: string
  bytes: number | null
  entry: string
  headers: Record<string, string>
}
export interface ParsedMedia {
  subtitles?: string[]
  platform: MediaPlatform
  title: string
  assets: MediaAsset[]
  notice?: string
}
export const chromeUa =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
const iphoneUa =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
export const platformRoots: Record<
  Exclude<MediaPlatform, 'external'>,
  string[]
> = {
  douyin: ['douyin.com', 'iesdouyin.com'],
  kuaishou: ['kuaishou.com', 'chenzhongtech.com'],
  weibo: ['weibo.com', 'weibo.cn'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
  acfun: ['acfun.cn'],
  pixiv: ['pixiv.net'],
}
export function detectMedia(address: string): MediaPlatform {
  const host = new URL(mediaUrl(address)).hostname
  return (
    (Object.entries(platformRoots).find(([, roots]) =>
      roots.some((r) => host === r || host.endsWith(`.${r}`))
    )?.[0] as MediaPlatform | undefined) ?? 'external'
  )
}
// YunX WeiboParser.mid2id: decimal groups of seven, encoded as padded base62.
function weiboPostId(mid: string): string {
  if (!/^\d{1,32}$/.test(mid)) throw new Error('media.invalid')
  const alphabet =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const pieces: string[] = []
  for (let end = mid.length; end > 0; end -= 7) {
    let value = Number(mid.slice(Math.max(0, end - 7), end))
    let encoded = ''
    do {
      encoded = alphabet[value % 62] + encoded
      value = Math.floor(value / 62)
    } while (value > 0)
    pieces.unshift(end > 7 ? encoded.padStart(4, '0') : encoded)
  }
  return pieces.join('')
}
/** Balanced JSON extraction without evaluating page scripts. */
export function inlineJson(html: string, marker: string): unknown {
  const start = html.indexOf(marker)
  if (start < 0) throw new Error('media.blocked')
  let cursor = html.indexOf('=', start) + 1
  while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++
  const begin = cursor
  let depth = 0
  let quoted = false
  let escaped = false
  for (; cursor < html.length; cursor++) {
    const c = html[cursor]
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      if (--depth === 0)
        return JSON.parse(
          html.slice(begin, cursor + 1).replace(/:\s*undefined\b/g, ':null')
        )
    }
  }
  throw new Error('media.invalid')
}
export interface ParserIo {
  anonymousCookie?(renew: boolean): Promise<string>
  resolve?(url: string, headers?: Record<string, string>): Promise<string>
  request(
    url: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<string>
  page?(url: string, platform: MediaPlatform, cookie?: string): Promise<unknown>
  probe?(url: string, headers: Record<string, string>): Promise<boolean>
  probeMedia?(
    url: string,
    headers: Record<string, string>
  ): Promise<MediaProbeResult | null>
}
export async function parseDomestic(
  address: string,
  cookie: string,
  io: ParserIo,
  quality?: number
): Promise<ParsedMedia> {
  const platform = detectMedia(address)
  if (
    ['b23.tv', 'xhslink.com', 'v.douyin.com', 'v.kuaishou.com'].some(
      (h) => new URL(address).hostname === h
    )
  )
    address = (await io.resolve?.(address)) ?? address
  if (platform === 'external') throw new Error('media.unsupported')
  const host = new URL(address).origin
  const headers: Record<string, string> = {
    'User-Agent':
      platform === 'kuaishou' || platform === 'douyin' ? iphoneUa : chromeUa,
    Referer: `${host}/`,
    ...(cookie ? { Cookie: cookie } : {}),
  }
  const json = async (url: string) =>
    obj(JSON.parse(await io.request(url, headers)))
  const assets: MediaAsset[] = []
  let title = platform as string
  let notice: string | undefined
  const add = (
    url: unknown,
    kind: 'video' | 'image',
    label = '',
    extra: Partial<MediaAsset> = {}
  ) => {
    if (!str(url)) return
    const safeUrl = mediaUrl(url)
    const ext = new URL(safeUrl).pathname.match(/\.([a-z0-9]{2,4})$/i)?.[1]
    assets.push({
      id: String(assets.length),
      url: safeUrl,
      kind,
      label,
      format: kind === 'video' ? 'mp4' : ext || 'jpg',
      bytes: null,
      entry: '1',
      headers: { ...headers },
      ...extra,
    })
  }
  if (platform === 'bilibili') {
    if (!cookie) notice = 'media.loginForQuality'
    headers.Referer = 'https://www.bilibili.com/'
    const id = address.match(/(BV[\w]+|av\d+)/i)?.[1]
    if (!id) throw new Error('media.invalid')
    const view = await json(
      `https://api.bilibili.com/x/web-interface/view?${id.startsWith('av') ? 'aid' : 'bvid'}=${id.replace(/^av/, '')}`
    )
    if (Number(view.code) !== 0) throw new Error('media.blocked')
    const data = obj(view.data)
    title = str(data.title)
    const pages = rows(data.pages)
    for (const [index, page] of (pages.length
      ? pages
      : [{ cid: data.cid }]
    ).entries()) {
      const base = `https://api.bilibili.com/x/player/playurl?bvid=${str(data.bvid)}&cid=${str(page.cid)}&qn=${quality ?? 120}&fnver=0&fourk=1&high_quality=1`
      let play = obj(
        (
          await json(
            `${base}&fnval=${cookie ? 4048 : 1}${cookie ? '' : '&platform=html5'}`
          ).catch((error) => {
            if (cookie) return {} as Json
            throw error
          })
        ).data
      )
      if (
        cookie &&
        (!rows(at(play, 'dash', 'video')).length ||
          !rows(at(play, 'dash', 'audio')).length)
      ) {
        notice = 'media.loginForQuality'
        play = obj((await json(`${base}&fnval=1&platform=html5`)).data)
      }
      const dash = obj(play.dash)
      const videos = rows(dash.video).sort(
        (a, b) =>
          Number(b.id) - Number(a.id) ||
          Number(Number(b.codecid) === 7) - Number(Number(a.codecid) === 7)
      )
      const seen = new Set<number>()
      const preferred = (v: Json) =>
        [
          v.baseUrl ?? v.base_url,
          ...((Array.isArray(v.backupUrl ?? v.backup_url)
            ? (v.backupUrl ?? (v.backup_url as unknown[]))
            : []) as unknown[]),
        ]
          .map(str)
          .filter(Boolean)
          .sort(
            (a, b) => Number(a.includes('mcdn')) - Number(b.includes('mcdn'))
          )[0]
      const audio = rows(dash.audio).sort(
        (a, b) => Number(b.bandwidth) - Number(a.bandwidth)
      )[0]
      for (const video of videos) {
        const qn = Number(video.id)
        if (seen.has(qn)) continue
        seen.add(qn)
        const choices = Array.isArray(play.accept_quality)
          ? play.accept_quality
          : []
        const descriptions = Array.isArray(play.accept_description)
          ? play.accept_description
          : []
        add(
          preferred(video),
          'video',
          str(descriptions[choices.indexOf(qn)]) || `${str(video.height)}P`,
          {
            audioUrl: audio ? mediaUrl(preferred(audio)) : undefined,
            entry: `${index + 1} ${str(page.part)}`,
          }
        )
      }
      if (!videos.length)
        for (const part of rows(play.durl))
          add(part.url, 'video', `${str(play.quality)} · ${index + 1}`, {
            bytes: Number(part.size) || null,
            entry: `${index + 1} ${str(page.part)}`,
          })
    }
  } else if (platform === 'pixiv') {
    headers.Referer = 'https://www.pixiv.net/'
    const id = address.match(/artworks\/(\d+)/)?.[1]
    if (!id) throw new Error('media.invalid')
    const info = await json(`https://www.pixiv.net/ajax/illust/${id}`)
    if (info.error) throw new Error('media.login')
    const body = obj(info.body)
    title = str(body.title)
    if (Number(body.illustType) === 2) {
      const meta = obj(
        (await json(`https://www.pixiv.net/ajax/illust/${id}/ugoira_meta`)).body
      )
      add(meta.originalSrc || meta.src, 'video', 'ugoira', {
        format: 'zip',
        ugoira: ugoiraFramesSchema.parse(meta.frames),
      })
    } else {
      const pages = await json(`https://www.pixiv.net/ajax/illust/${id}/pages`)
      for (const [index, page] of rows(pages.body).entries())
        add(at(page, 'urls', 'original'), 'image', 'original', {
          entry: String(index + 1),
        })
      if (!assets.length) add(at(body, 'urls', 'original'), 'image', 'original')
    }
  } else if (platform === 'weibo') {
    const mid = new URL(address).searchParams.get('mid')
    const fid = mid ? undefined : address.match(/(?:show\/|fid=)(\d+:\d+)/)?.[1]
    const id =
      (mid ? weiboPostId(mid) : fid) ||
      address
        .match(/(?:detail|status)\/([\w]+)|weibo\.com\/\d+\/([\w]+)/)
        ?.slice(1)
        .find(Boolean)
    if (!id) throw new Error('media.invalid')
    headers.Referer = `https://m.weibo.cn/detail/${id}`
    headers['X-Requested-With'] = 'XMLHttpRequest'
    headers.Origin = 'https://m.weibo.cn'
    headers['mweibo-pwa'] = '1'
    headers['Sec-Fetch-Site'] = 'same-origin'
    headers['Sec-Fetch-Mode'] = 'cors'
    headers['Sec-Fetch-Dest'] = 'empty'
    let data: Json
    if (fid) {
      headers.Referer = `https://h5.video.weibo.com/show/${fid}`
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      const text = await io.request(
        `https://h5.video.weibo.com/api/component?page=/show/${fid}`,
        headers,
        new URLSearchParams({
          data: JSON.stringify({ Component_Play_Playinfo: { oid: fid } }),
        }).toString()
      )
      data = obj(at(JSON.parse(text), 'data', 'Component_Play_Playinfo'))
    } else
      data = obj(
        (
          await json(
            `https://m.weibo.cn/statuses/show?id=${id}&_=${Date.now()}`
          )
        ).data
      )
    if (!Object.keys(data).length) throw new Error('media.blocked')
    if (!data.pics && !data.page_info && data.retweeted_status)
      data = obj(data.retweeted_status)
    title =
      str(data.text)
        .replace(/<[^>]+>/g, '')
        .slice(0, 100) || id
    const urls = obj(fid ? data.urls : at(data, 'page_info', 'urls'))
    add(
      (fid ? (Object.values(urls)[0] ?? data.stream_url) : undefined) ??
        urls.mp4_720p_mp4 ??
        urls.mp4_hd_mp4 ??
        urls.mp4_ld_mp4 ??
        at(data, 'page_info', 'media_info', 'stream_url_hd') ??
        at(data, 'page_info', 'media_info', 'stream_url'),
      'video'
    )
    for (const [index, pic] of rows(data.pics).entries())
      add(at(pic, 'large', 'url'), 'image', 'original', {
        entry: String(index + 1),
        motionUrl: str(pic.videoSrc) || undefined,
      })
  } else if (platform === 'acfun') {
    const id = address.match(/ac(\d+)/)?.[1]
    if (!id) throw new Error('media.invalid')
    const raw = await io.request(
      `https://www.acfun.cn/v/ac${id}?quickViewId=videoInfo_new&ajaxpipe=1`,
      headers
    )
    const info = obj(inlineJson(raw, 'window.videoInfo'))
    title = str(info.title)
    const play = at(info, 'currentVideoInfo', 'ksPlayJson')
    const parsed = typeof play === 'string' ? JSON.parse(play) : play
    for (const rep of rows(
      at(rows(obj(parsed).adaptationSet)[0], 'representation')
    ))
      add(rep.url, 'video', str(rep.qualityLabel ?? rep.name))
  } else if (platform === 'kuaishou') {
    headers.Referer = 'https://v.kuaishou.com/'
    address =
      (await io.resolve?.(address, {
        'User-Agent': iphoneUa,
        Referer: headers.Referer,
      })) ?? address
    const html = await io.request(
      address.replace('/fw/long-video/', '/fw/photo/'),
      headers
    )
    const init = obj(inlineJson(html, 'window.INIT_STATE'))
    const photo = Object.values(init)
      .map((v) => obj(obj(v).photo))
      .find((v) => Object.keys(v).length)
    if (!photo) throw new Error('media.blocked')
    title = str(photo.caption)
    add(first(photo.mainMvUrls), 'video')
    const atlas = obj(at(photo, 'ext_params', 'atlas'))
    const cdn = str(rows(atlas.cdnList)[0]?.cdn)
    for (const [index, image] of (Array.isArray(atlas.list)
      ? atlas.list
      : []
    ).entries())
      add(
        `https://${cdn.replace(/^https?:\/\//, '').replace(/\/$/, '')}/${str(image).replace(/^\//, '')}`,
        'image',
        'original',
        { entry: String(index + 1) }
      )
  } else if (platform === 'xiaohongshu') {
    const page = new URL(address),
      id = page.pathname.match(/(?:explore|discovery\/item)\/([\w]+)/)?.[1]
    if (!id) throw new Error('media.invalid')
    let state: Json = {}
    let note: Json = {}
    for (const [index, route] of ['explore', 'discovery/item'].entries()) {
      try {
        const html = await io.request(
          `https://www.xiaohongshu.com/${route}/${id}${page.search}`,
          index
            ? {
                ...headers,
                'User-Agent': iphoneUa,
                Origin: 'https://www.xiaohongshu.com',
                'X-Requested-With': 'XMLHttpRequest',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
              }
            : headers
        )
        state = obj(inlineJson(html, 'window.__INITIAL_STATE__'))
        const map = obj(at(state, 'note', 'noteDetailMap'))
        const selected = obj(
          map[id] ??
            (Object.keys(map).length === 1 ? Object.values(map)[0] : undefined)
        )
        note = obj(selected.note ?? at(state, 'noteData', 'data', 'noteData'))
        const stream = obj(at(note, 'video', 'media', 'stream'))
        const playable = Object.values(stream).some((items) =>
          rows(items).some((rep) => str(rep.masterUrl ?? rep.master_url))
        )
        if (note.video ? playable : rows(note.imageList).length) break
      } catch (e) {
        if ((e as Error).message === 'media.login') throw e
      }
    }
    title = str(note.title) || str(note.desc).slice(0, 60)
    const stream = obj(at(note, 'video', 'media', 'stream'))
    for (const codec of ['h264', 'h265', 'av1', 'h266'])
      for (const rep of rows(stream[codec]))
        add(
          rep.masterUrl ?? rep.master_url,
          'video',
          `${str(rep.height)}P ${codec}`
        )
    if (note.video && !assets.length) throw new Error('media.blocked')
    if (!note.video)
      for (const [index, image] of rows(note.imageList).entries()) {
        const raw = mediaUrl(image.urlDefault ?? image.url)
        const token = new URL(raw).pathname
          .split('/')
          .slice(3)
          .join('/')
          .split('!')[0]
        const original = token ? `https://sns-img-bd.xhscdn.com/${token}` : raw
        const available =
          original === raw || !io.probe || (await io.probe(original, headers))
        if (!available) notice = 'media.originalFallback'
        const motion = rows(at(image, 'stream', 'h264'))[0]
        add(
          available ? original : raw,
          'image',
          available ? 'original' : 'platform',
          {
            entry: String(index + 1),
            motionUrl:
              str(motion?.masterUrl ?? image.livePhotoUrl) || undefined,
          }
        )
      }
  } else {
    const id =
      address
        .match(/(?:video|note|slides)\/(\d+)|modal_id=(\d+)/)
        ?.slice(1)
        .find(Boolean) || ''
    let detail: Json | undefined
    const shareUrl = id
      ? `https://www.iesdouyin.com/share/${/\/(?:note|slides)\//.test(address) ? 'note' : 'video'}/${id}/`
      : address
    const mediaHeaders = { 'User-Agent': iphoneUa, Referer: shareUrl }
    for (let attempt = 0; attempt < (io.anonymousCookie ? 2 : 1); attempt++) {
      try {
        const anonymous = await io.anonymousCookie?.(attempt > 0)
        const html = await io.request(shareUrl, {
          ...headers,
          Referer: 'https://www.iesdouyin.com/',
          ...(anonymous
            ? { Cookie: [anonymous, cookie].filter(Boolean).join('; ') }
            : {}),
        })
        const render = html.match(
          /<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/
        )?.[1]
        detail = douyinDetail(
          render
            ? JSON.parse(decodeURIComponent(render))
            : inlineJson(html, 'window._ROUTER_DATA'),
          id
        )
        if (detail) break
      } catch {
        /* A bounded anonymous retry, then the isolated page path. */
      }
    }
    if (!detail)
      detail = douyinDetail(
        await io.page?.(
          id
            ? `https://www.douyin.com/${/\/(?:note|slides)\//.test(address) ? 'note' : 'video'}/${id}`
            : address,
          platform,
          cookie
        ),
        id
      )
    if (!detail) throw new Error('media.blocked')
    title = str(detail.desc)
    if (detail.nexusStatic) notice = 'media.staticFallback'
    const video = obj(detail.video)
    const images = rows(
      detail.images ?? at(detail, 'image_post_info', 'images')
    )
    if (!images.length) {
      const play =
        video.play_addr ??
        video.playAddr ??
        video.play_addr_h264 ??
        at(rows(video.bit_rate)[0], 'play_addr')
      const fallback = first(play).replace('/playwm/', '/play/')
      const resolved = await resolveDouyinPlay(
        play,
        fallback,
        mediaHeaders,
        io.probeMedia
      )
      add(resolved?.url ?? fallback, 'video', '', {
        headers: mediaHeaders,
        bytes: resolved?.bytes ?? null,
      })
    }
    for (const [index, image] of images.entries())
      add(
        first(
          image.url_list ??
            image.urlList ??
            image.display_image ??
            image.owner_watermark_image
        ),
        'image',
        'original',
        {
          entry: String(index + 1),
          headers: mediaHeaders,
          motionUrl:
            first(
              at(image, 'video', 'play_addr') ?? at(image, 'video', 'playAddr')
            ) || undefined,
        }
      )
  }
  z.array(z.object({ url: z.url() }))
    .min(1)
    .max(1000)
    .parse(assets)
  return { platform, title: title || platform, assets, notice }
}
