// Ported from YunX Desktop 1.3.4 data/network/{Quark,UC}{Api,Constants}.kt
// and data/repository/{Quark,UC}ResolveRepository.kt. Copyright YunX contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CloudMethod } from '@shared/schemas/nexus-cloud'
import { cloudFileSchema } from '@shared/schemas/nexus-cloud'
import { parseProfile } from './account-profile'
import {
  type AdapterFile,
  type CloudAdapter,
  CloudError,
  type CloudResource,
  type CloudSession,
  verifyResource,
} from './cloud-adapter'
import {
  array,
  bytes,
  type CloudHttp,
  encode,
  object,
  signedExpiry,
  text,
} from './cloud-http'

const prefix =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
export const QUARK_UA = `${prefix}quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch`
export const UC_UA = `${prefix}Chrome/120.0.0.0 Safari/537.36`
export const UC_CLOUD_UA = `${prefix}uc-cloud-drive/1.6.1 Chrome/100.0.4896.160 Electron/18.3.5.16-b62cf9c50d Safari/537.36 Channel/ucpan_other_ch`
export const UC_GUEST_UA = `${prefix}uc-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch`
const video = /\.(mp4|mkv|mov|avi|webm|flv|ts|m3u8|wmv|rmvb)$/i
export function parseCloudShare(
  input: string,
  platform: 'quark' | 'uc' | 'baidu'
) {
  const hosts =
    platform === 'quark'
      ? ['pan.quark.cn']
      : platform === 'uc'
        ? ['drive.uc.cn', 'fast.uc.cn']
        : ['pan.baidu.com']
  const match = input.match(/https?:\/\/[^\s<>]+/i)
  if (!match) throw new CloudError('expired-share')
  const url = new URL(match[0])
  if (!hosts.includes(url.hostname)) throw new CloudError('expired-share')
  const id =
    url.pathname.match(/\/(?:s|share)\/([A-Za-z0-9_-]+)/)?.[1] ??
    url.searchParams.get('surl')
  if (!id) throw new CloudError('expired-share')
  return {
    id: platform === 'baidu' && id.startsWith('1') ? id.slice(1) : id,
    passcode:
      url.searchParams.get('pwd') ??
      url.searchParams.get('passcode') ??
      input.match(
        /(?:提取码|提取碼|访问码|密码|密碼)\s*[:：]?\s*([a-zA-Z0-9]{4})/
      )?.[1] ??
      '',
  }
}
export class QuarkUcAdapter implements CloudAdapter {
  readonly capabilities = {
    own: true,
    withoutSave: true,
    guest: true,
    save: true,
    playback: true,
  }
  private get base() {
    return this.platform === 'quark'
      ? 'https://drive-pc.quark.cn'
      : 'https://pc-api.uc.cn'
  }
  private get params() {
    return this.platform === 'quark' ? 'pr=ucpro&fr=pc' : 'pr=UCBrowser&fr=pc'
  }
  private get ua() {
    return this.platform === 'quark' ? QUARK_UA : UC_UA
  }
  private get origin() {
    return this.platform === 'quark'
      ? 'https://pan.quark.cn'
      : 'https://drive.uc.cn'
  }
  constructor(
    readonly platform: 'quark' | 'uc',
    private http: CloudHttp
  ) {
    this.capabilities.playback = platform === 'uc'
  }
  private endpoint(path: string) {
    return `${this.base}/1/clouddrive/${path}?${this.params}`
  }
  private async call(
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
    guest = false
  ) {
    return this.http.json(
      url,
      {
        'User-Agent': this.ua,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
      body,
      guest
    )
  }
  async fetchProfile() {
    const { json } = await this.call(`${this.origin}/account/info`, undefined, {
      Referer: `${this.origin}/`,
      Accept: 'application/json, text/plain, */*',
    })
    return parseProfile(
      [json],
      ['data.nickname'],
      ['data.avatarUri', 'data.avatarUrl', 'data.avatar_url', 'data.avatar']
    )
  }
  async checkLogin() {
    const { json } = await this.call(`${this.origin}/account/info`)
    if (json.success !== true || !text(object(json.data ?? {}).nickname))
      throw new CloudError('login')
  }
  async createSession(input: string): Promise<CloudSession> {
    const share = parseCloudShare(input, this.platform)
    const { json } = await this.call(this.endpoint('share/sharepage/token'), {
      pwd_id: share.id,
      passcode: share.passcode,
      ...(this.platform === 'quark'
        ? { support_visit_limit_private_share: true }
        : { share_for_transfer: true }),
    })
    const data = object(json.data)
    if (!text(data.stoken)) throw new CloudError('extraction-code')
    return {
      shareId: share.id,
      token: text(data.stoken),
      title: text(data.title),
    }
  }
  async listFiles(
    directory: string,
    session?: CloudSession
  ): Promise<AdapterFile[]> {
    const all = new Map<string, AdapterFile>()
    for (let page = 1; page <= 200; page++) {
      let url: string
      let headers: Record<string, string>
      if (session && this.platform === 'uc') {
        url = `${this.base}/1/clouddrive/transfer_share/detail?entry=ft&fr=pc&pr=UCBrowser&pwd_id=${encode(session.shareId)}&pdir_fid=${encode(directory)}&fetch_file_list=1&passcode=&_page=${page}&_size=50&_fetch_total=1&_fetch_task=1&_fetch_share=1&_sort=&stoken=${encode(session.token)}`
        headers = {
          Origin: 'https://fast.uc.cn',
          Referer: 'https://fast.uc.cn/',
        }
      } else if (session) {
        url = `${this.endpoint('share/sharepage/detail')}&pwd_id=${encode(session.shareId)}&stoken=${encode(session.token)}&pdir_fid=${encode(directory)}&ver=2&force=0&_page=${page}&_size=100&_fetch_banner=0&_fetch_share=0&fetch_relate_conversation=0&_fetch_total=1&_sort=file_type:asc,file_name:asc`
        headers = { Origin: this.origin, Referer: `${this.origin}/` }
      } else {
        url = `${this.endpoint('file/sort')}${this.platform === 'quark' ? '&uc_param_str=' : ''}&pdir_fid=${encode(directory)}&_page=${page}&_size=50&_fetch_total=1&_fetch_sub_dirs=0&_sort=${this.platform === 'quark' ? 'file_type:asc,updated_at:desc&fetch_all_file=1&fetch_risk_file_name=1' : 'file_type%3Aasc%2Cupdated_at%3Adesc'}`
        headers = {
          Origin: this.origin,
          Referer: `${this.origin}/`,
          'User-Agent': this.platform === 'uc' ? UC_CLOUD_UA : this.ua,
        }
      }
      const { json } = await this.call(url, undefined, headers)
      const data = object(json.data)
      const batch = array(
        data.list ??
          (data.detail_info ? object(data.detail_info).list : []) ??
          []
      )
      const before = all.size
      for (const item of batch) {
        const file = cloudFileSchema.parse({
          id: text(item.fid),
          name: text(item.file_name ?? item.fname),
          bytes: bytes(item.size),
          directory: item.dir === true,
          parent: text(item.pdir_fid) || directory,
          path: text(item.file_name ?? item.fname),
          modified: text(item.updated_at),
          version: text(item.updated_at) || undefined,
          hash: text(item.md5) || undefined,
        })
        all.set(file.id, { ...file, token: text(item.share_fid_token) })
      }
      if (all.size === before) return [...all.values()]
    }
    throw new CloudError('unsupported')
  }
  private async membershipDetails() {
    const { json } = await this.call(
      `${this.endpoint('member')}&fetch_subscribe=true&_ch=home`,
      undefined,
      this.platform === 'uc'
        ? {
            'User-Agent': UC_CLOUD_UA,
            Origin: this.origin,
            Referer: `${this.origin}/`,
          }
        : { Origin: this.origin, Referer: `${this.origin}/` }
    )
    const data = object(json.data)
    const tier = data.member_type
    // Both official web clients use these tiers, independently of renewal and capacity.
    const member =
      tier === 'NORMAL'
        ? false
        : tier === 'VIP' ||
            tier === 'SUPER_VIP' ||
            tier === 'EXP_VIP' ||
            tier === 'EXP_SVIP'
          ? true
          : null
    return {
      member,
      quota: {
        total: bytes(data.total_capacity) ?? 0,
        used: bytes(data.use_capacity) ?? 0,
      },
    }
  }
  async health() {
    return this.membershipDetails()
  }
  async quota() {
    return (await this.membershipDetails()).quota
  }
  async ensureTempDir(name: string) {
    const { json } = await this.call(this.endpoint('file'), {
      pdir_fid: '0',
      file_name: name,
      dir_path: '',
      dir_init_lock: false,
    })
    const id = text(object(json.data).fid)
    if (!id) throw new CloudError('space')
    return id
  }
  async transferFile(
    session: CloudSession,
    file: AdapterFile,
    directory: string
  ) {
    const { json } = await this.call(this.endpoint('share/sharepage/save'), {
      pwd_id: session.shareId,
      stoken: session.token,
      pdir_fid: file.parent,
      to_pdir_fid: directory,
      fid_list: [file.id],
      fid_token_list: [file.token ?? ''],
      scene: 'link',
    })
    const task = text(object(json.data).task_id)
    if (!task) throw new CloudError('network')
    for (let i = 0; i < 10; i++) {
      const result = await this.call(
        `${this.endpoint('task')}&task_id=${encode(task)}&retry_index=0`
      )
      const data = object(result.json.data)
      if (
        Number(data.finished_at) > 0 ||
        Number(data.status) === 2 ||
        Number(data.task_status) === 2
      ) {
        const ids = object(data.save_as).save_as_top_fids
        if (Array.isArray(ids) && ids[0]) return text(ids[0])
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new CloudError('network')
  }
  async getDownloadLink(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession,
    savedId?: string
  ): Promise<CloudResource> {
    try {
      return await this.originalLink(file, method, session, savedId)
    } catch (error) {
      if (
        !(error instanceof CloudError) ||
        error.kind !== 'permission' ||
        this.platform !== 'uc' ||
        !video.test(file.name) ||
        !['own', 'save'].includes(method)
      )
        throw error
      return this.playbackLink(file, savedId)
    }
  }
  private async playbackLink(
    file: AdapterFile,
    savedId?: string
  ): Promise<CloudResource> {
    for (const query of ['?pr=UCBrowser&fr=pc', '']) {
      try {
        const { json } = await this.call(
          `${this.base}/1/clouddrive/file/v2/play/project${query}`,
          {
            fid: savedId ?? file.id,
            resolutions: 'low,normal,high,super,2k,4k',
            supports: 'fmp4_av,m3u8,dolby_vision',
          },
          {
            'User-Agent': UC_UA,
            'Content-Type': 'application/json;charset=UTF-8',
            Origin: this.origin,
            Referer: `${this.origin}/`,
          }
        )
        const info = array(object(json.data).video_list)
          .map((v) => object(v.video_info))
          .find((v) => text(v.url))
        if (!info) continue
        return {
          fileId: file.id,
          version: file.version,
          mediaType:
            /m3u8/i.test(text(info.format)) ||
            /\.m3u8(?:\?|$)/i.test(text(info.url))
              ? 'hls'
              : undefined,
          kind: 'playback-stream',
          bytes: null,
          url: text(info.url),
          headers: {
            'User-Agent': UC_UA,
            Referer: `${this.origin}/`,
            Cookie: this.http.options.cookie(),
          },
        }
      } catch (error) {
        if (
          error instanceof CloudError &&
          !['permission', 'network'].includes(error.kind)
        )
          throw error
      }
    }
    throw new CloudError('permission')
  }
  private async originalLink(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession,
    savedId?: string
  ): Promise<CloudResource> {
    const guest = method === 'guest'
    const share = method !== 'own' && method !== 'save'
    if (share && !session) throw new CloudError('expired-share')
    const ua = guest && this.platform === 'uc' ? UC_GUEST_UA : this.ua
    let data: Record<string, unknown> | undefined
    let cookies: string[] = []
    // UC video preview returns original bytes. Its fallback download can be a promotional clip.
    if (
      this.platform === 'uc' &&
      share &&
      !guest &&
      video.test(file.name) &&
      session
    ) {
      try {
        const result = await this.call(
          `${this.base}/1/clouddrive/share/sharepage/video_preview?pr=UCBrowser&fr=h5&pwd_id=${encode(session.shareId)}&stoken=${encode(session.token)}&fid=${encode(file.id)}&fid_token=${encode(file.token ?? '')}`,
          undefined,
          {
            Origin: this.origin,
            Referer: `${this.origin}/`,
            'Content-Type': 'application/json',
          }
        )
        const info = object(object(result.json.data).play_info)
        if (text(info.url)) data = { download_url: info.url, size: info.size }
      } catch (error) {
        if (
          error instanceof CloudError &&
          ['risk', 'captcha', 'rate', 'login'].includes(error.kind)
        )
          throw error
      }
    }
    if (!data) {
      const body = share
        ? {
            fids: [file.id],
            pwd_id: session?.shareId,
            stoken: session?.token,
            fids_token: [file.token ?? ''],
            ...(this.platform === 'quark'
              ? { speedup_session: '', token: '' }
              : {}),
          }
        : { fids: [savedId ?? file.id] }
      const url =
        this.platform === 'quark'
          ? `${this.endpoint('file/download')}&sys=win32&ve=3.23.2`
          : share
            ? `${this.base}/1/clouddrive/file/download?entry=ft&fr=pc&pr=UCBrowser`
            : `${this.base}/1/clouddrive/file/download`
      const result = await this.call(
        url,
        body,
        {
          'User-Agent': this.platform === 'uc' && !share ? UC_CLOUD_UA : ua,
          ...(guest && this.platform === 'uc'
            ? {
                'Sec-Ch-Ua':
                  '"Not=A?Brand";v="99", "Chromium";v="100", "Google Chrome";v="100"',
              }
            : {}),
          ...(this.platform === 'uc' && !share
            ? {
                Origin: this.origin,
                Referer: `${this.origin}/`,
                'Content-Type': 'application/json;charset=UTF-8',
              }
            : {}),
        },
        guest
      )
      data = array(result.json.data)[0]
      cookies = result.cookies
    }
    if (!data || !text(data.download_url)) throw new CloudError('permission')
    const cookie = guest
      ? cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('__pugs='))
      : this.http.options.cookie()
    if (guest && !cookie) throw new CloudError('headers')
    const resource: CloudResource = {
      fileId: file.id,
      version: file.version,
      hash: file.hash,
      bytes: bytes(data.size),
      kind: 'original-file',
      url: text(data.download_url),
      expiresAt: signedExpiry(text(data.download_url)),
      headers: {
        'User-Agent': ua,
        Referer: `${this.origin}/`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      savedId,
    }
    verifyResource(file, resource)
    return resource
  }
  renew(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession,
    savedId?: string
  ) {
    return this.getDownloadLink(file, method, session, savedId)
  }
  async cleanupTempDir(directory: string) {
    await this.call(
      `${this.endpoint('file/delete')}${this.platform === 'quark' ? '&uc_param_str=' : ''}`,
      { action_type: 2, filelist: [directory], exclude_fids: [] }
    )
  }
}
