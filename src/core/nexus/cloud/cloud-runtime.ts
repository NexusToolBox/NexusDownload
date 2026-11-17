import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { EngineAdapter } from '@core/engine/engine-adapter'
import type { TaskManager } from '@core/task/task-manager'
import { NEXUS_VERSION } from '@shared/nexus-version'
import type {
  TaskCreateCommandResult,
  TaskCreateRequest,
} from '@shared/schemas/add-task'
import {
  aliyunCredentialSchema,
  aliyunLoginSchema,
} from '@shared/schemas/nexus-aliyun'
import {
  type CloudErrorKind,
  type CloudPlatform,
  type CloudPreflight,
  cloudAccountSchema,
  cloudAccountUpdateSchema,
  cloudBrowseRequestSchema,
  cloudErrorSchema,
  cloudFileSchema,
  cloudMethodSchema,
  cloudOpenShareSchema,
  cloudPlatformSchema,
  cloudProfileSchema,
  cloudSelectionSchema,
  cloudSelfCheckSchema,
} from '@shared/schemas/nexus-cloud'
import { type DownloadTask, TaskStatus } from '@shared/types/task'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { getNexusDiskSpace } from '../disk-space'
import { duplicateTask } from '../duplicate-download'
import { AccountGovernor } from './account-governor'
import { inspectAccountHealth } from './account-health'
import { cacheAvatar, readAvatar, removeAvatar } from './account-profile'
import { chooseCloudAccount } from './account-selector'
import { AliyunAdapter, exchangeAliyunCode } from './aliyun-adapter'
import { BaiduAdapter } from './baidu-adapter'
import {
  type AdapterFile,
  type CloudAdapter,
  CloudError,
  type CloudResource,
  type CloudSession,
  verifyResource,
} from './cloud-adapter'
import { CloudHttp } from './cloud-http'
import { prepareCloudDirectory, safeCloudName } from './cloud-path'
import type { CredentialBroker } from './credential-broker'
import { mergeCookies } from './credential-broker'
import { DownloadRelay } from './download-relay'
import { ExistingFileDetector } from './existing-files'
import { resolveKouling } from './kouling'
import { Pan115Adapter } from './pan115-adapter'
import { Pan123Adapter } from './pan123-adapter'
import { pan123PasswordLogin } from './pan123-auth'
import { QuarkUcAdapter } from './quark-uc-adapter'
import { renewDownload } from './renewal'
import { diagnosticPath, requestPlatform } from './request-diagnostics'

