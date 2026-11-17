import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CredentialBroker } from '../cloud/credential-broker'
import type { RemoteJobAdapter } from './remote-job-adapter'
import { RemoteJobManager } from './remote-job-manager'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-remote-'))
  dirs.push(dir)
  const broker = new CredentialBroker(path.join(dir, 'store'), {
    available: async () => true,
    encrypt: async (s) => Buffer.from(s),
    decrypt: async (b) => b.toString(),
  })
  await broker.load()
  const adapter: RemoteJobAdapter = {
    submit: vi.fn(async () => randomUUID()),
    recover: vi.fn(async () => null),
    query: vi.fn(async () => ({ ready: true, progress: 100 })),
    listFiles: vi.fn(async () => [
      { id: 'file', name: 'item', bytes: 4, downloaded: 0, verified: false },
    ]),
    retrieve: vi.fn(async (_j, f) => {
      f.localPath = path.join(dir, 'item')
      f.downloaded = 4
      f.verified = true
    }),
    cleanup: vi.fn(async () => {}),
  }
  const deps = {
    broker,
    adapter: () => adapter,
    changed: () => {},
    assertDisk: () => {},
    process: vi.fn(async () => true),
  }
  const manager = new RemoteJobManager(deps)
  await manager.load()
  const input = {
    adapter: 'test',
    source: 'https://example.com/item',
    directory: dir,
    maxBytes: 1024,
    retainHours: 0,
  }
  return { manager, deps, adapter, input }
}
it('keeps remote 100% separate from local retrieval and cleans only after processing', async () => {
  const f = await fixture()
  const id = await f.manager.submit(f.input)
  expect(f.manager.snapshot()[0]).toMatchObject({
    phase: 'waiting',
    progress: 100,
  })
  expect(f.adapter.retrieve).not.toHaveBeenCalled()
  expect(f.adapter.cleanup).not.toHaveBeenCalled()
  await f.manager.run(id)
  expect(f.manager.snapshot()[0].phase).toBe('completed')
  expect(f.adapter.cleanup).not.toHaveBeenCalled()
  await f.manager.run(id)
  expect(f.adapter.cleanup).toHaveBeenCalledOnce()
})
it('deduplicates concurrent submissions and resumes the same job after restart', async () => {
  const f = await fixture()
  const [a, b] = await Promise.all([
    f.manager.submit(f.input),
    f.manager.submit(f.input),
  ])
  expect(a).toBe(b)
  expect(f.adapter.submit).toHaveBeenCalledOnce()
  const restarted = new RemoteJobManager(f.deps)
  await restarted.load()
  await restarted.tick()
  expect(f.adapter.submit).toHaveBeenCalledOnce()
  expect(restarted.snapshot()[0].phase).toBe('completed')
})
it('never retries an ambiguous submit or deletes remote data after a failed retrieve', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.submit).mockRejectedValueOnce(
    new Error('connection lost')
  )
  const id = await f.manager.submit(f.input)
  await f.manager.run(id)
  expect(f.adapter.submit).toHaveBeenCalledOnce()
  expect(f.manager.snapshot()[0].error).toBe('remote.uncertain')
  expect(f.adapter.cleanup).not.toHaveBeenCalled()
})
it('recovers a lost response by identity and waits for failed post-processing', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.submit).mockRejectedValueOnce(new Error('lost'))
  vi.mocked(f.adapter.recover).mockResolvedValue('remote-existing')
  const id = await f.manager.submit(f.input)
  await f.manager.run(id)
  f.deps.process.mockResolvedValue(false)
  await f.manager.run(id)
  expect(f.manager.snapshot()[0]).toMatchObject({
    remoteId: 'remote-existing',
    phase: 'processing',
  })
  expect(f.adapter.submit).toHaveBeenCalledOnce()
  expect(f.adapter.cleanup).not.toHaveBeenCalled()
})
it('enforces budget and remote-only retention', async () => {
  const f = await fixture()
  await f.manager.submit({ ...f.input, maxBytes: 2 })
  expect(f.manager.snapshot()[0].error).toBe('remote.budget')
  const g = await fixture()
  const id = await g.manager.submit({ ...g.input, remoteOnly: true })
  await g.manager.run(id)
  expect(g.adapter.retrieve).not.toHaveBeenCalled()
  expect(g.adapter.cleanup).not.toHaveBeenCalled()
})
