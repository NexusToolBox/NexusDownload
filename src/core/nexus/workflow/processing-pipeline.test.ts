import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CredentialBroker } from '../cloud/credential-broker'
import {
  type ArchiveService,
  archiveEntryList,
  archiveInputs,
  filenamePasswords,
  passwordCandidates,
} from './archive-service'
import { PackageManager } from './package-manager'
import { ProcessingPipeline } from './processing-pipeline'
import type { WorkflowTask } from './queue-manager'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true })
})
async function fixture(restore = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-processing-'))
  dirs.push(root)
  const broker = new CredentialBroker(path.join(root, 'state'), {
    available: async () => true,
    encrypt: async (s) => Buffer.from(s),
    decrypt: async (b) => b.toString(),
  })
  await broker.load()
  const tasks: WorkflowTask[] = []
  const packages = new PackageManager({
    broker,
    tasks: () => tasks,
    changed: () => undefined,
    control: async () => undefined,
  })
  const scan = vi.fn(async () => ''),
    notify = vi.fn(async () => undefined),
    extract = vi.fn(async (files: string[]) => ({
      files,
      password: '',
      archives: [] as string[],
    })),
    recycle = vi.fn(async (_files: string[]) => undefined)
  const pipeline = new ProcessingPipeline({
    broker,
    tasks: () => tasks,
    packages: () => packages,
    archive: { extract, recycle } as unknown as ArchiveService,
    changed: () => undefined,
    scan,
    mark: async () => '',
    organize: async (r) => (r.outputs.length ? r.outputs : r.files),
    notify,
  })
  await pipeline.load()
  if (restore) await pipeline.afterRestore()
  const file = path.join(root, 'payload.zip')
  await writeFile(file, 'local test payload')
  const task: WorkflowTask = {
    id: 'first',
    name: 'payload.zip',
    directory: root,
    status: 'completed',
    progress: 1,
    bytes: 18,
    downloaded: 18,
    files: [file],
    createdAt: Date.now() + 10,
  }
  tasks.push(task)
  return {
    pipeline,
    broker,
    tasks,
    task,
    packages,
    scan,
    notify,
    extract,
    recycle,
    root,
  }
}
it('samples upgrade history after restore and still processes unfinished restored tasks', async () => {
  const f = await fixture(false)
  f.tasks.push({ ...f.task, id: 'unfinished', status: 'paused' })
  await f.pipeline.tick()
  expect(f.pipeline.snapshot().processing).toEqual([])
  await f.pipeline.afterRestore()
  await f.pipeline.tick()
  expect(f.pipeline.settled('first')).toBe(true)
  expect(f.notify).not.toHaveBeenCalled()
  f.tasks[1].status = 'completed'
  await f.pipeline.tick()
  expect(f.notify).toHaveBeenCalledTimes(1)
  expect(f.pipeline.snapshot().processing[0].taskIds).toEqual(['unfinished'])
})
it('blocks downstream handling when a scanner removes a downloaded file', async () => {
  const f = await fixture()
  f.scan.mockImplementationOnce(async () => {
    await rm(f.task.files[0])
    return ''
  })
  await f.pipeline.tick()
  const record = f.pipeline.snapshot().processing[0]
  expect(record.steps.find((s) => s.name === 'mark')?.status).toBe('failed')
  expect(f.notify).not.toHaveBeenCalled()
  expect(f.pipeline.settled('first')).toBe(false)
})
it('allows explicitly requested extraction of an old completed package', async () => {
  const f = await fixture(false)
  await f.pipeline.afterRestore()
  const id = await f.packages.create('old archive', ['first'], f.root)
  const pkg = f.packages.all().find((p) => p.id === id)
  if (!pkg) throw new Error('missing test package')
  pkg.extract = true
  await f.pipeline.configurePackage(pkg)
  await f.pipeline.tick()
  expect(f.extract).toHaveBeenCalledTimes(1)
  expect(f.notify).toHaveBeenCalledTimes(1)
})
it('waits for every package member and notifies only once', async () => {
  const f = await fixture()
  f.tasks.push({ ...f.task, id: 'second', status: 'paused' })
  await f.packages.create('collection', ['first', 'second'], f.root)
  await f.pipeline.tick()
  expect(f.notify).not.toHaveBeenCalled()
  f.tasks[1].status = 'completed'
  await f.pipeline.tick()
  await f.pipeline.tick()
  // Duplicate paths are only counted once; inconsistent package size blocks notification.
  expect(f.pipeline.snapshot().processing[0].steps[0].status).toBe('failed')
  expect(f.notify).not.toHaveBeenCalled()
})
it('retries a failed step without downloading or repeating earlier steps', async () => {
  const f = await fixture()
  f.scan.mockRejectedValueOnce(new Error('processing.scanFailed'))
  await f.pipeline.tick()
  expect(
    f.pipeline.snapshot().processing[0].steps.find((s) => s.name === 'scan')
      ?.status
  ).toBe('failed')
  expect(f.notify).not.toHaveBeenCalled()
  await f.pipeline.action({
    action: 'processing-retry',
    id: 'first',
    step: 'scan',
  })
  await f.pipeline.tick()
  await f.pipeline.tick()
  expect(f.notify).toHaveBeenCalledTimes(1)
  expect(f.scan).toHaveBeenCalledTimes(2)
  expect(f.pipeline.settled('first')).toBe(true)
})
it('rejects traversal, Windows device names and archive links', () => {
  for (const name of [
    '../escape',
    'C:\\escape',
    'safe:stream',
    'dir/CON.txt',
    'dir/name.',
  ])
    expect(() => archiveEntryList(`Path = ${name}\nSize = 1\n`)).toThrow()
  expect(() =>
    archiveEntryList('Path = safe\nSymbolic Link = target\nSize = 1\n')
  ).toThrow()
  expect(archiveEntryList('Path = safe/file.txt\nSize = 123\n')).toEqual({
    bytes: 123,
    paths: ['safe/file.txt'],
  })
})
it('extracts candidate values in source order and deduplicates', () => {
  const value = Math.random().toString(36).slice(2)
  expect(passwordCandidates(`password: ${value}`, `pwd=${value}`)).toEqual([
    value,
  ])
  expect(
    filenamePasswords([
      path.join('ignored-parent', `download[密码:${value}].7z.001`),
      path.join('ignored-parent', `download_密码_${value}.part01.rar`),
    ])
  ).toEqual([value])
})
it('only recycles the volumes belonging to each extracted archive', () => {
  const files = [
    'a.part01.rar',
    'a.part02.rar',
    'b.7z.001',
    'b.7z.002',
    'other.zip',
    'keep.txt',
  ]
  expect(archiveInputs(files)).toEqual([
    { archive: files[0], volumes: files.slice(0, 2) },
    { archive: files[2], volumes: files.slice(2, 4) },
    { archive: files[4], volumes: [files[4]] },
  ])
})
it('persists extraction before recycling and retries recycling without needing removed volumes', async () => {
  const f = await fixture()
  const output = path.join(f.root, 'extracted.txt')
  await writeFile(output, 'complete extraction')
  f.extract.mockResolvedValue({
    files: [output],
    password: '',
    archives: f.task.files,
  })
  f.recycle.mockImplementationOnce(async () => {
    await rm(f.task.files[0])
    throw new Error('processing.failed')
  })
  await f.pipeline.action({
    action: 'processing-save',
    id: f.task.id,
    config: { extract: true, trashArchives: true },
  })
  await f.pipeline.tick()
  expect(f.pipeline.snapshot().processing[0].extracted).toBe(true)
  expect(f.notify).not.toHaveBeenCalled()
  await f.pipeline.action({
    action: 'processing-retry',
    id: f.task.id,
    step: 'extract',
  })
  await f.pipeline.tick()
  expect(f.extract).toHaveBeenCalledTimes(1)
  expect(f.recycle).toHaveBeenCalledTimes(2)
  expect(f.scan).toHaveBeenCalledWith([output])
  expect(f.notify).toHaveBeenCalledTimes(1)
})

it('keeps and deletes password-book entries without returning password values', async () => {
  const f = await fixture()
  const values = Array.from({ length: 3 }, () =>
    randomBytes(24).toString('hex')
  )
  await f.pipeline.action({
    action: 'processing-password-book',
    passwords: values.slice(0, 2),
  })
  await f.pipeline.action({
    action: 'processing-password-book',
    keepIndices: [1],
    expectedCount: 2,
    passwords: [values[2]],
  })
  const actual: string[] = JSON.parse(f.broker.get('password-book') || '[]')
  expect(
    actual.length === 2 && actual[0] === values[1] && actual[1] === values[2]
  ).toBe(true)
  expect(JSON.stringify(f.pipeline.snapshot()).includes(values[1])).toBe(false)
  await expect(
    f.pipeline.action({
      action: 'processing-password-book',
      keepIndices: [],
      expectedCount: 1,
      passwords: [],
    })
  ).rejects.toThrow('workflow.changed')
  expect(f.pipeline.snapshot().passwordCount).toBe(2)
})
