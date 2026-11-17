import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Aria2Adapter } from '@core/engine/aria2/aria2-adapter'
import { Aria2RpcClient } from '@core/engine/aria2/aria2-rpc-client'
import { JsonRpcProtocol } from '@core/engine/aria2/json-rpc-protocol'
import { WebSocketTransport } from '@core/engine/aria2/web-socket-transport'
import type { EngineAdapter } from '@core/engine/engine-adapter'
import { EventBus } from '@core/events/event-bus'
import { TaskStatus } from '@shared/types/task'
import { afterEach, expect, it, vi } from 'vitest'
import { PortableUpdateService } from './portable-update-service'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

it('persists prompted versions and preserves completed notes across checks', async () => {
  const f = await fixture()
  f.service.setStartupResult({
    completedVersion: '1.3.0',
    releaseNotes: 'Installed release notes',
  })
  await f.service.check(false)
  expect(f.service.getState()).toMatchObject({
    automatic: true,
    prompted: false,
    completedReleaseNotes: 'Installed release notes',
  })
  await f.service.action({ action: 'mark-prompted' })
  const restored = new PortableUpdateService(f.options)
  await restored.initialize()
  await restored.check()
  expect(restored.getState()).toMatchObject({
    automatic: false,
    prompted: true,
  })
})

