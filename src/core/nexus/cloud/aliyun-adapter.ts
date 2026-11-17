// Derived from OpenList v4.2.9 (0497ee853853eff5fc0ada9f21684a990887de83),
// drivers/aliyundrive_open/{driver,util,types,meta}.go and aliyundrive_share equivalents.
// Copyright OpenList contributors. SPDX-License-Identifier: AGPL-3.0-only

import {
  type AliyunCredential,
  aliyunCredentialSchema,
} from '@shared/schemas/nexus-aliyun'
import type { CloudMethod } from '@shared/schemas/nexus-cloud'
import { parseProfile } from './account-profile'
import {
  type AdapterFile,
  type CloudAdapter,
  CloudError,
  type CloudResource,
  type CloudSession,
} from './cloud-adapter'
import {
  array,
  bytes,
  type CloudHttp,
  object,
  signedExpiry,
  text,
} from './cloud-http'
import { platformError, platformRequest } from './platform-request'

const open = 'https://openapi.alipan.com'
const canary = 'client=web,app=share,version=v2.3.1'
function validate(json: Record<string, unknown>) {
  const code = text(json.code)
  if (!code || code === '0') return
  if (
    /AccessTokenInvalid|AccessTokenExpired|RefreshToken|InvalidGrant|I400JD/.test(
      code
    )
  )
    throw new CloudError('login')
  if (/ShareLinkTokenInvalid/.test(code)) throw new CloudError('expired-share')
  if (/ShareLink.*(Cancel|Expired|NotFound|Forbidden)/i.test(code))
    throw new CloudError('expired-share')
  if (/ShareLinkPwd|InvalidSharePwd/.test(code))
    throw new CloudError('extraction-code')
  throw platformError(Number(code), `${code} ${text(json.message)}`, {})
}
export async function exchangeAliyunCode(
  http: CloudHttp,
  credential: AliyunCredential,
  code: string
) {
  const { json } = await platformRequest(
    http,
    `${open}/oauth/access_token`,
    { 'Content-Type': 'application/json' },
    {
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: credential.redirectUri,
    },
    'request',
    validate
  )
  return tokens(credential, json)
}
function tokens(
  current: AliyunCredential,
  json: Record<string, unknown>
): AliyunCredential {
  const accessToken = text(json.access_token)
  const refreshToken = text(json.refresh_token)
  if (!accessToken || !refreshToken || /[\r\n]/.test(accessToken))
    throw new CloudError('network')
  const seconds = Number(json.expires_in)
  return aliyunCredentialSchema.parse({
    ...current,
    accessToken,
    refreshToken,
    expiresAt:
      Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0,
  })
}
export class AliyunAdapter implements CloudAdapter {
  readonly platform = 'aliyun' as const
  private drive = ''
  get capabilities() {
    return {
      own: this.credential()?.mode !== 'share',
      withoutSave: true,
      guest: false,
      save: false,
      playback: false,
    }
  }
  constructor(
    private http: CloudHttp,
    private refreshStore?: (
      exchange: (current: string) => Promise<string>
    ) => Promise<string>
  ) {}
  private credential() {
    const raw = this.http.options.cookie()
    return raw ? aliyunCredentialSchema.parse(JSON.parse(raw)) : undefined
  }
  private async refresh(force = false) {
    const initial = this.credential()
    if (!initial || !this.refreshStore) throw new CloudError('open-platform')
    if (
      !force &&
      initial.accessToken &&
      (!initial.expiresAt || initial.expiresAt > Date.now() + 120000)
    )
      return initial
    const value = await this.refreshStore(async (raw) => {
      const current = aliyunCredentialSchema.parse(JSON.parse(raw))
      if (
        current.accessToken !== initial.accessToken &&
        (!current.expiresAt || current.expiresAt > Date.now() + 120000)
      )
        return raw
      let url: string
      let body: unknown
      if (current.mode === 'online') {
        if (!current.consent) throw new CloudError('permission')
        const service = new URL(current.serviceUrl)
        if (
          service.protocol !== 'https:' ||
          service.username ||
          service.password ||
          service.hash
        )
          throw new CloudError('permission')
        service.searchParams.set('refresh_ui', current.refreshToken)
        service.searchParams.set('server_use', 'true')
        service.searchParams.set('driver_txt', 'alicloud_qr')
        url = service.toString()
      } else if (current.mode === 'official') {
        if (!current.clientId || !current.clientSecret)
          throw new CloudError('open-platform')
        url = `${open}/oauth/access_token`
        body = {
          client_id: current.clientId,
          client_secret: current.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
        }
      } else {
        url = 'https://auth.alipan.com/v2/account/token'
        body = {
          refresh_token: current.refreshToken,
          grant_type: 'refresh_token',
        }
      }
      const { json } = await platformRequest(
        this.http,
        url,
        body === undefined ? {} : { 'Content-Type': 'application/json' },
        body,
        'request',
        validate
      )
      return JSON.stringify(tokens(current, json))
    })
    return aliyunCredentialSchema.parse(JSON.parse(value))
  }
  private async call(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
    authenticated = true,
    kind: 'request' | 'link' = 'request'
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const credential = authenticated
        ? await this.refresh(attempt > 0)
        : undefined
      try {
        return await platformRequest(
          this.http,
          url,
          {
            'Content-Type': 'application/json',
            ...headers,
            ...(credential
              ? {
                  Authorization: `Bearer${credential.mode === 'share' ? '\t' : ' '}${credential.accessToken}`,
                }
              : {}),
          },
          body,
          kind,
          validate
        )
      } catch (error) {
        if (
          !authenticated ||
          attempt ||
          !(error instanceof CloudError) ||
          error.kind !== 'login'
        )
          throw error
      }
    }
    throw new CloudError('login')
  }
  private async driveId() {
    if (this.credential()?.mode === 'share')
      throw new CloudError('open-platform')
    if (!this.drive) {
      const { json } = await this.call(
        `${open}/adrive/v1.0/user/getDriveInfo`,
        {}
      )
      this.drive = text(json.resource_drive_id ?? json.default_drive_id)
      if (!this.drive) throw new CloudError('open-platform')
    }
    return this.drive
  }
  async fetchProfile() {
    const { json } = await this.call(`${open}/oauth/users/info`, undefined)
    return parseProfile([json], ['name'], ['avatar'])
  }
  async checkLogin() {
    if (this.credential()?.mode === 'share') {
      await this.refresh(true)
      return
    }
    this.drive = ''
    await this.driveId()
  }
  async quota() {
    if (this.credential()?.mode === 'share') throw new CloudError('unsupported')
    const { json } = await this.call(
      `${open}/adrive/v1.0/user/getSpaceInfo`,
      {}
    )
    const space = object(json.personal_space_info)
    return {
      total: bytes(space.total_size) ?? 0,
      used: bytes(space.used_size) ?? 0,
    }
  }
  async createSession(input: string): Promise<CloudSession> {
    const match =
      /https?:\/\/(?:www\.)?(?:alipan|aliyundrive)\.com\/s\/([a-z0-9]+)/i.exec(
        input
      )
    if (!match) throw new CloudError('unsupported')
    const password =
      /[?&](?:pwd|password)=([^&#\s]+)/i.exec(input)?.[1] ??
      /(?:提取码|提取碼)[:：\s]*([a-z0-9]+)/i.exec(input)?.[1] ??
      ''
    const { json } = await this.call(
      'https://api.alipan.com/v2/share_link/get_share_token',
      {
        share_id: match[1],
        ...(password ? { share_pwd: decodeURIComponent(password) } : {}),
      },
      {},
      false
    )
    const token = text(json.share_token)
    if (!token) throw new CloudError('expired-share')
    return { shareId: match[1], token, title: match[1] }
  }
  async listFiles(
    directory: string,
    session?: CloudSession
  ): Promise<AdapterFile[]> {
    const result: AdapterFile[] = []
    let marker = ''
    const seen = new Set<string>()
    for (let page = 0; page < 1000; page++) {
      const body = {
        limit: 200,
        marker,
        order_by: 'name',
        order_direction: 'ASC',
        parent_file_id: directory === '0' ? 'root' : directory,
        ...(session
          ? {
              share_id: session.shareId,
              image_thumbnail_process: 'image/resize,w_160/format,jpeg',
              image_url_process: 'image/resize,w_1920/format,jpeg',
              video_thumbnail_process:
                'video/snapshot,t_1000,f_jpg,ar_auto,w_300',
            }
          : { drive_id: await this.driveId() }),
      }
      const { json } = await this.call(
        session
          ? 'https://api.alipan.com/adrive/v3/file/list'
          : `${open}/adrive/v1.0/openFile/list`,
        body,
        session ? { 'x-share-token': session.token, 'X-Canary': canary } : {},
        !session
      )
      for (const row of array(json.items)) {
        const id = text(row.file_id)
        if (!id || seen.has(id)) throw new CloudError('identity')
        seen.add(id)
        const hash = text(row.content_hash).toLowerCase()
        const algorithm = text(row.content_hash_name).toLowerCase()
        result.push({
          id,
          name: text(row.name),
          directory: row.type === 'folder',
          bytes: row.type === 'folder' ? 0 : bytes(row.size),
          parent: text(row.parent_file_id),
          path: id,
          version: text(row.updated_at) || undefined,
          modified: text(row.updated_at),
          token: text(row.drive_id),
          hash:
            ['sha1', 'md5', 'sha256'].includes(algorithm) &&
            /^[a-f0-9]+$/.test(hash)
              ? `${algorithm}:${hash}`
              : undefined,
        })
      }
      const next = text(json.next_marker)
      if (!next) return result
      if (next === marker) throw new CloudError('identity')
      marker = next
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
  async getDownloadLink(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession
  ): Promise<CloudResource> {
    if (!['own', 'without-save'].includes(method))
      throw new CloudError('unsupported')
    if (method === 'without-save' && !session)
      throw new CloudError('expired-share')
    if (session && this.credential()?.mode !== 'share')
      throw new CloudError('share-auth')
    const { json } = await this.call(
      session
        ? 'https://api.alipan.com/v2/file/get_share_link_download_url'
        : `${open}/adrive/v1.0/openFile/getDownloadUrl`,
      {
        drive_id: session ? file.token : await this.driveId(),
        file_id: file.id,
        expire_sec: session ? 600 : 14400,
        ...(session ? { share_id: session.shareId } : {}),
      },
      session ? { 'x-share-token': session.token, 'X-Canary': canary } : {},
      true,
      'link'
    )
    const url = text(session ? json.download_url : json.url)
    if (!/^https?:\/\//i.test(url)) throw new CloudError('permission')
    return {
      fileId: file.id,
      bytes: file.bytes,
      version: file.version,
      hash: file.hash,
      kind: 'original-file' as const,
      url,
      expiresAt: signedExpiry(url),
      headers: session ? { Referer: 'https://www.alipan.com/' } : {},
    }
  }
  renew(file: AdapterFile, method: CloudMethod, session?: CloudSession) {
    return this.getDownloadLink(file, method, session)
  }
}
