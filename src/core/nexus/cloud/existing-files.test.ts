import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TaskStatus } from '@shared/types/task'
import { makeDownloadTask } from '@test-utils/task'
import { afterEach, describe, expect, it } from 'vitest'
import { ExistingFileDetector } from './existing-files'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-existing-'))
  roots.push(root)
  const file = {
    id: 'one',
    name: 'one.bin',
    directory: false,
    parent: '0',
    path: 'one.bin',
    bytes: 5,
  }
  return {
    root,
    file,
    detector: new ExistingFileDetector(),
    output: path.join(root, file.name),
  }
}
describe('local duplicate evidence', () => {
  it('defaults to same name and size, and never treats a checkpoint or preallocated active task as completed', async () => {
    const { root, file, detector, output } = await fixture()
    await writeFile(output, 'hello')
    expect((await detector.find(file, [], root, []))?.basis).toBe('name-size')
    await writeFile(`${output}.aria2`, 'checkpoint')
    expect(await detector.find(file, [], root, [])).toBeNull()
    await rm(`${output}.aria2`)
    expect(
      await detector.find(file, [], root, [
        makeDownloadTask({ diskPath: output, status: TaskStatus.Paused }),
      ])
    ).toBeNull()
  })
  it('uses actual platform hashes and invalidates a cached digest after a same-sized change', async () => {
    const { root, file, detector, output } = await fixture()
    await writeFile(output, 'hello')
    const hashed = {
      ...file,
      hash: `sha1:${createHash('sha1').update('hello').digest('hex')}`,
    }
    expect((await detector.find(hashed, [], root, []))?.basis).toBe('hash')
    await writeFile(output, 'world')
    expect(await detector.find(hashed, [], root, [])).toBeNull()
  })
  it('checks completed history on disk even under another name, and rejects missing history', async () => {
    const { root, file, detector } = await fixture()
    const other = path.join(root, 'renamed.bin')
    const task = makeDownloadTask({
      finalPath: other,
      diskPath: other,
      totalBytes: 5,
      status: TaskStatus.Completed,
    })
    const hashed = {
      ...file,
      hash: `md5:${createHash('md5').update('hello').digest('hex')}`,
    }
    expect(await detector.find(hashed, [], root, [task])).toBeNull()
    await writeFile(other, 'hello')
    expect((await detector.find(hashed, [], root, [task]))?.basis).toBe(
      'history-hash'
    )
  })
})
