import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { EngineAdapter } from '@core/engine/engine-adapter'
import { TaskManager } from '@core/task/task-manager'
import type { CloudPlatform } from '@shared/schemas/nexus-cloud'
import { TaskStatus } from '@shared/types/task'
import { makeDownloadTask } from '@test-utils/task'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchedProfile } from './account-profile'
import type { CloudAdapter } from './cloud-adapter'
import { CloudError } from './cloud-adapter'
import type { CloudHttp } from './cloud-http'
import { CloudRuntime } from './cloud-runtime'
import { CredentialBroker } from './credential-broker'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
describe('cloud runtime safety boundaries', () => {
  async function fixture(
    platform: CloudPlatform = 'quark',
    shareOnly = false,
    webValidation = false,
    fetchProfile?: () => Promise<FetchedProfile>
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-runtime-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const secret = randomBytes(24).toString('hex')
    const mask = randomBytes(32)
    const transform = (b: Buffer) =>
      Buffer.from(b.map((v, i) => v ^ mask[i % mask.length]))
    const broker = new CredentialBroker(path.join(root, 'vault.bin'), {
      available: async () => true,
      encrypt: async (s) => transform(Buffer.from(s)),
      decrypt: async (b) => transform(b).toString(),
    })
    const tasks = new TaskManager()
    const engine = {
      pauseTask: vi.fn(async () => undefined),
      resumeTask: vi.fn(async () => undefined),
    } as unknown as EngineAdapter
    const files = [
      {
        id: 'f1',
        parent: '0',
        name: 'first.bin',
        path: 'first.bin',
        directory: false,
        bytes: 5,
        version: 'v1',
      },
      {
        id: 'f2',
        parent: '0',
        name: 'second.bin',
        path: 'second.bin',
        directory: false,
        bytes: 5,
        version: 'v1',
      },
    ]
    let url = 'https://unreachable.invalid/'
    const adapter = {
      platform: 'quark',
      capabilities: {
        own: true,
        save: true,
        guest: true,
        withoutSave: true,
        playback: false,
      },
      checkLogin: vi.fn(async () => undefined),
      fetchProfile,
      listFiles: vi.fn(async () => files),
      getDownloadLink: async (file: (typeof files)[number]) => ({
        fileId: file.id,
        bytes: 5,
        kind: 'original-file',
        version: 'v1',
        url,
        headers: { Cookie: secret },
      }),
    } as unknown as CloudAdapter
    let httpClient: CloudHttp | undefined
    const runtime = new CloudRuntime({
      broker,
      engine,
      tasks,
      persistTask: async () => undefined,
      changed: () => undefined,
      login: async (_platform, validate) =>
        webValidation ? validate(secret) : secret,
      diagnosticsEnabled: () => true,
      mutate: async (_ids, fn) => fn(),
      adapterFactory: (_platform, http) => {
        httpClient = http
        return adapter
      },
    })
    if (platform !== 'quark') {
      await broker.load()
      await broker.update('account-test', () =>
        platform === 'aliyun'
          ? JSON.stringify({
              mode: shareOnly ? 'share' : 'official',
              refreshToken: secret,
            })
          : secret
      )
      await broker.update('cloud-state', () =>
        JSON.stringify({
          version: 1,
          accounts: [
            {
              id: 'account-test',
              platform,
              governor: { day: '', requests: 0, links: 0, transfers: 0 },
            },
          ],
          bindings: [],
        })
      )
    }
    await runtime.start()
    cleanups.push(() => runtime.stop())
    if (platform === 'quark') await runtime.login('quark')
    const account = runtime.snapshot().accounts[0]
    let count = 0
    runtime.setCreate(async (req) => {
      count++
      const task = makeDownloadTask({
        id: `t${count}`,
        engineTaskId: `gid${count}`,
        status: TaskStatus.Paused,
        diskPath: path.join(
          root,
          req.type === 'http' ? (req.filename ?? 'file') : 'file'
        ),
        instances: [],
      })
      tasks.set(task.id, task)
      return { outcome: 'created', taskId: task.id, gid: task.engineTaskId }
    })
    const ctx = await runtime.browse({
      platform,
      accountId: account.id,
    })
    const selection = {
      contextId: ctx.contextId,
      ids: files.map((f) => f.id),
      method: 'own',
      directory: root,
    }
    return {
      runtime,
      engine,
      tasks,
      account,
      adapter,
      broker,
      root,
      secret,
      selection,
      getHttp: () => httpClient,
      setUrl: (value: string) => {
        url = value
      },
    }
  }
  it('refreshes nickname during health checks, caches an avatar once daily and removes it on logout', async () => {
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const request = vi.fn(async () => new Response(image))
    vi.stubGlobal('fetch', request)
    try {
      const profile = vi.fn(async () => ({
        nickname: 'Test User',
        avatar: 'https://avatar.example/image',
        fields: ['data.nickname', 'data.avatar'],
      }))
      const f = await fixture('quark', false, false, profile)
      const account = f.runtime.snapshot().accounts[0]
      expect(account.profile?.nickname).toBe('Test User')
      expect(account.avatarData).toMatch(/^data:image\/png;base64,/)
      await f.runtime.checkHealth(account.id, true)
      expect(profile.mock.calls.length).toBeGreaterThan(1)
      expect(request).toHaveBeenCalledOnce()
      const avatar = account.profile?.avatarPath as string
      await f.runtime.logout(account.id)
      expect(f.runtime.snapshot().accounts).toHaveLength(0)
      const { access } = await import('node:fs/promises')
      await expect(access(avatar)).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('saves a web session after one successful probe without a second request that could roll it back', async () => {
    const test = await fixture('quark', false, true)
    expect(test.adapter.checkLogin).toHaveBeenCalledOnce()
    expect(test.runtime.snapshot().accounts[0].health?.login).toBe('valid')
    vi.mocked(test.adapter.checkLogin).mockRejectedValueOnce(
      new CloudError('network')
    )
    await test.runtime.checkHealth(test.account.id)
    expect(test.runtime.snapshot().accounts[0].health?.login).toBe('error')
    expect(test.runtime.snapshot().accounts[0].state).toBe('ready')
  })
  it('keeps the account index when another Windows user cannot decrypt the vault', async () => {
    const f = await fixture()
    await f.runtime.stop()
    const broker = new CredentialBroker(path.join(f.root, 'vault.bin'), {
      available: async () => true,
      encrypt: async (value) => Buffer.from(value),
      decrypt: async () => {
        throw new Error('unavailable on this computer')
      },
    })
    const runtime = new CloudRuntime({
      broker,
      engine: f.engine,
      tasks: f.tasks,
      persistTask: async () => undefined,
      changed: () => undefined,
      login: async () => {
        throw new Error('needs login')
      },
      diagnosticsEnabled: () => true,
      mutate: async (_ids, fn) => fn(),
      adapterFactory: () => f.adapter,
    })
    await runtime.start()
    cleanups.push(() => runtime.stop())
    const account = runtime.snapshot().accounts[0]
    expect(account.id).toBe(f.account.id)
    expect(account.needsLocalLogin).toBe(true)
    expect(account.health?.login).toBe('expired')
  })
  it('appends only the last twenty sanitized request records to the account report', async () => {
    const test = await fixture()
    vi.mocked(test.adapter.listFiles).mockResolvedValueOnce([])
    for (let i = 0; i < 25; i++)
      test
        .getHttp()
        ?.record(
          new URL(
            `https://pan.quark.cn/api/${test.secret}?token=${test.secret}`
          ),
          200,
          { code: i, message: test.secret }
        )
    const report = (await test.runtime.selfCheck(test.account.id)) as {
      requests: { code: number }[]
    }
    expect(report.requests.length).toBe(20)
    expect(report.requests[0].code).toBe(5)
    expect(JSON.stringify(report).includes(test.secret)).toBe(false)
  })
  it('skips existing files before link or task creation and honors an explicit download override', async () => {
    const test = await fixture()
    await writeFile(path.join(test.root, 'first.bin'), 'hello')
    await writeFile(path.join(test.root, 'second.bin'), 'world')
    const check = await test.runtime.preflight(test.selection)
    expect([check.skipped, check.downloadCount]).toEqual([2, 0])
    expect(await test.runtime.download(test.selection)).toEqual({
      taskIds: [],
      skipped: 2,
    })
    expect(test.tasks.getAll()).toHaveLength(0)
    const result = await test.runtime.download({
      ...test.selection,
      skipExisting: false,
    })
    expect(result.taskIds.length).toBe(2)
    expect(result.skipped).toBe(0)
  })
  it('reauthorizes the existing account without resetting its budget or note', async () => {
    const test = await fixture()
    await test.runtime.updateAccount({
      id: test.account.id,
      note: '保留备注',
      transferOnly: false,
    })
    await test.runtime.governor.run(
      test.account.id,
      'quark',
      'transfer',
      async () => {}
    )
    await test.runtime.governor.trip(test.account.id, 'login')
    await test.runtime.login({
      credentials: 'quark',
      accountId: test.account.id,
    })
    const accounts = test.runtime.snapshot().accounts
    expect(accounts.length).toBe(1)
    expect([
      accounts[0].note,
      accounts[0].transfers,
      accounts[0].state,
    ]).toEqual(['保留备注', 1, 'ready'])
    await test.runtime.governor.trip(test.account.id, 'risk')
    await expect(
      test.runtime.login({ credentials: 'quark', accountId: test.account.id })
    ).rejects.toThrow('cloud.risk')
  })
  it('checks on demand, avoids duplicate daily checks, and pauses expired accounts without probing flagged accounts', async () => {
    const test = await fixture()
    await test.runtime.checkHealth()
    const calls = vi.mocked(test.adapter.checkLogin).mock.calls.length
    await test.runtime.checkHealth()
    expect(vi.mocked(test.adapter.checkLogin).mock.calls.length).toBe(calls)
    expect(test.runtime.snapshot().accounts[0].health?.quota).toBeNull()
    vi.mocked(test.adapter.checkLogin).mockRejectedValue(
      new CloudError('login')
    )
    await test.runtime.checkHealth(test.account.id)
    expect(test.runtime.snapshot().accounts[0].health?.login).toBe('expired')
    expect(test.runtime.snapshot().accounts[0].state).toBe('paused')
    vi.mocked(test.adapter.checkLogin).mockClear()
    await test.runtime.checkHealth(test.account.id)
    expect(test.adapter.checkLogin).not.toHaveBeenCalled()
  })
  it('keeps multiple account notes, transfer designation and safety counters isolated', async () => {
    const test = await fixture()
    await test.runtime.login('quark')
    const second = test.runtime.snapshot().accounts[1]
    await test.runtime.updateAccount({
      id: test.account.id,
      note: '主账号',
      transferOnly: true,
    })
    await test.runtime.updateAccount({
      id: second.id,
      note: '转存账号',
      transferOnly: true,
    })
    await test.runtime.governor.run(
      second.id,
      'quark',
      'transfer',
      async () => undefined
    )
    const accounts = test.runtime.snapshot().accounts
    expect(accounts.map((a) => [a.note, a.transferOnly, a.transfers])).toEqual([
      ['主账号', false, 0],
      ['转存账号', true, 1],
    ])
    await test.runtime.governor.trip(second.id, 'risk')
    expect(test.runtime.snapshot().accounts.map((a) => a.state)).toEqual([
      'ready',
      'paused',
    ])
  })
  it('pauses every task of a flagged account and preserves unrelated tasks', async () => {
    const test = await fixture()
    await test.runtime.download(test.selection)
    test.tasks.set(
      'other',
      makeDownloadTask({
        id: 'other',
        engineTaskId: 'other',
        status: TaskStatus.Downloading,
      })
    )
    await test.runtime.governor.trip(test.account.id, 'captcha')
    const snapshot = test.runtime.snapshot()
    expect(snapshot.tasks.length).toBe(2)
    expect(
      snapshot.tasks.every(
        (t) => t.phase === 'blocked' && t.reason === 'captcha'
      )
    ).toBe(true)
    expect(test.tasks.getById('t1')?.status).toBe(TaskStatus.Paused)
    expect(test.tasks.getById('t2')?.status).toBe(TaskStatus.Paused)
    expect(test.tasks.getById('other')?.status).toBe(TaskStatus.Downloading)
    expect(JSON.stringify(snapshot).includes(test.secret)).toBe(false)
  })
  it('single-flights self-check, tests a real Range request, and emits only redacted fields', async () => {
    const test = await fixture()
    const server = createServer((_req, res) =>
      res
        .writeHead(206, { 'Content-Range': 'bytes 0-0/5', 'Content-Length': 1 })
        .end('a')
    )
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture')
    test.setUrl(`http://127.0.0.1:${address.port}/${test.secret}`)
    vi.mocked(test.adapter.checkLogin).mockClear()
    const reports = await Promise.all([
      test.runtime.selfCheck(undefined),
      test.runtime.selfCheck(undefined),
    ])
    expect(test.adapter.checkLogin).toHaveBeenCalledTimes(1)
    const output = JSON.stringify(reports[0])
    expect(
      output.includes(test.secret) ||
        output.includes('first.bin') ||
        output.includes('127.0.0.1')
    ).toBe(false)
    expect(output.includes('"step":"range","status":"pass"')).toBe(true)
  })
  it.each(['115', '123', 'aliyun'] as const)(
    'runs the same four self-check stages for %s without returning share input or account notes',
    async (platform) => {
      const test = await fixture(platform, platform === 'aliyun')
      await test.runtime.checkHealth(test.account.id)
      test.adapter.createSession = async () => ({
        shareId: 'share',
        token: test.secret,
        title: 'private',
      })
      if (platform === 'aliyun') {
        test.adapter.capabilities.own = false
        const skipped = JSON.stringify(
          await test.runtime.selfCheck(test.account.id)
        )
        expect(skipped.includes('skipped-needs-share-link')).toBe(true)
      }
      const server = createServer((_req, res) =>
        res
          .writeHead(206, {
            'Content-Range': 'bytes 0-0/5',
            'Content-Length': 1,
          })
          .end('a')
      )
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      cleanups.push(async () => {
        server.closeAllConnections()
        await new Promise<void>((r) => server.close(() => r()))
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('fixture')
      test.setUrl(`http://127.0.0.1:${address.port}/${test.secret}`)
      const report = JSON.stringify(
        await test.runtime.selfCheck({
          accountId: test.account.id,
          shareInput: test.secret,
        })
      )
      expect(
        report.includes(test.secret) ||
          report.includes(test.account.id) ||
          report.includes('first.bin')
      ).toBe(false)
      expect(report.includes('"step":"range","status":"pass"')).toBe(true)
      expect(report.includes(`"platform":"${platform}"`)).toBe(true)
    }
  )
  it('repeated batch submission does not create duplicate files or tasks', async () => {
    const test = await fixture()
    const first = await test.runtime.download(test.selection)
    const second = await test.runtime.download(test.selection)
    expect(first.taskIds).toEqual(second.taskIds)
    expect(test.tasks.getAll().length).toBe(2)
  })
  it('keeps user-paused tasks paused across restart without inventing a checkpoint failure', async () => {
    const test = await fixture()
    await test.runtime.download(test.selection)
    vi.mocked(test.engine.resumeTask).mockClear()
    await test.runtime.recover()
    await test.runtime.tick()
    expect(test.engine.resumeTask).not.toHaveBeenCalled()
    expect(
      test.runtime
        .snapshot()
        .tasks.every((t) => !t.reason && t.phase === 'ready')
    ).toBe(true)
  })
  it('stops on unsafe or case-colliding filenames before creating a task', async () => {
    const test = await fixture()
    vi.mocked(test.adapter.listFiles).mockResolvedValue([
      {
        id: 'a',
        parent: '0',
        path: 'A',
        name: 'A.txt',
        directory: false,
        bytes: 5,
      },
      {
        id: 'b',
        parent: '0',
        path: 'b',
        name: 'a.txt',
        directory: false,
        bytes: 5,
      },
    ])
    const ctx = await test.runtime.browse({
      platform: 'quark',
      accountId: test.account.id,
    })
    await expect(
      test.runtime.download({
        ...test.selection,
        contextId: ctx.contextId,
        ids: ['a', 'b'],
      })
    ).rejects.toThrow('cloud.path')
    expect(test.tasks.getAll().length).toBe(0)
    await writeFile(path.join(test.root, 'untouched.txt'), 'existing')
  })
})
