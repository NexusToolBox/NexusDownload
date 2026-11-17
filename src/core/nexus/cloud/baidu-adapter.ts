// Ported from YunX Desktop 1.3.4 data/network/BaiduApi.kt, BaiduConstants.kt,
// data/repository/BaiduResolveRepository.kt. Copyright YunX contributors.
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
  text,
} from './cloud-http'
import { parseCloudShare } from './quark-uc-adapter'

export const BAIDU_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
export const BAIDU_DOWNLOAD_UA =
  'netdisk;12.24.6;piano;android-android;16;JSbridge4.4.0;jointBridge;1.1.0'
const base = 'https://pan.baidu.com'
export class BaiduAdapter implements CloudAdapter {
  readonly platform = 'baidu' as const
  readonly capabilities = {
    own: true,
    withoutSave: false,
    guest: false,
    save: true,
    playback: false,
  }
  private bdstoken = ''
  private savedPaths = new Map<string, string>()
  constructor(private http: CloudHttp) {}
  private async call(
    url: string,
    body?: string,
    headers: Record<string, string> = {}
  ) {
    return (
      await this.http.json(
        url,
        {
          'User-Agent': BAIDU_WEB_UA,
          ...(body === undefined
            ? {}
            : {
                'Content-Type':
                  'application/x-www-form-urlencoded; charset=UTF-8',
              }),
          ...headers,
        },
        body
      )
    ).json
  }
  private async token(refresh = false) {
    if (this.bdstoken && !refresh) return this.bdstoken
    const json = await this.call(
      `${base}/api/gettemplatevariable?clienttype=0&app_id=250528&web=1&fields=${encode('["bdstoken"]')}`
    )
    this.bdstoken = text(object(json.result).bdstoken)
    if (!this.bdstoken) throw new CloudError('network')
    return this.bdstoken
  }
  async fetchProfile() {
    const nickname = await this.call(
      `${base}/api/gettemplatevariable?clienttype=0&app_id=250528&web=1&fields=${encode('["username"]')}`
    ).catch(() => ({}))
    const avatar = await this.call(
      `${base}/api/loginStatus?clienttype=0&web=1`
    ).catch(() => ({}))
    return parseProfile(
      [nickname, avatar],
      ['result.username'],
      ['login_info.photo_url']
    )
  }
  async checkLogin() {
    await this.token(true)
  }
  async createSession(input: string): Promise<CloudSession> {
    const share = parseCloudShare(input, 'baidu')
    let token = ''
    if (share.passcode) {
      const json = await this.call(
        `${base}/share/verify?surl=${share.id}`,
        `pwd=${encode(share.passcode)}&vcode_str=&vcode=`,
        {
          Referer: `${base}/s/${share.id}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      )
      token = text(json.randsk)
      if (!token) throw new CloudError('extraction-code')
    }
    return { shareId: share.id, token, title: '', extra: {} }
  }
  async listFiles(
    directory: string,
    session?: CloudSession
  ): Promise<AdapterFile[]> {
    const dir = directory === '0' ? '/' : directory
    const all = new Map<string, AdapterFile>()
    const token = session ? '' : await this.token()
    for (let page = 1; page <= 100; page++) {
      const shareUrl = session
        ? `${base}/rest/2.0/xpan/share?method=list&shorturl=${encode(session.shareId)}&page=${page}&num=100&root=${dir === '/' ? 1 : 0}&dir=${encode(dir)}${session.token ? `&sekey=${session.token}` : ''}`
        : ''
      const ownUrl = `${base}/api/list?clienttype=0&app_id=250528&web=1&channel=chunlei&showempty=0&order=time&desc=1&dir=${encode(dir)}&num=100&page=${page}&bdstoken=${token}`
      let json: Record<string, unknown>
      const cookie = this.http.options.cookie()
      const headers: Record<string, string> = session
        ? {
            Referer: `${base}/s/${session.shareId}`,
            Cookie:
              session.token && !cookie.includes('BDCLND=')
                ? `${cookie}; BDCLND=${session.token}`
                : cookie,
          }
        : {
            Accept: '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: `${base}/disk/main`,
          }
      try {
        json = await this.call(session ? shareUrl : ownUrl, undefined, headers)
      } catch (error) {
        if (!session && error instanceof CloudError && error.kind === 'login') {
          const fresh = await this.token(true)
          json = await this.call(
            ownUrl.replace(`bdstoken=${token}`, `bdstoken=${fresh}`),
            undefined,
            headers
          )
        } else throw error
      }
      if (session) {
        session.extra = { shareId: text(json.share_id), uk: text(json.uk) }
        session.title = text(json.title)
      }
      const batch = array(json.list ?? [])
      const before = all.size
      for (const item of batch) {
        const directory = Number(item.isdir) === 1
        const file = cloudFileSchema.parse({
          id: directory ? text(item.path) : text(item.fs_id),
          name: text(item.server_filename),
          bytes: bytes(item.size),
          directory,
          parent: dir,
          path: text(item.path),
          modified: text(item.server_mtime),
          version: text(item.server_mtime) || undefined,
          hash: text(item.md5) || undefined,
        })
        all.set(file.id, file)
      }
      if (batch.length < 100 || all.size === before) return [...all.values()]
    }
    throw new CloudError('unsupported')
  }
  async quota() {
    const json = await this.call(
      `${base}/api/quota?clienttype=0&app_id=250528&web=1&channel=chunlei&version=${Date.now()}`,
      undefined,
      { 'X-Requested-With': 'XMLHttpRequest', Referer: `${base}/disk/main` }
    )
    return { total: bytes(json.total) ?? 0, used: bytes(json.used) ?? 0 }
  }
  async ensureTempDir(name: string) {
    const dir = `/${name}`
    await this.call(
      `${base}/api/create?a=commit&channel=chunlei&web=1&app_id=250528&clienttype=0&bdstoken=${await this.token()}`,
      `path=${encode(dir)}&isdir=1&size&block_list=%5B%5D&method=post&dataType=json`,
      { Referer: `${base}/disk/main` }
    )
    // No fallback to the user's root: every transferred object has an owned directory.
    return dir
  }
  async transferFile(
    session: CloudSession,
    file: AdapterFile,
    directory: string
  ) {
    if (!session.extra?.shareId || !session.extra.uk)
      await this.listFiles('0', session)
    const cookie = this.http.options.cookie()
    const json = await this.call(
      `${base}/share/transfer?shareid=${session.extra?.shareId}&from=${session.extra?.uk}&channel=chunlei&sekey=${session.token}&ondup=newcopy&web=1&app_id=250528&bdstoken=${await this.token()}&clienttype=0`,
      `fsidlist=%5B%22${encode(file.id)}%22%5D&path=${encode(directory)}`,
      {
        Cookie: cookie.includes('BDCLND=')
          ? cookie
          : `${cookie}; BDCLND=${session.token}`,
        Origin: base,
        Referer: `${base}/s/`,
      }
    )
    const first = array(object(json.extra).list)[0]
    const id = text(first?.to_fs_id)
    const savedPath = text(first?.to)
    if (!id || !savedPath) throw new CloudError('network')
    this.savedPaths.set(id, savedPath)
    return id
  }
  async getDownloadLink(
    file: AdapterFile,
    method: CloudMethod,
    _session?: CloudSession,
    savedId?: string
  ): Promise<CloudResource> {
    if (method !== 'own' && method !== 'save')
      throw new CloudError('unsupported')
    let url: string
    let actualBytes: number | null = null
    if (method === 'save') {
      const savedPath = savedId ? this.savedPaths.get(savedId) : undefined
      if (!savedPath) throw new CloudError('identity')
      const time = Math.floor(Date.now() / 1000)
      const json = await this.call(
        `https://d.pcs.baidu.com/rest/2.0/pcs/file?method=locatedownload&app_id=250528&clienttype=17&ver=4.0&ant=1&check_blue=1&es=1&esl=1&apn_id=1_-1&freeisp=0&queryfree=0&use=1&dtype=1&eck=1&ehps=1&err_ver=1.0&network_type=WIFI&channel=0&path=${encode(savedPath)}&time=${time}&rand=5ed606e9da222cde0474cdf70eda884b&devuid=0F1E9FC2E084472DA5A61C4CF4C759AF&cuid=0F1E9FC2E084472DA5A61C4CF4C759AF&deviceid=348642637967375013&psign=860a071f77c860e8cea06e4e54c518f3&version=2.2.111.34&version_app=12.24.6&vip=0`,
        '0',
        {
          'User-Agent': BAIDU_DOWNLOAD_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      )
      const candidates = array(json.urls).filter(
        (item) => Number(item.encrypt) === 0 && text(item.url)
      )
      candidates.sort(
        (a, b) =>
          Number(!text(a.url).startsWith('https')) -
          Number(!text(b.url).startsWith('https'))
      )
      url = text(candidates[0]?.url)
      // Encrypted candidates cannot be handed to an ordinary byte downloader.
      if (!url) throw new CloudError('unsupported')
      actualBytes = bytes(json.size)
    } else {
      const json = await this.call(
        `${base}/api/filemetas?dlink=1&fsids=${encode(JSON.stringify([file.id]))}&bdstoken=${await this.token()}&clienttype=0&app_id=250528&web=1`
      )
      const info = array(json.info)[0]
      url = text(info?.dlink)
      actualBytes = bytes(info?.size)
    }
    if (!url) throw new CloudError('permission')
    const cookie = this.http.options
      .cookie()
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('BDUSS='))
    if (!cookie) throw new CloudError('login')
    const resource: CloudResource = {
      fileId: file.id,
      version: file.version,
      hash: file.hash,
      bytes: actualBytes,
      kind: 'original-file',
      url,
      headers: { Cookie: cookie, 'User-Agent': BAIDU_DOWNLOAD_UA },
      savedId,
    }
    const expires = new URL(url).searchParams.get('expires')
    if (
      expires &&
      Number.isFinite(Number(expires)) &&
      Number(expires) * 1000 > Date.now()
    )
      resource.expiresAt = Number(expires) * 1000
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
  async restoreTransfer(savedId: string, directory: string) {
    if (!directory.startsWith('/NexusDownload_tr_'))
      throw new CloudError('identity')
    const file = (await this.listFiles(directory)).find(
      (item) => item.id === savedId
    )
    if (!file) throw new CloudError('identity')
    this.savedPaths.set(savedId, file.path)
  }
  async cleanupTempDir(directory: string) {
    if (!directory.startsWith('/NexusDownload_tr_'))
      throw new CloudError('identity')
    await this.call(
      `${base}/api/filemanager?async=2&onnest=fail&opera=delete&bdstoken=${await this.token()}&newVerify=1&clienttype=0&app_id=250528&web=1`,
      `filelist=${encode(JSON.stringify([directory]))}`
    )
  }
}
