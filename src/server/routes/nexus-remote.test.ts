import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RemoteNodeHost } from '@core/nexus/remote/node-host'
import type { DownloadTask } from '@shared/types/task'
import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { registerNexusRemote } from './nexus-remote'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-node-'))
  roots.push(root)
  const tasks: DownloadTask[] = []
  const create = vi.fn(async (req: { saveDir: string }) => {
    const task = {
      id: randomUUID(),
      saveDir: req.saveDir,
      type: 'http',
      status: 'completed',
      progress: 100,
      totalBytes: 6,
      downloadedBytes: 6,
      finalPath: path.join(req.saveDir, 'sample.dat'),
    } as DownloadTask
    await writeFile(task.finalPath!, 'abcdef')
    tasks.push(task)
    return { outcome: 'created' as const, taskId: task.id, gid: randomUUID() }
  })
  const pause = vi.fn(async () => {})
  const deps = {
    root,
    file: path.join(root, 'jobs.json'),
    create,
    pause,
    tasks: () => tasks,
    files: () => [],
    authorize: async () => {},
  }
  const host = new RemoteNodeHost(deps)
  await host.load()
  const owner = randomUUID(),
    id = randomUUID()
  const req = { id, source: 'https://example.org/sample', maxBytes: 100 }
  await host.submit(owner, req)
  return { host, deps, tasks, owner, id, req, create, pause }
}
it('persists submit intent and reconciles repeated submissions across a restart', async () => {
  const f = await fixture()
  const restarted = new RemoteNodeHost(f.deps)
  await restarted.load()
  await restarted.submit(f.owner, f.req)
  expect(f.create).toHaveBeenCalledTimes(1)
  expect((await restarted.status(f.owner, f.id)).ready).toBe(true)
  await expect(restarted.list(randomUUID(), f.id)).rejects.toThrow(
    'remote.missing'
  )
  await expect(restarted.submit(randomUUID(), f.req)).rejects.toThrow(
    'remote.missing'
  )
})
it('pauses an over-budget transfer without waiting for the desktop', async () => {
  const f = await fixture()
  Object.assign(f.tasks[0], { totalBytes: 101, status: 'downloading' })
  await f.host.tick()
  expect(f.pause).toHaveBeenCalledWith(f.tasks[0].id)
})
it('rejects files outside the job directory and cleans only known outputs idempotently', async () => {
  const f = await fixture()
  const original = f.tasks[0].finalPath!
  f.tasks[0].finalPath = f.deps.file
  await expect(f.host.list(f.owner, f.id)).rejects.toThrow('remote.path')
  f.tasks[0].finalPath = original
  const unrelated = path.join(f.tasks[0].saveDir, 'keep.dat')
  await writeFile(unrelated, 'keep')
  await f.host.cleanup(f.owner, f.id)
  await f.host.cleanup(f.owner, f.id)
  expect(await readFile(unrelated, 'utf8')).toBe('keep')
  expect((await f.host.status(f.owner, f.id)).cleaned).toBe(true)
})
it('serves authenticated byte ranges, rejects stale identity and other owners', async () => {
  const f = await fixture()
  const app = Fastify()
  const token = randomUUID()
  registerNexusRemote(app, f.host, (value) =>
    value === token ? f.owner : null
  )
  try {
    const file = (await f.host.list(f.owner, f.id))[0]
    const url = `/nexus/v05/jobs/${f.id}/files/${file.id}`
    const headers = { authorization: `Bearer ${token}`, range: 'bytes=2-4' }
    const response = await app.inject({ url, headers })
    expect(response.statusCode).toBe(206)
    expect(response.body).toBe('cde')
    expect(response.headers['content-range']).toBe('bytes 2-4/6')
    expect(
      (
        await app.inject({
          url,
          headers: { ...headers, 'if-range': '"stale"' },
        })
      ).statusCode
    ).toBe(412)
    expect(
      (await app.inject({ url, headers: { ...headers, range: 'bytes=6-' } }))
        .statusCode
    ).toBe(416)
    expect((await app.inject({ url })).json().error).toBe(
      'remote.authorization'
    )
    expect(
      (
        await app.inject({
          url,
          headers: { ...headers, origin: 'https://example.org' },
        })
      ).json().error
    ).toBe('remote.authorization')
  } finally {
    await app.close()
  }
})
