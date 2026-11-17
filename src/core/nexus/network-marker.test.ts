import { randomBytes } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TaskStatus } from '@shared/types/task'
import { makeDownloadTask } from '@test-utils/task'
import { afterEach, describe, expect, it } from 'vitest'
import { markNetworkFile, NexusNetworkMarker } from './network-marker'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-mark-'))
  roots.push(root)
  const file = path.join(root, 'download.bin')
  const data = randomBytes(64)
  await writeFile(file, data)
  return { root, file, data }
}
describe('Windows network provenance', () => {
  it.skipIf(process.platform !== 'win32')(
    'writes only the zone, preserves file bytes and is idempotent',
    async () => {
      const { file, data } = await fixture()
      expect(await markNetworkFile(file, 'preserve')).toBe('marked')
      expect(await markNetworkFile(file, 'preserve')).toBe('marked')
      expect(await readFile(file)).toEqual(data)
      expect(await readFile(`${file}:Zone.Identifier`, 'utf8')).toBe(
        '[ZoneTransfer]\r\nZoneId=3\r\n'
      )
    }
  )
  it('respects policy and refuses missing files and symlinks', async () => {
    const { root, file } = await fixture()
    expect(await markNetworkFile(file, 'skip', 'win32')).toBe('policy-skipped')
    expect(
      await access(`${file}:Zone.Identifier`)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
    expect(
      await markNetworkFile(path.join(root, 'missing'), 'preserve', 'win32')
    ).toBe('failed')
    const link = path.join(root, 'link')
    await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await markNetworkFile(link, 'preserve', 'win32')).toBe('failed')
  })
  it('never marks an unfinished task and exposes failed marking for retry', async () => {
    const { file } = await fixture()
    const recorded: string[] = []
    const marker = new NexusNetworkMarker({
      enabled: () => true,
      policy: async () => 'preserve',
      files: () => [],
      record: async (_id, status) => {
        recorded.push(status)
      },
    })
    await marker.mark(
      makeDownloadTask({
        finalPath: file,
        progress: 0.5,
        status: TaskStatus.Downloading,
      })
    )
    expect(recorded).toHaveLength(0)
    await marker.mark(
      makeDownloadTask({
        finalPath: file,
        progress: 1,
        status: TaskStatus.Completed,
        totalBytes: 1000,
      })
    )
    expect(recorded).toEqual(['failed'])
  })
  it.skipIf(process.platform !== 'win32')(
    'marks only selected, complete children of a package',
    async () => {
      const { root } = await fixture()
      const payload = path.join(root, 'package')
      await mkdir(payload)
      const first = path.join(payload, 'first.bin'),
        second = path.join(payload, 'second.bin')
      await writeFile(first, Buffer.alloc(64))
      await writeFile(second, Buffer.alloc(64))
      const recorded: string[] = []
      const marker = new NexusNetworkMarker({
        enabled: () => true,
        policy: async () => 'preserve',
        files: () => [
          { fileIndex: 0, path: first, size: 64, selected: true },
          { fileIndex: 1, path: second, size: 64, selected: false },
        ],
        record: async (_id, status) => {
          recorded.push(status)
        },
      })
      await marker.mark(
        makeDownloadTask({
          finalPath: payload,
          diskPath: payload,
          progress: 1,
          status: TaskStatus.Completed,
          fileCount: 2,
        })
      )
      expect(recorded).toEqual(['marked'])
      expect(
        await access(`${first}:Zone.Identifier`)
          .then(() => true)
          .catch(() => false)
      ).toBe(true)
      expect(
        await access(`${second}:Zone.Identifier`)
          .then(() => true)
          .catch(() => false)
      ).toBe(false)
    }
  )
})
