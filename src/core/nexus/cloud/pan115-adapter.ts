// Port of YunX Desktop 1.3.4 Pan115Api.kt, Pan115Constants.kt and Pan115ResolveRepository.kt.
// Copyright YunX contributors. SPDX-License-Identifier: AGPL-3.0-only

import type { CloudMethod } from '@shared/schemas/nexus-cloud'
import { membershipFlag } from './account-health'
import { parseProfile } from './account-profile'
import {
  type AdapterFile,
  type CloudAdapter,
  CloudError,
  type CloudSession,
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
import { Pan115Crypto } from './pan115-crypto'
import { platformError, platformRequest } from './platform-request'

export const PAN115_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
const base = 'https://webapi.115.com'
const referer = 'https://115.com/'
const form = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join('&')
export class Pan115Adapter implements CloudAdapter {
  readonly platform = '115' as const
  readonly capabilities = {
    own: true,
    withoutSave: true,
    guest: true,
    save: true,
    playback: false,
  }
  private clientUa = 'Mozilla/5.0 115Browser/36.0.1'
  private versionFetched = false
  private owned = new Set<string>()
  constructor(
    private http: CloudHttp,
    private crypto: Pick<
      Pan115Crypto,
      'newKey' | 'encode' | 'decode'
    > = new Pan115Crypto()
  ) {}
  private call(
    path: string,
    body?: Record<string, string>,
    page = referer,
    client = false,
    kind: 'request' | 'link' | 'transfer' = 'request'
  ) {
    return platformRequest(
      this.http,
      path.startsWith('https:') ? path : `${base}${path}`,
      {
        'User-Agent': client ? this.clientUa : PAN115_UA,
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: page,
        ...(this.http.options.cookie()
          ? { Cookie: this.http.options.cookie() }
          : {}),
        ...(body
          ? {
              'Content-Type':
                'application/x-www-form-urlencoded; charset=utf-8',
            }
          : {}),
      },
      body ? form(body) : undefined,
      kind,
      (json) => {
        if (json.state === true) return
        const code = Number(
          json.errno ?? json.errNo ?? json.errcode ?? json.errCode ?? 0
        )
        const message = text(json.error ?? json.msg)
        if (
          /其他(?:地方|设备)|异地登录|已被挤|被迫下线|another.*(?:device|login)/i.test(
            message
          )
        )
          throw new CloudError('login-elsewhere')
        throw platformError(code, message, {
          990001: 'login',
          4100012: 'extraction-code',
          4100008: 'extraction-code',
          4100026: 'expired-share',
          50028: 'permission',
          50029: 'permission',
          990009: 'rate',
          800007: 'permission',
        })
      }
    )
  }
  async fetchProfile() {
    const { json: info } = await this.call('/user/info?ct=json').catch(() => ({
      json: {},
    }))
    const { json: nav } = await platformRequest(
      this.http,
      'https://my.115.com/?ct=ajax&ac=nav',
      {
        'User-Agent': PAN115_UA,
        Referer: referer,
        Cookie: this.http.options.cookie(),
      },
      undefined,
      'request',
      () => {}
    ).catch(() => ({ json: {} }))
    return parseProfile([nav, info], ['data.user_name', 'data'], ['data.face'])
  }
  async checkLogin() {
    await this.call('/user/info?ct=json')
  }
  async health() {
    const { json } = await this.call('/user/info?ct=json')
    return { member: membershipFlag(object(json.data).is_vip) }
  }
  /** p115client ab2fd4d6 clouddownload_request(type='web'); MIT protocol reference. */
  async offline(
    action: string,
    values: Record<string, string> = {},
    write = false
  ) {
    if (!this.http.options.cookie()) throw new CloudError('login')
    const params = { ac: action, ...values }
    const { json } = await this.call(
      `https://clouddownload.115.com/web/${write ? '' : `?${form(params)}`}`,
      write ? params : undefined,
      referer,
      false,
      write ? 'transfer' : 'request'
    )
    return json
  }
  async quota() {
    const { json } = await this.call('/files/index_info?count_space_nums=1')
    const info = object(object(json.data).space_info)
    return {
      total: bytes(object(info.all_total).size) ?? 0,
      used: bytes(object(info.all_use).size) ?? 0,
    }
  }
  private sharePage(session: CloudSession, directory: string, offset: number) {
    return this.call(
      `/share/snap?share_code=${encode(session.shareId)}&receive_code=${encode(session.token)}&offset=${offset}&limit=100&asc=0&cid=${encode(directory)}&format=json`,
      undefined,
      `https://115cdn.com/s/${session.shareId}${session.token ? `?password=${encode(session.token)}&` : ''}`
    )
  }
  async createSession(input: string): Promise<CloudSession> {
    const match =
      /https?:\/\/(?:115cdn\.com|115\.com|115rc\.com)\/s\/([A-Za-z0-9]+)/i.exec(
        input
      )
    if (!match) throw new CloudError('unsupported')
    const pwd =
      /[?&]password=([^&\s#]+)/i.exec(input)?.[1] ??
      /(?:访问码|提取码|提取碼)[:：\s]*([a-z0-9]+)/i.exec(input)?.[1] ??
      ''
    const session: CloudSession = {
      shareId: match[1],
      token: decodeURIComponent(pwd),
      title: '',
      extra: {},
    }
    const { json } = await this.sharePage(session, '0', 0)
    const data = object(json.data)
    session.title = text(object(data.shareinfo ?? {}).share_title)
    session.extra = { userId: text(object(data.userinfo).user_id) }
    return session
  }
  async listFiles(
    directory: string,
    session?: CloudSession
  ): Promise<AdapterFile[]> {
    const result: AdapterFile[] = []
    for (let offset = 0; offset < 100000; ) {
      const { json } = session
        ? await this.sharePage(session, directory, offset)
        : await this.call(
            `/files?aid=1&cid=${encode(directory)}&o=user_ptime&asc=0&offset=${offset}&show_dir=1&limit=100&snap=0&natsort=1&record_open_time=1&count_folders=1&format=json`
          )
      const data = session ? object(json.data) : json
      const page = array(session ? data.list : data.data)
      for (const row of page) {
        const folder = session
          ? Number(row.fc ?? (text(row.fid) ? 1 : 0)) === 0
          : !text(row.fid)
        const id = text(folder ? row.cid : row.fid)
        if (!id) throw new CloudError('identity')
        const sha = text(row.sha ?? row.sha1)
        result.push({
          id,
          name: text(row.n),
          bytes: folder ? 0 : bytes(row.s),
          directory: folder,
          parent: text(folder ? row.pid : row.cid),
          path: id,
          token: text(row.pc),
          version: text(row.t) || undefined,
          modified: text(row.te ?? row.t ?? row.tu),
          hash: /^[a-f0-9]{40}$/i.test(sha)
            ? `sha1:${sha.toLowerCase()}`
            : undefined,
        })
      }
      offset += page.length
      if (
        page.length < 100 ||
        (Number(data.count) > 0 && offset >= Number(data.count))
      )
        return result
    }
    throw new CloudError('unsupported')
  }
  async ensureTempDir(name: string) {
    if (!/^NexusDownload_tr_[a-z0-9-]+$/i.test(name))
      throw new CloudError('path')
    const { json } = await this.call('/files/add', { pid: '0', cname: name })
    const id = text(json.cid ?? object(json.data ?? {}).cid)
    if (!id || id === '0') throw new CloudError('identity')
    this.owned.add(id)
    return id
  }
  async restoreTransfer(_saved: string, directory: string) {
    const folders = await this.listFiles('0')
    if (
      !folders.some(
        (f) =>
          f.id === directory &&
          f.directory &&
          /^NexusDownload_tr_[a-z0-9-]+$/i.test(f.name)
      )
    )
      throw new CloudError('identity')
    this.owned.add(directory)
  }
  async transferFile(
    session: CloudSession,
    file: AdapterFile,
    directory: string
  ) {
    if (!this.owned.has(directory)) throw new CloudError('identity')
    await this.call(
      '/share/receive',
      {
        share_code: session.shareId,
        receive_code: session.token,
        file_id: file.id,
        cid: directory,
      },
      referer,
      false,
      'transfer'
    )
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 500))
      const files = (await this.listFiles(directory)).filter(
        (f) =>
          !f.directory &&
          f.name === file.name &&
          f.bytes === file.bytes &&
          (!file.hash || f.hash === file.hash)
      )
      if (files.length === 1) return files[0].id
    }
    throw new CloudError('identity')
  }
  private async refreshVersion() {
    if (this.versionFetched) return
    this.versionFetched = true
    try {
      const { json } = await platformRequest(
        this.http,
        'https://appversion.115.com/1/web/1.0/api/chrome',
        {
          'User-Agent': PAN115_UA,
          Referer: referer,
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
        undefined,
        'request',
        () => {}
      )
      const version = text(object(object(json.data).win).version_code)
      if (/^\d[\d.]{0,15}$/.test(version))
        this.clientUa = `Mozilla/5.0 115Browser/${version}`
    } catch (error) {
      if (
        error instanceof CloudError &&
        ['captcha', 'risk', 'rate', 'login'].includes(error.kind)
      )
        throw error
    }
  }
  async getDownloadLink(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession,
    savedId?: string
  ) {
    await this.refreshVersion()
    let result: Awaited<ReturnType<Pan115Adapter['call']>>
    let info: Record<string, unknown>
    if (method === 'guest' || method === 'without-save') {
      if (!session?.extra?.userId) throw new CloudError('expired-share')
      result = await this.call(
        `/share/downurl?dl=1&user_id=${encode(session.extra.userId)}&share_code=${encode(session.shareId)}&file_id=${encode(file.id)}${session.token ? `&receive_code=${encode(session.token)}` : ''}`,
        undefined,
        `https://115cdn.com/s/${session.shareId}${session.token ? `?password=${encode(session.token)}&` : ''}`,
        true,
        'link'
      )
      info = object(result.json.data)
    } else {
      if (!this.http.options.cookie()) throw new CloudError('login')
      let own = file
      if (method === 'save') {
        if (!savedId) throw new CloudError('identity')
        let found: AdapterFile | undefined
        for (const dir of this.owned)
          found ??= (await this.listFiles(dir)).find((f) => f.id === savedId)
        if (
          !found ||
          found.bytes !== file.bytes ||
          (file.hash && found.hash !== file.hash)
        )
          throw new CloudError('identity')
        own = found
      }
      if (!own.token) throw new CloudError('identity')
      try {
        const key = this.crypto.newKey()
        result = await this.call(
          `https://proapi.115.com/app/chrome/downurl?t=${Math.floor(Date.now() / 1000)}`,
          {
            data: this.crypto.encode(
              JSON.stringify({ pickcode: own.token }),
              key
            ),
          },
          referer,
          true,
          'link'
        )
        const decoded = object(
          JSON.parse(this.crypto.decode(text(result.json.data), key))
        )
        info =
          Object.values(decoded)
            .map(object)
            .find((v) => v.url) ?? {}
      } catch (error) {
        if (
          !(error instanceof CloudError) ||
          !['network', 'permission'].includes(error.kind)
        )
          throw error
        result = await this.call(
          `/files/download?pickcode=${encode(own.token)}`,
          undefined,
          referer,
          true,
          'link'
        )
        info = object(result.json.data)
      }
    }
    const url = text(
      info.file_url_302 ?? info.file_url ?? object(info.url ?? {}).url
    )
    if (!/^https?:\/\//i.test(url)) throw new CloudError('permission')
    const cdn =
      result.cookies.find(
        (c) =>
          /[;\s]path=([^;]+)/i.exec(c)?.[1]?.trim() !== '/' &&
          /[;\s]path=([^;]+)/i.test(c)
      ) ?? result.cookies[0]
    const cookie = [this.http.options.cookie(), cdn?.split(';')[0]]
      .filter(Boolean)
      .join('; ')
    return {
      fileId: file.id,
      bytes: bytes(info.file_size ?? info.fs) ?? file.bytes,
      kind: 'original-file' as const,
      version: file.version,
      hash: file.hash,
      url,
      expiresAt: signedExpiry(url),
      headers: {
        'User-Agent': this.clientUa,
        Referer: referer,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }
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
    if (!this.owned.has(directory) || directory === '0')
      throw new CloudError('identity')
    await this.call('/rb/delete', {
      pid: '0',
      'fid[0]': directory,
      ignore_warn: '1',
    })
    this.owned.delete(directory)
  }
}
