// Port of YunX Desktop 1.3.4 Pan123Api.kt, Pan123Constants.kt, Pan123ResolveRepository.kt.
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
import { PAN123_UA, pan123CredentialSchema, pan123Sign } from './pan123-auth'
import { platformError, platformRequest } from './platform-request'

const base = 'https://yun.123pan.cn'
const downloadHeaders = {
  Referer: `${base}/`,
  'User-Agent': 'Dart/3.12 (dart:io)',
}
export class Pan123Adapter implements CloudAdapter {
  readonly platform = '123' as const
  readonly capabilities = {
    own: true,
    withoutSave: true,
    guest: false,
    save: false,
    playback: false,
  }
  constructor(private http: CloudHttp) {}
  private call(url: string, body?: unknown, anonymous = false, link = false) {
    const credential = anonymous
      ? undefined
      : pan123CredentialSchema.parse(
          JSON.parse(this.http.options.cookie() || '{}')
        )
    return platformRequest(
      this.http,
      url,
      anonymous
        ? { 'User-Agent': downloadHeaders['User-Agent'] }
        : {
            platform: url.includes('www.123865.com') ? 'android' : 'web',
            'app-version': url.includes('www.123865.com') ? '39' : '3',
            authorization: `Bearer ${credential?.token}`,
            loginuuid: credential?.device ?? '',
            ...pan123Sign(new URL(url).pathname),
            'User-Agent': PAN123_UA,
            ...(body === undefined
              ? { Accept: 'application/json, text/plain, */*' }
              : { 'Content-Type': 'application/json;charset=UTF-8' }),
          },
      body,
      link ? 'link' : 'request',
      (json) => {
        if (Number(json.code) === 0) return
        throw platformError(Number(json.code), text(json.message), {
          401: 'login',
          10001: 'login',
          429: 'rate',
          5103: 'extraction-code',
        })
      }
    )
  }
  async fetchProfile() {
    const { json } = await this.call(`${base}/b/api/user/info`)
    return parseProfile(
      [json],
      ['data.Nickname'],
      ['data.HeadImage', 'data.Avatar']
    )
  }
  async checkLogin() {
    await this.call(`${base}/b/api/user/info`)
  }
  async health() {
    const { json } = await this.call(`${base}/b/api/user/info`)
    return { member: membershipFlag(object(json.data).Vip) }
  }
  async quota() {
    const { json } = await this.call(`${base}/b/api/user/info`)
    const data = object(json.data)
    return {
      total: (bytes(data.SpacePermanent) ?? 0) + (bytes(data.SpaceTemp) ?? 0),
      used: bytes(data.SpaceUsed) ?? 0,
    }
  }
  async createSession(input: string): Promise<CloudSession> {
    const match =
      /https?:\/\/(?:www\.)?123(?:pan|684|865)\.(?:com|cn)\/s\/([a-z0-9_-]+)/i.exec(
        input
      )
    if (!match) throw new CloudError('unsupported')
    const token =
      /[?&](?:password|pwd|code)=([^&#\s]+)/i.exec(input)?.[1] ??
      /(?:提取码|提取碼)[:：\s]*([a-z0-9]+)/i.exec(input)?.[1] ??
      ''
    const session = {
      shareId: match[1],
      token: decodeURIComponent(token),
      title: '',
    }
    const files = await this.listFiles('0', session)
    session.title = files[0]?.name ?? session.shareId
    return session
  }
  async listFiles(
    directory: string,
    session?: CloudSession
  ): Promise<AdapterFile[]> {
    const files: AdapterFile[] = []
    let next = '0'
    const seen = new Set<string>()
    for (let page = 1; page < 1000; page++) {
      const url = session
        ? `${base}/b/api/share/get?limit=100&next=0&orderBy=file_name&orderDirection=asc&shareKey=${encode(session.shareId)}&ParentFileId=${encode(directory)}&Page=${page}${session.token ? `&SharePwd=${encode(session.token)}` : ''}`
        : `${base}/b/api/file/list/new?driveId=0&limit=100&next=${encode(next)}&orderBy=update_time&orderDirection=desc&parentFileId=${encode(directory)}&trashed=false&SearchData=&Page=${page}&OnlyLookAbnormalFile=0&event=homeListFile&operateType=1&inDirectSpace=false`
      const { json } = await this.call(url, undefined, !!session)
      const data = object(json.data)
      if (data.Expired === true) throw new CloudError('expired-share')
      const rows = array(data.InfoList)
      for (const row of rows) {
        const id = text(row.FileId)
        if (!id || seen.has(id)) throw new CloudError('identity')
        seen.add(id)
        const etag = text(row.Etag)
        files.push({
          id,
          name: text(row.FileName),
          bytes: bytes(row.Size),
          directory: Number(row.Type) === 1,
          parent: text(row.ParentFileId),
          path: id,
          token: `${text(row.S3KeyFlag)}|${etag}|${text(row.StorageNode)}`,
          version: text(row.UpdateAt) || undefined,
          modified: text(row.UpdateAt),
          hash: /^[a-f0-9]{32}$/i.test(etag)
            ? `md5:${etag.toLowerCase()}`
            : undefined,
        })
      }
      next = text(data.Next)
      if (!rows.length || next === '-1') return files
    }
    throw new CloudError('unsupported')
  }
  async ensureTempDir(): Promise<string> {
    throw new CloudError('unsupported')
  }
  async transferFile(): Promise<string> {
    throw new CloudError('unsupported')
  }
  async cleanupTempDir(): Promise<void> {
    throw new CloudError('unsupported')
  }
  private async unwrap(raw: string) {
    let url = raw.trim()
    if (!url.includes('://')) url = Buffer.from(url, 'base64').toString('utf8')
    else {
      const params = new URL(url).searchParams.get('params')
      if (params) url = Buffer.from(params, 'base64url').toString('utf8')
    }
    const visited = new Set<string>()
    for (let hop = 0; hop < 5; hop++) {
      if (!/^https?:\/\//i.test(url) || visited.has(url))
        throw new CloudError('headers')
      visited.add(url)
      // Only tiny JSON wrappers are read, never file bodies; JWT is never sent here.
      const operation = async () => {
        const response = await (this.http.options.fetch ?? fetch)(url, {
          headers: downloadHeaders,
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        })
        try {
          const length = Number(response.headers.get('Content-Length') ?? '-1')
          if (length < 0 || length > 8192 || !response.body) return null
          const reader = response.body.getReader()
          const chunks: Uint8Array[] = []
          let count = 0
          try {
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              count += chunk.value.length
              if (count > 8192) return null
              chunks.push(chunk.value)
            }
          } finally {
            reader.releaseLock()
          }
          try {
            return (
              text(
                object(
                  object(JSON.parse(Buffer.concat(chunks).toString())).data
                ).redirect_url
              ) || null
            )
          } catch {
            return null
          }
        } finally {
          await response.body?.cancel().catch(() => {})
        }
      }
      const next = await (this.http.options.request
        ? this.http.options.request(operation, 'request')
        : operation())
      if (!next) return url
      url = next
    }
    throw new CloudError('headers')
  }
  async getDownloadLink(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession
  ) {
    if (method !== 'own' && method !== 'without-save')
      throw new CloudError('unsupported')
    if (method === 'without-save' && !session)
      throw new CloudError('expired-share')
    const [flag, etag] = (file.token ?? '').split('|')
    if (!flag || !etag) throw new CloudError('identity')
    const { json } = await this.call(
      session
        ? 'https://www.123865.com/b/api/share/download/info'
        : `${base}/api/file/download_info`,
      session
        ? {
            ShareKey: session.shareId,
            FileID: file.id,
            S3KeyFlag: flag,
            Size: file.bytes,
            Etag: etag,
          }
        : {
            driveId: 0,
            etag,
            fileId: Number(file.id),
            s3keyFlag: flag,
            type: 0,
            fileName: file.name,
            size: file.bytes,
          },
      false,
      true
    )
    const info = object(json.data)
    const url = await this.unwrap(text(info.DownloadURL ?? info.DownloadUrl))
    return {
      fileId: file.id,
      bytes: file.bytes,
      kind: 'original-file' as const,
      version: file.version,
      hash: file.hash,
      url,
      expiresAt: signedExpiry(url),
      headers: downloadHeaders,
    }
  }
  renew(file: AdapterFile, method: CloudMethod, session?: CloudSession) {
    return this.getDownloadLink(file, method, session)
  }
}