it('offers a browser after thirty slow seconds, resets on fast traffic and retains partial bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexus-slow-update-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  let speed = 0
  const partial = Buffer.from('partial release')
  const archive = path.join(directory, 'NexusDownload-v1.3.1-win-x64.zip')
  const engine = {
    createDownload: vi.fn(async () => 'update-gid'),
    getTaskStatus: vi.fn(async () => ({
      status: TaskStatus.Downloading,
      downloadedBytes: speed ? 500 : 0,
      downloadSpeed: speed,
      totalBytes: 10000,
      progress: 0.05,
    })),
    pauseTask: vi.fn(async () => undefined),
    removeTask: vi.fn(),
  } as unknown as EngineAdapter
  const fetcher = vi.fn(
    async (url: unknown) =>
      new Response(
        String(url).endsWith('.sha256')
          ? 'a'.repeat(64)
          : JSON.stringify({
              tag_name: 'v1.3.1',
              body: '## Improvements\n- Faster updates',
              published_at: '2026-11-17T00:00:00Z',
              html_url: 'https://example.com/release',
              draft: false,
              prerelease: false,
              assets: ['', '.sha256'].map((suffix) => ({
                name: `NexusDownload-v1.3.1-win-x64.zip${suffix}`,
                browser_download_url: `https://example.com/archive.zip${suffix}`,
                size: 10000,
              })),
            })
      )
  ) as unknown as typeof fetch
  const service = new PortableUpdateService({
    version: '1.3.0',
    directory,
    latestUrl: 'https://example.com/latest',
    engine,
    events: new EventBus(),
    prefix: () => '',
    activeTasks: () => [],
    install: vi.fn(),
    fetcher,
  })
  await service.initialize()
  await service.check(false)
  expect(service.getState().publishedAt).toBe('2026-11-17T00:00:00Z')
  await writeFile(archive, partial)
  vi.useFakeTimers()
  await service.download()
  await vi.waitFor(() => expect(engine.getTaskStatus).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(29000)
  expect(service.getState().browserFallback).toBe(false)
  speed = 100 * 1024
  await vi.advanceTimersByTimeAsync(1000)
  speed = 10 * 1024
  await vi.advanceTimersByTimeAsync(29000)
  expect(service.getState().browserFallback).toBe(false)
  await vi.advanceTimersByTimeAsync(1500)
  expect(service.getState().browserFallback).toBe(true)
  expect(await readFile(archive)).toEqual(partial)
  expect(engine.pauseTask).not.toHaveBeenCalled()
  expect(engine.removeTask).not.toHaveBeenCalled()
  const cancel = service.action({ action: 'cancel' })
  await vi.advanceTimersByTimeAsync(500)
  await cancel
})

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexus-release-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const payload = Buffer.alloc(262144, 19)
  let badHash = false,
    unavailable = false,
    prerelease = false,
    checks = 0
  const filename = 'NexusDownload-v1.3.1-win-x64.zip'
  const server = createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    if (req.url === '/releases/latest') {
      checks++
      if (unavailable) {
        res.writeHead(429).end()
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          tag_name: 'v1.3.1',
          body: '## Changes\n- Portable update',
          html_url: `${origin}/release`,
          draft: false,
          prerelease,
          assets: [filename, `${filename}.sha256`].map((name) => ({
            name,
            browser_download_url: `${origin}/${name}`,
            size: payload.length,
          })),
        })
      )
    } else if (req.url?.endsWith('.sha256')) {
      res.end(
        `${badHash ? '0'.repeat(64) : createHash('sha256').update(payload).digest('hex')}  ${filename}`
      )
    } else {
      const start = Number(
        /bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0
      )
      res.writeHead(start ? 206 : 200, {
        'Content-Length': payload.length - start,
        'Accept-Ranges': 'bytes',
        ...(start
          ? {
              'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
            }
          : {}),
      })
      res.end(payload.subarray(start))
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const rpcPort = (reservation.address() as { port: number }).port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const child = spawn(
    path.resolve('extra/win32/x64/aria2c.exe'),
    [
      '--enable-rpc',
      `--rpc-listen-port=${rpcPort}`,
      '--rpc-listen-all=false',
      '--enable-dht=false',
      '--disable-ipv6=true',
      '--no-conf=true',
      '--file-allocation=none',
    ],
    { windowsHide: true, stdio: 'ignore', cwd: directory }
  )
  cleanup.push(async () => {
    child.kill()
    if (child.exitCode === null) await once(child, 'exit')
  })
  const transport = new WebSocketTransport()
  const rpc = new Aria2RpcClient(transport, new JsonRpcProtocol(transport), '')
  await rpc.connect(rpcPort, 30, 100)
  cleanup.push(async () => rpc.disconnect())
  const engine = new Aria2Adapter(rpc)
  const install = vi.fn(async () => undefined)
  const options = {
    version: '1.3.0',
    directory,
    latestUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/releases/latest`,
    engine,
    events: new EventBus(),
    prefix: () => '',
    activeTasks: () => ['test-download'],
    install,
    allowLocalhost: true,
  }
  const service = new PortableUpdateService(options)
  await service.initialize()
  return {
    service,
    directory,
    filename,
    payload,
    install,
    options,
    bad: () => {
      badHash = true
    },
    offline: () => {
      unavailable = true
    },
    pre: () => {
      prerelease = true
    },
    checks: () => checks,
  }
}

it.skipIf(process.platform !== 'win32')(
  'downloads a local release with the real engine, validates it and hands off installation',
  async () => {
    const f = await fixture()
    await f.service.check(false)
    await f.service.check(false)
    expect(f.checks()).toBe(1)
    expect(f.service.getState().phase).toBe('available')
    await f.service.download()
    await f.service.waitForDownload()
    expect(f.service.getState().phase).toBe('downloaded')
    expect(await readFile(path.join(f.directory, f.filename))).toEqual(
      f.payload
    )
    await f.service.install()
    expect(f.install).toHaveBeenCalledOnce()
    expect(f.service.getState().phase).toBe('installing')
  },
  20000
)

it.skipIf(process.platform !== 'win32')(
  'deletes a corrupt archive and leaves installation unavailable',
  async () => {
    const f = await fixture()
    f.bad()
    await f.service.check()
    await f.service.download()
    await f.service.waitForDownload()
    expect(f.service.getState().error?.message).toBe('update.hash')
    await expect(readFile(path.join(f.directory, f.filename))).rejects.toThrow()
    await f.service.install()
    expect(f.install).not.toHaveBeenCalled()
  },
  20000
)

it.skipIf(process.platform !== 'win32')(
  'keeps automatic failures quiet, ignores prereleases and tolerates corrupt preferences',
  async () => {
    const f = await fixture()
    await writeFile(path.join(f.directory, 'preferences.json'), '{')
    const service = new PortableUpdateService(f.options)
    await service.initialize()
    f.offline()
    await service.check(false)
    expect(service.getState().phase).toBe('idle')
    await service.check()
    expect(service.getState().error?.message).toBe('update.github')
    const other = await fixture()
    other.pre()
    await other.service.check()
    expect(other.service.getState().availableVersion).toBeUndefined()
  },
  20000
)

it.skipIf(process.platform !== 'win32')(
  'ignores an old skipped version during automatic checks',
  async () => {
    const f = await fixture()
    await writeFile(
      path.join(f.directory, 'preferences.json'),
      JSON.stringify({ lastCheck: 0, skipped: '1.3.1' })
    )
    const service = new PortableUpdateService(f.options)
    await service.initialize()
    await service.check(false)
    expect(service.getState().phase).toBe('available')
    await expect(service.action({ action: 'skip' })).rejects.toThrow()
  },
  20000
)