const sessionSchema = z.object({
  input: z.string().optional(),
  shareId: z.string(),
  token: z.string(),
  title: z.string(),
  extra: z.record(z.string(), z.string()).optional(),
})
const fileSchema = cloudFileSchema.extend({ token: z.string().optional() })
const governorSchema = z.object({
  profile: z.enum(['conservative', 'standard']).optional(),
  day: z.string(),
  requests: z.number(),
  links: z.number(),
  transfers: z.number(),
  reason: cloudErrorSchema.optional(),
  recentRiskAt: z.number().optional(),
})
const metaSchema = z.object({
  fileId: z.string(),
  version: z.string().optional(),
  hash: z.string().optional(),
  bytes: z.number().safe().nullable(),
  kind: z.enum(['original-file', 'playback-stream']),
})
const bindingSchema = z.object({
  taskId: z.string(),
  gid: z.string(),
  output: z.string(),
  root: z.string(),
  parents: z.array(z.string()),
  platform: cloudPlatformSchema,
  accountId: z.string().optional(),
  file: fileSchema,
  method: cloudMethodSchema,
  session: sessionSchema.optional(),
  savedId: z.string().optional(),
  tempDir: z.string().optional(),
  meta: metaSchema,
  phase: z.enum([
    'pausing',
    'checkpoint',
    'removed',
    'readded',
    'ready',
    'blocked',
  ]),
  reason: cloudErrorSchema.optional(),
  cleanup: z.enum(['retained', 'pending', 'complete']).default('retained'),
})
const stateSchema = z.object({
  version: z.literal(1),
  accounts: z.array(
    z.object({
      id: z.string(),
      platform: cloudPlatformSchema,
      governor: governorSchema,
      note: z.string().max(128).default(''),
      transferOnly: z.boolean().default(false),
      health: cloudAccountSchema.shape.health,
      profile: cloudProfileSchema.optional(),
    })
  ),
  bindings: z.array(bindingSchema),
  orphans: z
    .array(z.object({ accountId: z.string(), directory: z.string() }))
    .default([]),
  koulingEnabled: z.boolean().default(false),
})
type Binding = z.infer<typeof bindingSchema>
interface Context {
  platform: CloudPlatform
  accountId?: string
  automatic?: boolean
  session?: CloudSession
  files: AdapterFile[]
  adapter: CloudAdapter
}
export class CloudRuntime {
  private state: z.infer<typeof stateSchema> = {
    version: 1,
    accounts: [],
    bindings: [],
    orphans: [],
    koulingEnabled: false,
  }
  private contexts = new Map<string, Context>()
  private adapters = new Map<string, CloudAdapter>()
  private leases = new Map<
    string,
    { uri: string; resource: CloudResource; renewAt?: number }
  >()
  private pending = new Map<string, Promise<unknown>>()
  private failedRenewals = new Map<string, { at: number; bytes: number }>()
  private healthPending?: Promise<unknown>
  private authenticating = new Set<string>()
  private healthTimer?: ReturnType<typeof setInterval>
  private stopping = false
  private checking?: Promise<unknown>
  private checkingKey?: string
  private downloading = false
  private transfers = new Map<string, { savedId: string; tempDir: string }>()
  private submitted = new Map<string, string>()
  private relay = new DownloadRelay()
  private existingFiles = new ExistingFileDetector()
  private create?: (
    request: TaskCreateRequest
  ) => Promise<TaskCreateCommandResult>
  private available = true
  private needsLocalLogin = new Set<string>()
  private avatarData = new Map<string, string>()
  private profileDiagnostics = new Map<
    string,
    { nickname: boolean; avatar: boolean; fields: string[] }
  >()
  private get avatarDirectory() {
    return path.join(this.options.broker.directory, 'avatars')
  }
  private get accountIndex() {
    return path.join(this.options.broker.directory, 'cloud-accounts.json')
  }
  private recentRequests: import('./request-diagnostics').CloudRequestRecord[] =
    []
  readonly governor: AccountGovernor
  constructor(
    private options: {
      enqueue?(ids: string[]): Promise<void>
      profiles?: import('../speed-profiles').SpeedProfiles
      duplicateWarning?: () => boolean
      group?: (
        name: string,
        ids: string[],
        directory: string,
        description: string
      ) => Promise<unknown>
      media?: (
        resource: CloudResource,
        directory: string,
        filename: string
      ) => Promise<{ taskId: string }>
      broker: CredentialBroker
      engine: EngineAdapter
      tasks: TaskManager
      persistTask: (task: DownloadTask) => Promise<void>
      changed: () => void
      login: (
        platform: CloudPlatform,
        validate: (credential: string) => Promise<string>
      ) => Promise<string>
      diagnosticsEnabled?: () => boolean
      diagnostic?: (
        record: import('./request-diagnostics').CloudRequestRecord
      ) => void
      authorize?: (
        url: string,
        redirectUri: string,
        state: string
      ) => Promise<string>
      mutate: <T>(ids: string[], operation: () => Promise<T>) => Promise<T>
      adapterFactory?: (
        platform: CloudPlatform,
        http: CloudHttp
      ) => CloudAdapter
    }
  ) {
    this.governor = new AccountGovernor({
      persist: async (id, state) => {
        const account = this.state.accounts.find((a) => a.id === id)
        if (account) account.governor = state
        await this.persist()
      },
      pause: async (id, reason) => {
        const account = this.state.accounts.find((a) => a.id === id)
        if (account && ['login', 'login-elsewhere'].includes(reason))
          account.health = {
            checkedAt: Date.now(),
            login: 'expired',
            member: null,
            quota: null,
            platformUsedBytes: null,
            expiresAt: null,
          }
        await Promise.all(
          this.state.bindings
            .filter((b) => (b.accountId ?? `guest-${b.platform}`) === id)
            .map((b) => this.block(b, reason))
        )
      },
    })
  }
  setCreate(
    create: (request: TaskCreateRequest) => Promise<TaskCreateCommandResult>
  ) {
    this.create = create
  }
  private lease(uri: string, resource: CloudResource) {
    const now = Date.now()
    return {
      uri,
      resource,
      renewAt: resource.expiresAt
        ? resource.expiresAt -
          Math.min(120000, Math.max(0, resource.expiresAt - now) * 0.1)
        : undefined,
    }
  }
  async start() {
    try {
      await this.options.broker.load()
      const saved = this.options.broker.get('cloud-state')
      if (saved) this.state = stateSchema.parse(JSON.parse(saved))
    } catch {
      try {
        const saved = JSON.parse(
          await readFile(this.accountIndex, 'utf8').catch(() => '[]')
        )
        this.state.accounts = stateSchema.shape.accounts.parse(saved)
        await this.options.broker.recoverForRelogin()
        for (const account of this.state.accounts) {
          this.needsLocalLogin.add(account.id)
          account.governor.reason = 'login'
          account.health = {
            checkedAt: Date.now(),
            login: 'expired',
            member: null,
            quota: null,
            platformUsedBytes: null,
            expiresAt: null,
          }
        }
      } catch {
        this.available = false
      }
    }
    for (const account of this.state.accounts) {
      if (account.profile?.avatarPath)
        account.profile.avatarPath = path.join(
          this.avatarDirectory,
          path.basename(account.profile.avatarPath)
        )
      const avatar = await readAvatar(
        this.avatarDirectory,
        account.profile?.avatarPath
      )
      if (avatar) this.avatarData.set(account.id, avatar)
    }
    for (const account of this.state.accounts)
      this.governor.load(account.id, account.governor)
    await this.relay.start()
    void this.checkHealth(undefined, true).catch(() => undefined)
    this.healthTimer = setInterval(() => {
      void this.checkHealth().catch(() => undefined)
    }, 60000)
    this.healthTimer.unref()
  }
  private async persist() {
    await this.options.broker.update('cloud-state', () =>
      JSON.stringify(this.state)
    )
    await writeFileAtomic(
      this.accountIndex,
      JSON.stringify(this.state.accounts),
      { mode: 0o600 }
    )
    this.options.changed()
  }
  private account(id?: string) {
    const account = this.state.accounts.find((a) => a.id === id)
    if (id && !account) throw new CloudError('login')
    return account
  }
  private recordRequest(
    record: import('./request-diagnostics').CloudRequestRecord
  ) {
    if (!this.options.diagnosticsEnabled?.()) {
      this.recentRequests = []
      return
    }
    this.recentRequests.push(record)
    this.recentRequests = this.recentRequests.slice(-20)
    this.options.diagnostic?.(record)
  }
  private requestResource(
    platform: CloudPlatform,
    accountId: string | undefined,
    resource: CloudResource,
    operation: () => Promise<Response>
  ) {
    return this.governor.run(
      accountId ?? `guest-${platform}`,
      platform,
      'request',
      async () => {
        const address = new URL(resource.url)
        let status = 0
        let redirect: string | undefined
        try {
          const response = await operation()
          status = response.status
          const final = response.url ? new URL(response.url) : address
          if (response.redirected)
            redirect = `${final.hostname}${diagnosticPath(final)}`.slice(0, 256)
          const cookies = response.headers.getSetCookie()
          if (
            accountId &&
            cookies.length &&
            !['123', 'aliyun'].includes(platform) &&
            requestPlatform(final.hostname) === platform
          )
            await this.options.broker.update(accountId, (old) =>
              mergeCookies(old, cookies)
            )
          return response
        } finally {
          this.recordRequest({
            at: Date.now(),
            platform,
            path: diagnosticPath(address),
            status,
            redirect,
            fields: [],
          })
        }
      }
    )
  }
  private adapter(platform: CloudPlatform, accountId?: string): CloudAdapter {
    const account = this.account(accountId)
    if (account && account.platform !== platform) throw new CloudError('login')
    const key = accountId ?? `guest-${platform}`
    const existing = this.adapters.get(key)
    if (existing) return existing
    const http = new CloudHttp({
      platform,
      diagnostic: (record) => this.recordRequest(record),
      cookie: () => (accountId ? this.options.broker.get(accountId) : ''),
      merge: async (cookies) => {
        if (
          accountId &&
          cookies.length &&
          !['123', 'aliyun'].includes(platform)
        )
          await this.options.broker.update(accountId, (old) =>
            mergeCookies(old, cookies)
          )
      },
      request: (operation, kind) =>
        this.governor.run(key, platform, kind, operation),
    })
    const adapter =
      this.options.adapterFactory?.(platform, http) ??
      (platform === 'aliyun'
        ? new AliyunAdapter(
            http,
            accountId
              ? (exchange) => this.options.broker.refresh(accountId, exchange)
              : undefined
          )
        : platform === '123'
          ? new Pan123Adapter(http)
          : platform === '115'
            ? new Pan115Adapter(http)
            : platform === 'baidu'
              ? new BaiduAdapter(http)
              : new QuarkUcAdapter(platform, http))
    this.adapters.set(key, adapter)
    return adapter
  }
  offlineAdapter(accountId: string) {
    const account = this.account(accountId)
    if (account?.platform !== '115') throw new CloudError('login')
    const adapter = this.adapter('115', accountId)
    if (!(adapter instanceof Pan115Adapter)) throw new CloudError('unsupported')
    return adapter
  }
  private accountView(account: (typeof this.state.accounts)[number]) {
    let authorization: 'web' | 'official' | 'online' | 'share' = 'web'
    if (account.platform === 'aliyun')
      try {
        authorization = aliyunCredentialSchema.parse(
          JSON.parse(this.options.broker.get(account.id))
        ).mode
      } catch {
        authorization = 'official'
      }
    return {
      ...this.governor.snapshot(account.id, account.platform),
      note: account.note,
      transferOnly: account.transferOnly,
      health: account.health,
      profile: account.profile,
      avatarData: this.avatarData.get(account.id),
      needsLocalLogin: this.needsLocalLogin.has(account.id),
      authorization,
      temporaryCount: new Set([
        ...this.state.orphans
          .filter((o) => o.accountId === account.id)
          .map((o) => o.directory),
        ...this.state.bindings
          .filter(
            (b) =>
              b.accountId === account.id &&
              b.cleanup !== 'complete' &&
              b.tempDir
          )
          .map((b) => b.tempDir),
      ]).size,
    }
  }
  async checkHealth(raw?: unknown, force = false): Promise<unknown> {
    const id = z.string().optional().parse(raw)
    if (this.healthPending) {
      await this.healthPending
      if (id) return this.checkHealth(id, true)
      return this.snapshot()
    }
    this.healthPending = this.runHealth(id, force || !!id)
    try {
      await this.healthPending
      return this.snapshot()
    } finally {
      this.healthPending = undefined
    }
  }
  private async runHealth(id?: string, force = false) {
    if (!this.available || this.stopping) return
    if (id) this.account(id)
    for (const account of [...this.state.accounts]) {
      if (this.stopping) break
      if (this.authenticating.has(account.id)) continue
      if (id && account.id !== id) continue
      const state = this.governor.snapshot(account.id, account.platform)
      if (state.state === 'paused') continue
      if (
        !force &&
        account.health &&
        Date.now() - account.health.checkedAt < 86400000
      )
        continue
      const health = await inspectAccountHealth(
        this.adapter(account.platform, account.id)
      )
      // A logout while a request was in flight cannot restore that account.
      if (!this.state.accounts.includes(account)) continue
      account.health = health
      if (health.login === 'valid') await this.refreshProfile(account)
      if (
        health.login === 'expired' &&
        this.governor.snapshot(account.id, account.platform).reason !==
          'login-elsewhere'
      )
        await this.governor.trip(account.id, 'login')
      await this.persist()
    }
  }
  private async refreshProfile(account: (typeof this.state.accounts)[number]) {
    const adapter = this.adapter(account.platform, account.id)
    if (!adapter.fetchProfile) return
    try {
      const result = await adapter.fetchProfile()
      if (!this.state.accounts.includes(account) || this.stopping) return
      const previous = account.profile
      const now = Date.now()
      account.profile = {
        ...previous,
        nickname: result.nickname || previous?.nickname || '',
        readAt: now,
      }
      if (
        !previous?.avatarCheckedAt ||
        now - previous.avatarCheckedAt >= 86400000
      ) {
        account.profile.avatarCheckedAt = now
        const file = result.avatar
          ? await cacheAvatar(
              this.avatarDirectory,
              account.id,
              result.avatar
            ).catch(() => undefined)
          : undefined
        if (!this.state.accounts.includes(account)) {
          await removeAvatar(this.avatarDirectory, file)
          return
        }
        if (file) {
          if (previous?.avatarPath !== file)
            await removeAvatar(this.avatarDirectory, previous?.avatarPath)
          account.profile.avatarPath = file
          const image = await readAvatar(this.avatarDirectory, file)
          if (image) this.avatarData.set(account.id, image)
        }
      }
      this.profileDiagnostics.set(account.id, {
        nickname: !!result.nickname,
        avatar: !!this.avatarData.get(account.id),
        fields: result.fields,
      })
      this.recordRequest({
        at: now,
        platform: account.platform,
        path: '/account/profile',
        status: 200,
        fields:
          !result.nickname || !this.avatarData.has(account.id)
            ? result.fields
            : [],
        profile: {
          nickname: result.nickname ? '已取到' : '未取到',
          avatar: this.avatarData.has(account.id) ? '已取到' : '未取到',
        },
      })
    } catch {
      this.profileDiagnostics.set(account.id, {
        nickname: false,
        avatar: !!this.avatarData.get(account.id),
        fields: [],
      })
    }
  }
  async updateAccount(raw: unknown) {
    const req = cloudAccountUpdateSchema.parse(raw)
    const account = this.account(req.id)
    if (!account) throw new CloudError('login')
    if (
      req.transferOnly &&
      !this.adapter(account.platform, account.id).capabilities.save
    )
      throw new CloudError('unsupported')
    account.note = req.note
    if (req.transferOnly)
      for (const other of this.state.accounts)
        if (other.platform === account.platform) other.transferOnly = false
    account.transferOnly = req.transferOnly
    if (req.governor) await this.governor.setProfile(account.id, req.governor)
    await this.persist()
    return this.snapshot()
  }
  snapshot() {
    return {
      available: this.available,
      accounts: this.state.accounts.map((a) => this.accountView(a)),
      tasks: this.state.bindings.map((b) => ({
        taskId: b.taskId,
        phase: b.phase,
        reason: b.reason,
        platform: b.platform,
        accountId: b.accountId,
        method: b.method,
        kind: b.meta.kind,
        cleanup: b.cleanup,
      })),
      orphans: this.state.orphans.map((o) => ({ ...o })),
      koulingEnabled: this.state.koulingEnabled,
    }
  }
  async login(raw: unknown) {
    const envelope = z
      .object({ credentials: z.unknown(), accountId: z.string().max(128) })
      .strict()
      .safeParse(raw)
    const existing = envelope.success
      ? this.account(envelope.data.accountId)
      : undefined
    const req = z
      .union([
        cloudPlatformSchema,
        aliyunLoginSchema,
        z
          .object({
            platform: z.literal('123'),
            account: z.string().trim().min(1).max(254),
            password: z.string().min(1).max(256),
          })
          .strict(),
      ])
      .parse(envelope.success ? envelope.data.credentials : raw)
    const platform = typeof req === 'string' ? req : req.platform
    if (!this.available) throw new CloudError('login')
    if (existing && existing.platform !== platform)
      throw new CloudError('identity')
    await this.healthPending
    const id = existing?.id ?? `account-${randomUUID()}`
    const previousCredential = existing
      ? this.options.broker.get(id)
      : undefined
    const previousState = existing
      ? this.governor.snapshot(id, platform)
      : undefined
    if (previousState?.state === 'paused') {
      if (!['login', 'login-elsewhere'].includes(previousState.reason ?? ''))
        throw new CloudError(previousState.reason ?? 'risk')
    }
    this.authenticating.add(id)
    try {
      let cookie: string
      let webValidated = false
      if (
        platform === '123' &&
        typeof req !== 'string' &&
        req.platform === '123'
      ) {
        let device = this.options.broker.get('pan123-device')
        if (!/^[a-f0-9]{32}$/.test(device)) {
          device = randomUUID().replaceAll('-', '')
          await this.options.broker.update('pan123-device', () => device)
        }
        const http = new CloudHttp({
          platform,
          diagnostic: (record) => this.recordRequest(record),
          cookie: () => '',
          merge: async () => {},
          request: (operation, kind) =>
            this.governor.run(`login-${id}`, platform, kind, operation),
        })
        cookie = JSON.stringify(
          await pan123PasswordLogin(http, device, req.account, req.password)
        )
      } else if (platform === 'aliyun') {
        if (typeof req === 'string' || req.platform !== 'aliyun')
          throw new CloudError('open-platform')
        let credential = aliyunCredentialSchema.parse(req)
        if (req.mode === 'official') {
          if (!this.options.authorize) throw new CloudError('open-platform')
          const state = randomUUID()
          const url = new URL('https://openapi.alipan.com/oauth/authorize')
          url.search = new URLSearchParams({
            client_id: req.clientId,
            redirect_uri: req.redirectUri,
            response_type: 'code',
            scope: 'user:base,file:all:read',
            state,
          }).toString()
          const code = await this.options.authorize(
            url.toString(),
            req.redirectUri,
            state
          )
          const http = new CloudHttp({
            platform,
            diagnostic: (record) => this.recordRequest(record),
            cookie: () => '',
            merge: async () => {},
            request: (op, kind) =>
              this.governor.run(`login-${id}`, platform, kind, op),
          })
          credential = await exchangeAliyunCode(http, credential, code)
        }
        cookie = JSON.stringify(credential)
      } else
        cookie = await this.options.login(platform, async (credential) => {
          let candidate = credential
          const http = new CloudHttp({
            platform,
            cookie: () => candidate,
            merge: async (cookies) => {
              if (platform !== '123')
                candidate = mergeCookies(candidate, cookies)
            },
            diagnostic: (record) => this.recordRequest(record),
          })
          const adapter =
            this.options.adapterFactory?.(platform, http) ??
            (platform === '123'
              ? new Pan123Adapter(http)
              : platform === '115'
                ? new Pan115Adapter(http)
                : platform === 'baidu'
                  ? new BaiduAdapter(http)
                  : new QuarkUcAdapter(platform as 'quark' | 'uc', http))
          await adapter.checkLogin()
          webValidated = true
          return candidate
        })
      await this.options.broker.update(id, () => cookie)
      this.adapters.delete(id)
      if (previousState?.state === 'paused') await this.governor.resume(id)
      if (!existing)
        this.state.accounts.push({
          id,
          platform,
          governor: { day: '', requests: 0, links: 0, transfers: 0 },
          note: '',
          transferOnly: false,
        })
      try {
        if (!webValidated) await this.adapter(platform, id).checkLogin()
      } catch (error) {
        this.adapters.delete(id)
        if (existing && previousCredential) {
          await this.options.broker.update(id, () => previousCredential)
          if (previousState?.reason)
            await this.governor.trip(id, previousState.reason)
        } else {
          this.state.accounts = this.state.accounts.filter((a) => a.id !== id)
          await this.options.broker.remove(id)
        }
        throw error
      }
      const initial = this.governor.snapshot(id, platform)
      const loggedIn = this.state.accounts.find((a) => a.id === id)
      if (loggedIn)
        loggedIn.governor = {
          day: new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Shanghai',
          }),
          requests: initial.requests,
          links: initial.links,
          transfers: initial.transfers,
          recentRiskAt: initial.recentRiskAt ?? undefined,
        }
      if (webValidated && loggedIn)
        loggedIn.health = {
          checkedAt: Date.now(),
          login: 'valid',
          member: null,
          quota: null,
          platformUsedBytes: null,
          expiresAt: null,
        }
      this.authenticating.delete(id)
      if (webValidated && loggedIn?.health) {
        try {
          const adapter = this.adapter(platform, id)
          const quota = await adapter.quota()
          if (quota.total > 0) loggedIn.health.quota = quota
          if (adapter.health)
            Object.assign(loggedIn.health, await adapter.health())
        } catch {
          /* A capacity endpoint cannot invalidate a verified login. */
        }
      } else await this.checkHealth(id)
      if (webValidated && loggedIn) await this.refreshProfile(loggedIn)
      this.needsLocalLogin.delete(id)
      await this.persist()
      return this.snapshot()
    } catch (error) {
      if (
        existing &&
        ['login', 'login-elsewhere'].includes(previousState?.reason ?? '') &&
        this.governor.snapshot(id, platform).state === 'ready'
      )
        await this.governor.trip(id, previousState?.reason ?? 'login')
      throw error
    } finally {
      this.authenticating.delete(id)
    }
  }
  async confirmAccount(raw: unknown) {
    const id = z.string().parse(raw)
    this.account(id)
    await this.governor.resume(id)
    return this.snapshot()
  }
  async logout(raw: unknown) {
    const id = z.string().parse(raw)
    const account = this.account(id)
    await removeAvatar(this.avatarDirectory, account?.profile?.avatarPath)
    this.avatarData.delete(id)
    this.needsLocalLogin.delete(id)
    this.profileDiagnostics.delete(id)
    for (const binding of this.state.bindings.filter((b) => b.accountId === id))
      await this.block(binding, 'login')
    await this.options.broker.remove(id)
    this.state.accounts = this.state.accounts.filter((a) => a.id !== id)
    this.adapters.delete(id)
    await this.persist()
    return this.snapshot()
  }
  private context(value: Context) {
    if (this.contexts.size >= 50)
      this.contexts.delete(this.contexts.keys().next().value ?? '')
    const contextId = randomUUID()
    this.contexts.set(contextId, value)
    return {
      contextId,
      platform: value.platform,
      accountId: value.accountId,
      title: value.session?.title ?? '',
      shareRef: value.session ? contextId : undefined,
      files: value.files.map(({ token: _token, ...file }) => file),
      capabilities: value.adapter.capabilities,
    }
  }
  private automaticAccounts(
    platform: CloudPlatform,
    method: import('@shared/schemas/nexus-cloud').CloudMethod
  ) {
    return this.state.accounts
      .filter(
        (a) =>
          a.platform === platform &&
          (platform !== 'aliyun' ||
            (aliyunCredentialSchema.parse(
              JSON.parse(this.options.broker.get(a.id))
            ).mode ===
              'share') ===
              (method === 'without-save'))
      )
      .filter(
        (a) => method !== 'own' || this.adapter(platform, a.id).capabilities.own
      )
      .map((a) => this.accountView(a))
  }
  private automaticId(
    platform: CloudPlatform,
    method: import('@shared/schemas/nexus-cloud').CloudMethod,
    optional = false
  ) {
    const accounts = this.automaticAccounts(platform, method)
    if (!accounts.length && optional) return undefined
    return chooseCloudAccount(accounts, method).id
  }
  private async selectForBatch(
    ctx: Context,
    method: import('@shared/schemas/nexus-cloud').CloudMethod,
    required: number,
    files: { file: AdapterFile; parents: string[] }[]
  ) {
    let candidates = this.automaticAccounts(ctx.platform, method)
    if (method === 'save') {
      const dedicated = candidates.find((a) => a.transferOnly)
      if (dedicated) {
        chooseCloudAccount([dedicated], method, required, files.length)
        candidates = [dedicated]
      }
      const checked: typeof candidates = []
      for (const candidate of candidates) {
        if (
          candidate.state === 'paused' ||
          candidate.health?.login === 'expired'
        )
          continue
        try {
          const quota = await this.adapter(ctx.platform, candidate.id).quota()
          checked.push({
            ...candidate,
            health: {
              checkedAt: 0,
              login: 'unknown',
              member: null,
              platformUsedBytes: null,
              expiresAt: null,
              ...candidate.health,
              quota,
            },
          })
        } catch (error) {
          if (
            dedicated ||
            (error instanceof CloudError &&
              ['risk', 'captcha', 'rate', 'login'].includes(error.kind))
          )
            throw error
        }
      }
      candidates = checked
    }
    const chosen = chooseCloudAccount(
      candidates,
      method,
      required,
      files.length
    )
    if (chosen.id === ctx.accountId) return
    if (!ctx.session?.input) throw new CloudError('expired-share')
    const adapter = this.adapter(ctx.platform, chosen.id)
    const session = await adapter.createSession(ctx.session.input)
    session.input = ctx.session.input
    const directories = new Map<string, AdapterFile[]>()
    for (const selected of files) {
      let listing = directories.get(selected.file.parent)
      if (!listing) {
        listing = await adapter.listFiles(selected.file.parent, session)
        directories.set(selected.file.parent, listing)
      }
      const fresh = listing.find((f) => f.id === selected.file.id)
      if (
        !fresh ||
        fresh.name !== selected.file.name ||
        fresh.bytes !== selected.file.bytes ||
        (selected.file.hash && selected.file.hash !== fresh.hash)
      )
        throw new CloudError('identity')
      Object.assign(selected.file, fresh)
    }
    ctx.accountId = chosen.id
    ctx.adapter = adapter
    ctx.session = session
  }
  async browse(raw: unknown) {
    const req = cloudBrowseRequestSchema.parse(raw)
    const previous = req.shareRef ? this.contexts.get(req.shareRef) : undefined
    if (
      req.shareRef &&
      (!previous?.session ||
        previous.platform !== req.platform ||
        (!!req.accountId && previous.accountId !== req.accountId))
    )
      throw new CloudError('expired-share')
    if (!previous?.session && !req.accountId)
      req.accountId = this.automaticId(req.platform, 'own')
    if (!previous?.session && !req.accountId) throw new CloudError('login')
    const adapter =
      previous?.adapter ?? this.adapter(req.platform, req.accountId)
    req.accountId = previous?.accountId ?? req.accountId
    const files = await adapter.listFiles(req.directory, previous?.session)
    return this.context({
      platform: req.platform,
      accountId: req.accountId,
      session: previous?.session,
      automatic: previous?.automatic,
      files,
      adapter,
    })
  }
  async openShare(raw: unknown) {
    const req = cloudOpenShareSchema.parse(raw)
    const automatic = !req.accountId
    req.accountId ??= this.automaticId(
      req.platform,
      req.platform === 'baidu' ? 'save' : 'without-save',
      true
    )
    const adapter = this.adapter(req.platform, req.accountId)
    const session = await adapter.createSession(req.input)
    session.input = req.input
    const files = await adapter.listFiles('0', session)
    return this.context({
      platform: req.platform,
      accountId: req.accountId,
      session,
      files,
      adapter,
      automatic,
    })
  }
  private async selection(raw: unknown) {
    const req = cloudSelectionSchema.parse(raw)
    const ctx = this.contexts.get(req.contextId)
    if (!ctx) throw new CloudError('expired-share')
    if (
      req.method === 'guest' ? !ctx.adapter.capabilities.guest : !ctx.accountId
    )
      throw new CloudError('login')
    if (
      (!ctx.session && req.method !== 'own') ||
      (ctx.session && req.method === 'own') ||
      (req.method === 'without-save' && !ctx.adapter.capabilities.withoutSave)
    )
      throw new CloudError('unsupported')
    if (req.method === 'save' && !ctx.adapter.capabilities.save)
      throw new CloudError('unsupported')
    const selected = ctx.files.filter((f) => req.ids.includes(f.id))
    if (selected.length !== req.ids.length) throw new CloudError('identity')
    const files: { file: AdapterFile; parents: string[] }[] = []
    const visited = new Set<string>()
    const walk = async (
      file: AdapterFile,
      parents: string[],
      depth: number
    ): Promise<void> => {
      if (visited.has(file.id)) return
      if (files.length >= 200 || depth > 32) throw new CloudError('unsupported')
      visited.add(file.id)
      safeCloudName(file.name)
      if (file.directory)
        for (const child of await ctx.adapter.listFiles(
          ctx.platform === 'baidu' ? file.path : file.id,
          ctx.session
        ))
          await walk(child, [...parents, file.name], depth + 1)
      else files.push({ file, parents })
    }
    for (const file of selected) await walk(file, [], 0)
    if (!files.length) throw new CloudError('unsupported')
    const outputs = new Set<string>()
    for (const f of files) {
      const output = [...f.parents, f.file.name]
        .join('/')
        .toLocaleLowerCase('en-US')
      if (outputs.has(output)) throw new CloudError('path')
      outputs.add(output)
    }
    return { req, ctx, files }
  }
  async preflight(raw: unknown): Promise<CloudPreflight> {
    const { req, ctx, files } = await this.selection(raw)
    const duplicates = []
    const tasks = this.options.tasks.getAll()
    for (const { file, parents } of files) {
      if (this.options.duplicateWarning?.() === false) continue
      // Reuse the existing path admission gate before examining any local target.
      await prepareCloudDirectory(req.directory, parents)
      const match = await this.findDuplicate(
        ctx.platform,
        file,
        parents,
        req.directory,
        tasks
      )
      if (match)
        duplicates.push({
          id: file.id,
          name: [...parents, file.name].join('/'),
          ...match,
        })
    }
    const skippedIds = new Set(
      req.skipExisting ? duplicates.map((d) => d.id) : []
    )
    const pending = files.filter((f) => !skippedIds.has(f.file.id))
    const knownBytes = pending.reduce((sum, f) => sum + (f.file.bytes ?? 0), 0)
    const unknown = pending.filter((f) => f.file.bytes === null).length
    if (
      pending.length &&
      ctx.automatic &&
      ctx.session &&
      req.method !== 'guest'
    )
      await this.selectForBatch(ctx, req.method, knownBytes, pending)
    const disks = [getNexusDiskSpace(req.directory)]
    const quota =
      pending.length && req.method === 'save' ? await ctx.adapter.quota() : null
    const spaceEnough =
      !quota || (!unknown && quota.total - quota.used >= knownBytes)
    const record = this.account(ctx.accountId)
    const account = record ? this.accountView(record) : null
    const diskEnough =
      !pending.length ||
      (disks[0].freeBytes !== null &&
        disks[0].freeBytes >= knownBytes + 64 * 1024 * 1024)
    const transferEnough =
      req.method !== 'save' ||
      (!!account && account.transferLimit - account.transfers >= pending.length)
    return {
      count: files.length,
      downloadCount: pending.length,
      duplicates,
      skipped: skippedIds.size,
      knownBytes,
      unknown,
      disk: disks[0],
      quota,
      spaceEnough,
      diskEnough,
      transferEnough,
      account,
      method: req.method,
      etaSeconds:
        this.options.profiles?.estimate(
          {
            platform: ctx.platform,
            accountId: ctx.accountId ?? null,
            method: req.method,
          },
          knownBytes,
          unknown
        ).seconds ?? null,
      speedBps:
        this.options.profiles?.estimate(
          {
            platform: ctx.platform,
            accountId: ctx.accountId ?? null,
            method: req.method,
          },
          knownBytes,
          unknown
        ).profile?.averageBps ?? null,
      successRate:
        this.options.profiles?.estimate(
          {
            platform: ctx.platform,
            accountId: ctx.accountId ?? null,
            method: req.method,
          },
          knownBytes,
          unknown
        ).profile?.successRate ?? null,
      blocked:
        !Number.isSafeInteger(knownBytes) ||
        unknown > 0 ||
        !spaceEnough ||
        !diskEnough ||
        !transferEnough ||
        account?.state === 'paused',
      files: files.map((f) => ({
        name: [...f.parents, f.file.name].join('/'),
        bytes: f.file.bytes,
      })),
    }
  }
  isSubmitting() {
    return this.downloading
  }
  private async findDuplicate(
    platform: CloudPlatform,
    file: AdapterFile,
    parents: string[],
    directory: string,
    tasks: DownloadTask[]
  ) {
    const bindings = this.state.bindings.filter(
      (binding) => binding.platform === platform && binding.file.id === file.id
    )
    for (const binding of bindings) {
      const duplicate = await duplicateTask(
        tasks.find((task) => task.id === binding.taskId)
      )
      if (duplicate) return { path: '', basis: 'source', ...duplicate }
    }
    // A deleted output must be downloadable again even if a similarly named file exists elsewhere.
    if (bindings.length) return null
    return this.existingFiles.find(file, parents, directory, tasks)
  }
  async download(raw: unknown) {
    if (this.downloading) throw new CloudError('rate')
    this.downloading = true
    try {
      return await this.downloadBatch(raw)
    } finally {
      this.downloading = false
    }
  }
  private async downloadBatch(raw: unknown) {
    if (!this.create) throw new CloudError('unsupported')
    const checked = await this.preflight(raw)
    if (checked.blocked)
      throw new CloudError(
        checked.account?.reason ??
          (!checked.transferEnough
            ? 'rate'
            : checked.unknown
              ? 'size'
              : 'space')
      )
    const { req, ctx, files } = await this.selection(raw)
    const ids: string[] = []
    const preflightSkipped = new Set(
      req.skipExisting ? checked.duplicates.map((d) => d.id) : []
    )
    let skipped = 0
    for (const { file, parents } of files) {
      // Recheck immediately before link/transfer side effects; disk state can change after preflight.
      if (
        preflightSkipped.has(file.id) ||
        (req.skipExisting &&
          this.options.duplicateWarning?.() !== false &&
          (await this.findDuplicate(
            ctx.platform,
            file,
            parents,
            req.directory,
            this.options.tasks.getAll()
          )))
      ) {
        skipped++
        continue
      }
      const key = `${req.contextId}:${req.method}:${file.id}:${path.resolve(req.directory)}`
      const submitted = this.submitted.get(key)
      if (submitted) {
        this.submitted.delete(key)
        this.transfers.delete(key)
      }
      const saveDir = await prepareCloudDirectory(req.directory, parents)
      let tempDir: string | undefined
      let savedId: string | undefined
      if (req.method === 'save') {
        if (!ctx.accountId || !ctx.session) throw new CloudError('login')
        const prepared = this.transfers.get(key)
        if (prepared) {
          savedId = prepared.savedId
          tempDir = prepared.tempDir
        } else {
          tempDir = await ctx.adapter.ensureTempDir(
            `NexusDownload_tr_${randomUUID()}`
          )
          this.state.orphans.push({
            accountId: ctx.accountId,
            directory: tempDir,
          })
          await this.persist()
          savedId = await ctx.adapter.transferFile(ctx.session, file, tempDir)
          this.transfers.set(key, { savedId, tempDir })
        }
      }
      const resource = await ctx.adapter.getDownloadLink(
        file,
        req.method,
        ctx.session,
        savedId
      )
      verifyResource(file, resource)
      if (resource.kind === 'playback-stream' && !req.allowPlayback)
        throw new CloudError('playback')
      if (resource.mediaType === 'hls') {
        if (!this.options.media) throw new CloudError('unsupported')
        const result = await this.options.media(
          resource,
          saveDir,
          safeCloudName(`${path.parse(file.name).name}.在线播放版本.mp4`)
        )
        this.submitted.set(key, result.taskId)
        ids.push(result.taskId)
        continue
      }
      const holder: { binding?: Binding } = {}
      const uri = this.relay.issue(
        resource,
        resource.kind === 'original-file' ? file.bytes : null,
        (kind, status) => {
          if (holder.binding)
            void this.failure(holder.binding, kind, status).catch(
              () => undefined
            )
        },
        (operation) =>
          this.requestResource(ctx.platform, ctx.accountId, resource, operation)
      )
      const result = await this.create({
        type: 'http',
        uris: [uri],
        saveDir,
        filename: safeCloudName(
          resource.kind === 'playback-stream'
            ? `${path.parse(file.name).name}.在线播放版本.mp4`
            : file.name
        ),
        connections: 1,
        headers: [],
      })
      if (result.outcome !== 'created') {
        this.relay.revoke(uri)
        throw new CloudError('path')
      }
      const task = this.options.tasks.getById(result.taskId)
      if (!task) throw new CloudError('identity')
      const {
        url: _url,
        headers: _headers,
        expiresAt: _expiry,
        ...meta
      } = resource
      const binding: Binding = {
        taskId: task.id,
        gid: task.engineTaskId,
        output: task.diskPath,
        root: req.directory,
        parents,
        platform: ctx.platform,
        accountId: ctx.accountId,
        file,
        method: req.method,
        session: ctx.session,
        savedId,
        tempDir,
        meta,
        phase: 'ready',
        cleanup: 'retained',
      }
      holder.binding = binding
      this.state.bindings.push(binding)
      await this.options.profiles?.begin(task.id, {
        platform: ctx.platform,
        accountId: ctx.accountId ?? null,
        method: req.method,
      })
      if (tempDir)
        this.state.orphans = this.state.orphans.filter(
          (o) => o.directory !== tempDir
        )
      this.leases.set(task.id, this.lease(uri, resource))
      await this.persist()
      this.submitted.set(key, task.id)
      if (!this.options.enqueue)
        await this.options.engine.resumeTask(binding.gid)
      ids.push(task.id)
    }
    if (ids.length > 1)
      await this.options.group?.(
        ctx.session?.title || '分享目录',
        ids,
        req.directory,
        [
          ctx.session?.title,
          ctx.session?.extra?.description,
          ctx.session?.extra?.pageText,
        ]
          .filter(Boolean)
          .join('\n')
      )
    await this.options.enqueue?.(ids)
    return { taskIds: ids, skipped }
  }
  private async block(binding: Binding, reason: CloudErrorKind) {
    binding.phase = 'blocked'
    binding.reason = reason
    const lease = this.leases.get(binding.taskId)
    if (lease) this.relay.revoke(lease.uri)
    this.leases.delete(binding.taskId)
    await this.options.engine.pauseTask(binding.gid).catch(() => undefined)
    const task = this.options.tasks.getById(binding.taskId)
    if (
      task &&
      ![TaskStatus.Completed, TaskStatus.Removed].includes(task.status)
    ) {
      task.status = TaskStatus.Paused
      task.errorMessage = `cloud.${reason}`
      task.errorDetailKey = `nexus.cloudError.${reason}`
      for (const instance of task.instances) instance.status = TaskStatus.Paused
      this.options.tasks.set(task.id, task)
      await this.options.persistTask(task)
    }
    await this.persist()
  }
  private async failure(
    binding: Binding,
    kind: CloudErrorKind,
    status: number
  ) {
    if (this.pending.has(binding.taskId)) return
    const lease = this.leases.get(binding.taskId)
    const last = this.failedRenewals.get(binding.taskId)
    const bytes =
      this.options.tasks.getById(binding.taskId)?.downloadedBytes ?? 0
    if (
      [403, 412].includes(status) &&
      lease &&
      (!last ||
        (Date.now() - last.at > 60000 && bytes > last.bytes + 1024 * 1024))
    ) {
      // Another ambiguous failure needs both elapsed time and proven forward progress.
      this.failedRenewals.set(binding.taskId, { at: Date.now(), bytes })
      await this.resume(binding.taskId)
    } else if (status === 429) {
      await this.governor.trip(
        binding.accountId ?? `guest-${binding.platform}`,
        'rate'
      )
    } else await this.block(binding, kind)
  }
  hasTask(id: string) {
    return this.state.bindings.some((b) => b.taskId === id)
  }
  async resume(id: string) {
    const existing = this.pending.get(id)
    if (existing) return existing
    const binding = this.state.bindings.find((b) => b.taskId === id)
    if (!binding) return
    const taskState = this.options.tasks.getById(id)
    if (
      !taskState ||
      [
        TaskStatus.Completed,
        TaskStatus.Removed,
        TaskStatus.Finalizing,
      ].includes(taskState.status)
    )
      return
    const operation = this.options.mutate([id], async () => {
      try {
        if (
          this.governor.snapshot(
            binding.accountId ?? `guest-${binding.platform}`,
            binding.platform
          ).state === 'paused'
        )
          throw new CloudError(
            this.governor.snapshot(
              binding.accountId ?? `guest-${binding.platform}`,
              binding.platform
            ).reason ?? 'risk'
          )
        const adapter = this.adapter(binding.platform, binding.accountId)
        const lease = this.leases.get(id)
        if (lease) this.relay.revoke(lease.uri)
        const resource = await renewDownload({
          engine: this.options.engine,
          binding,
          validateOutput: async () => {
            const dir = await prepareCloudDirectory(
              binding.root,
              binding.parents
            )
            if (
              path.resolve(path.dirname(binding.output)) !== path.resolve(dir)
            )
              throw new CloudError('path')
          },
          persist: async (phase) => {
            binding.phase = phase
            await this.persist()
          },
          resolve: async () => {
            if (binding.session?.input) {
              const fresh = await adapter.createSession(binding.session.input)
              fresh.input = binding.session.input
              binding.session = fresh
            }
            const files = await adapter.listFiles(
              binding.file.parent,
              binding.session
            )
            const file = files.find((f) => f.id === binding.file.id)
            if (!file) throw new CloudError('identity')
            if (file.bytes !== binding.file.bytes)
              throw new CloudError('identity')
            if (binding.savedId && binding.tempDir)
              await adapter.restoreTransfer?.(binding.savedId, binding.tempDir)
            const next = await adapter.renew(
              file,
              binding.method,
              binding.session,
              binding.savedId
            )
            verifyResource(file, next, {
              ...binding.meta,
              url: '',
              headers: {},
            })
            const uri = this.relay.issue(
              next,
              binding.file.bytes,
              (kind, status) => {
                void this.failure(binding, kind, status).catch(() => undefined)
              },
              (operation) =>
                this.requestResource(
                  binding.platform,
                  binding.accountId,
                  next,
                  operation
                )
            )
            this.leases.set(id, this.lease(uri, next))
            return { resource: next, uri }
          },
        })
        binding.meta = {
          fileId: resource.fileId,
          bytes: resource.bytes,
          kind: resource.kind,
          version: resource.version,
          hash: resource.hash,
        }
        delete binding.reason
        const task = this.options.tasks.getById(id)
        if (task) {
          task.status = TaskStatus.Downloading
          task.errorMessage = null
          task.errorDetailKey = null
          task.uris = [this.leases.get(id)?.uri ?? '']
          for (const instance of task.instances) {
            instance.status = TaskStatus.Downloading
            instance.uris = [...task.uris]
          }
          this.options.tasks.set(id, task)
          await this.options.persistTask(task)
        }
        await this.persist()
      } catch (error) {
        await this.block(
          binding,
          error instanceof CloudError ? error.kind : 'network'
        )
        throw error
      }
    })
    this.pending.set(id, operation)
    try {
      await operation
    } finally {
      this.pending.delete(id)
    }
  }
  async tick() {
    for (const binding of this.state.bindings) {
      const task = this.options.tasks.getById(binding.taskId)
      if (
        !task ||
        task.status === TaskStatus.Removed ||
        task.status === TaskStatus.Completed
      ) {
        const lease = this.leases.get(binding.taskId)
        if (lease) {
          this.relay.revoke(lease.uri)
          this.leases.delete(binding.taskId)
        }
        if (
          binding.tempDir &&
          binding.accountId &&
          binding.cleanup === 'retained' &&
          !this.pending.has(binding.taskId)
        ) {
          // Never delete unknown account objects; only the exact task-owned directory.
          try {
            binding.cleanup = 'pending'
            await this.persist()
            await this.adapter(
              binding.platform,
              binding.accountId
            ).cleanupTempDir(binding.tempDir)
            binding.cleanup = 'complete'
            await this.persist()
          } catch {
            if (
              !this.state.orphans.some(
                (o) =>
                  o.accountId === binding.accountId &&
                  o.directory === binding.tempDir
              )
            )
              this.state.orphans.push({
                accountId: binding.accountId,
                directory: binding.tempDir,
              })
            await this.persist()
          }
        }
        continue
      }
      if (binding.phase === 'blocked' || this.pending.has(binding.taskId))
        continue
      if (task.status === TaskStatus.Paused) continue
      const lease = this.leases.get(binding.taskId)
      if (!lease) {
        await this.block(binding, 'checkpoint')
        continue
      }
      if (
        task.status === TaskStatus.Downloading &&
        lease.renewAt &&
        lease.renewAt <= Date.now()
      )
        void this.resume(binding.taskId).catch(() => undefined)
    }
  }
  async recover() {
    for (const binding of this.state.bindings) {
      const task = this.options.tasks.getById(binding.taskId)
      if (
        !task ||
        [TaskStatus.Completed, TaskStatus.Removed].includes(task.status)
      )
        continue
      if (binding.reason) {
        await this.block(binding, binding.reason)
        continue
      }
      if (task.status === TaskStatus.Paused) {
        await this.options.engine.pauseTask(binding.gid).catch(() => undefined)
        binding.phase = 'ready'
        await this.persist()
        continue
      }
      await this.resume(binding.taskId).catch(() => undefined)
    }
    if (this.available && this.state.accounts.length) await this.scanOrphans()
  }
  async scanOrphans() {
    for (const account of this.state.accounts) {
      if (
        this.governor.snapshot(account.id, account.platform).state === 'paused'
      )
        continue
      try {
        const files = await this.adapter(
          account.platform,
          account.id
        ).listFiles('0')
        for (const file of files.filter(
          (f) => f.directory && f.name.startsWith('NexusDownload_tr_')
        )) {
          const directory = account.platform === 'baidu' ? file.path : file.id
          if (
            !this.state.bindings.some(
              (b) => b.accountId === account.id && b.tempDir === directory
            ) &&
            !this.state.orphans.some(
              (o) => o.accountId === account.id && o.directory === directory
            )
          )
            this.state.orphans.push({ accountId: account.id, directory })
        }
      } catch {
        /* Self-check exposes any account error; scanning does not guess. */
      }
    }
    await this.persist()
  }
  async cleanupOrphan(raw: unknown) {
    const req = z
      .object({ accountId: z.string(), directory: z.string() })
      .strict()
      .parse(raw)
    if (
      !this.state.orphans.some(
        (o) => o.accountId === req.accountId && o.directory === req.directory
      )
    )
      throw new CloudError('identity')
    const account = this.account(req.accountId)
    if (!account) throw new CloudError('login')
    const adapter = this.adapter(account.platform, account.id)
    if (account.platform === '115')
      await adapter.restoreTransfer?.('', req.directory)
    await adapter.cleanupTempDir(req.directory)
    this.state.orphans = this.state.orphans.filter(
      (o) => o.accountId !== req.accountId || o.directory !== req.directory
    )
    for (const binding of this.state.bindings)
      if (
        binding.accountId === req.accountId &&
        binding.tempDir === req.directory
      )
        binding.cleanup = 'complete'
    await this.persist()
  }
  async selfCheck(raw: unknown): Promise<unknown> {
    const req = cloudSelfCheckSchema.parse(raw)
    const key = JSON.stringify(req)
    if (this.checking) {
      if (this.checkingKey === key) return this.checking
      await this.checking.catch(() => undefined)
      return this.selfCheck(raw)
    }
    this.checkingKey = key
    this.checking = this.runSelfCheck(raw)
    try {
      return await this.checking
    } finally {
      this.checking = undefined
    }
  }
  private async runSelfCheck(raw: unknown) {
    const { accountId: id, shareInput } = cloudSelfCheckSchema.parse(raw)
    if (id) this.account(id)
    const accounts = this.state.accounts.filter((a) => !id || a.id === id)
    const reports: {
      platform: CloudPlatform
      account: number
      steps: { step: string; status: string; error?: CloudErrorKind }[]
    }[] = []
    for (const account of accounts) {
      const steps: { step: string; status: string; error?: CloudErrorKind }[] =
        []
      const report = {
        platform: account.platform,
        account: this.state.accounts.indexOf(account) + 1,
        steps,
      }
      reports.push(report)
      let step = 'login'
      try {
        const adapter = this.adapter(account.platform, account.id)
        await adapter.checkLogin()
        account.health = {
          checkedAt: Date.now(),
          login: 'valid',
          member: account.health?.member ?? null,
          quota: account.health?.quota ?? null,
          platformUsedBytes: account.health?.platformUsedBytes ?? null,
          expiresAt: account.health?.expiresAt ?? null,
        }
        steps.push({ step, status: 'pass' })
        // The account action refreshes capacity as well as the login state.
        try {
          const quota = await adapter.quota()
          if (
            Number.isSafeInteger(quota.total) &&
            quota.total > 0 &&
            Number.isSafeInteger(quota.used) &&
            quota.used >= 0
          )
            account.health.quota = quota
          steps.push({
            step: 'quota',
            status: account.health.quota ? 'pass' : 'fail',
          })
        } catch (error) {
          steps.push({
            step: 'quota',
            status: 'fail',
            error: error instanceof CloudError ? error.kind : 'network',
          })
        }
        if (!shareInput && !adapter.capabilities.own) {
          for (const step of ['list', 'link', 'range'])
            steps.push({ step, status: 'skipped-needs-share-link' })
          continue
        }
        step = 'list'
        const session = shareInput
          ? await adapter.createSession(shareInput)
          : undefined
        const files = await adapter.listFiles('0', session)
        steps.push({ step, status: 'pass' })
        const file = files
          .filter(
            (f) =>
              !f.directory &&
              f.bytes !== null &&
              f.bytes > 0 &&
              f.bytes <= 20 * 1024 * 1024
          )
          .sort((a, b) => (a.bytes ?? 0) - (b.bytes ?? 0))[0]
        if (!file) {
          steps.push(
            { step: 'link', status: 'skipped-no-small-root-file' },
            { step: 'range', status: 'skipped' }
          )
          continue
        }
        if (session && !adapter.capabilities.withoutSave) {
          steps.push(
            { step: 'link', status: 'skipped-no-direct-share-route' },
            { step: 'range', status: 'skipped' }
          )
          continue
        }
        step = 'link'
        const resource = await adapter.getDownloadLink(
          file,
          session ? 'without-save' : 'own',
          session
        )
        verifyResource(file, resource)
        if (resource.kind !== 'original-file') throw new CloudError('playback')
        steps.push({ step, status: 'pass' })
        step = 'range'
        const uri = this.relay.issue(
          resource,
          file.bytes,
          () => undefined,
          (operation) =>
            this.requestResource(
              account.platform,
              account.id,
              resource,
              operation
            )
        )
        try {
          const response = await fetch(uri, {
            headers: { Range: 'bytes=0-0' },
            signal: AbortSignal.timeout(30000),
          })
          let valid =
            response.status === 206 &&
            response.headers.get('Content-Range') === `bytes 0-0/${file.bytes}`
          if (valid) valid = (await response.arrayBuffer()).byteLength === 1
          else await response.body?.cancel()
          if (!valid) throw new CloudError('size')
        } finally {
          this.relay.revoke(uri)
        }
        steps.push({ step, status: 'pass' })
      } catch (error) {
        account.health = {
          checkedAt: Date.now(),
          login:
            error instanceof CloudError &&
            ['login', 'login-elsewhere'].includes(error.kind)
              ? 'expired'
              : 'error',
          member: account.health?.member ?? null,
          quota: account.health?.quota ?? null,
          platformUsedBytes: account.health?.platformUsedBytes ?? null,
          expiresAt: account.health?.expiresAt ?? null,
        }
        steps.push({
          step,
          status: 'fail',
          error: error instanceof CloudError ? error.kind : 'network',
        })
        for (const remaining of ['login', 'list', 'link', 'range'])
          if (!steps.some((s) => s.step === remaining))
            steps.push({ step: remaining, status: 'skipped' })
      } finally {
        await this.persist()
      }
    }
    return {
      product: 'NexusDownload',
      version: NEXUS_VERSION,
      at: new Date().toISOString(),
      reports,
      profiles: this.state.accounts.map((account) => {
        const result = this.profileDiagnostics.get(account.id)
        return {
          platform: account.platform,
          nickname: result?.nickname ?? !!account.profile?.nickname,
          avatar: result?.avatar ?? !!this.avatarData.get(account.id),
          fields:
            result && (!result.nickname || !result.avatar) ? result.fields : [],
        }
      }),
      requests: this.options.diagnosticsEnabled?.()
        ? this.recentRequests.slice(-20)
        : [],
    }
  }
  async kouling(raw: unknown) {
    const req = z
      .object({
        input: z.string().min(1).max(120),
        consent: z.boolean(),
        serviceKey: z.string().max(1024).optional(),
      })
      .strict()
      .parse(raw)
    if (!req.consent) throw new CloudError('permission')
    if (req.serviceKey !== undefined)
      await this.options.broker.update(
        'starsea-key',
        () => req.serviceKey ?? ''
      )
    this.state.koulingEnabled = true
    await this.persist()
    return {
      url: await resolveKouling(
        req.input,
        this.options.broker.get('starsea-key')
      ),
    }
  }
  async stop() {
    this.stopping = true
    clearInterval(this.healthTimer)
    await this.healthPending?.catch(() => undefined)
    await Promise.allSettled([...this.pending.values()])
    await this.relay.stop()
    await this.options.broker.drain()
  }
}
