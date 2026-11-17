import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TaskStatus } from '@shared/types/task'
import { makeDownloadTask } from '@test-utils/task'
import { expect, it, vi } from 'vitest'
import { duplicateTask, normalizedSourceIdentity } from './duplicate-download'
import { NexusWorkspace } from './workspace'

it('normalizes tracking parameters, trailing slashes and magnet hashes without losing resource identity', () => {
  expect(
    normalizedSourceIdentity(
      'https://example.test/file/?b=2&utm_source=mail&a=1#top'
    )
  ).toBe(normalizedSourceIdentity('https://example.test/file?a=1&b=2'))
  expect(
    normalizedSourceIdentity('https://example.test/file?spm=tracking')
  ).toBe(normalizedSourceIdentity('https://example.test/file/'))
  expect(normalizedSourceIdentity('https://example.test/file?id=1')).not.toBe(
    normalizedSourceIdentity('https://example.test/file?id=2')
  )
  expect(
    normalizedSourceIdentity(`magnet:?xt=urn:btih:${'f'.repeat(40)}&dn=first`)
  ).toBe(
    normalizedSourceIdentity(
      `magnet:?xt=urn:btih:${'7'.repeat(32)}&tr=https://tracker.test`
    )
  )
})

it('checks completed outputs, skips existing tasks by default, supports all-download and the preference', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-duplicates-'))
  try {
    const task = makeDownloadTask({
      id: 'existing',
      uris: ['https://example.test/file/?utm_source=old'],
      status: TaskStatus.Downloading,
      diskPath: path.join(root, 'file'),
    })
    const workspace = new NexusWorkspace({
      file: path.join(root, 'state.json'),
      defaultDirectory: () => root,
      changed() {},
      tasks: () => [task],
      fetch: vi.fn(
        async () => new Response(null, { headers: { 'content-length': '1' } })
      ),
    })
    await workspace.updatePreferences({ diskReserveGiB: 0.1 })
    const create = vi.fn(async () => ({
      outcome: 'created' as const,
      taskId: 'new',
      gid: 'new',
    }))
    const check = await workspace.collect({
      input: 'https://example.test/file',
    })
    const ids = check?.items.map((item) => item.id)
    expect(check?.items[0].duplicate).toEqual({
      taskId: 'existing',
      status: 'active',
    })
    expect(await workspace.download({ ids }, create)).toEqual({
      taskIds: [],
      failed: 0,
    })
    expect(create).not.toHaveBeenCalled()
    task.status = TaskStatus.Completed
    expect(await duplicateTask(task)).toBeUndefined()
    await writeFile(task.diskPath, 'x')
    expect(await duplicateTask(task)).toEqual({
      taskId: 'existing',
      status: 'completed',
    })
    await workspace.download({ ids, skipDuplicates: false }, create)
    expect(create).toHaveBeenCalledTimes(1)
    await workspace.updatePreferences({ duplicateWarning: false })
    expect(
      (await workspace.collect({ input: 'https://example.test/file' }))
        ?.items[0].duplicate
    ).toBeUndefined()
    task.status = TaskStatus.Removed
    expect(await duplicateTask(task)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('finds restored magnets by info hash when their original URI is absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-magnet-duplicate-'))
  try {
    const workspace = new NexusWorkspace({
      file: path.join(root, 'state.json'),
      defaultDirectory: () => root,
      changed() {},
      tasks: () => [
        makeDownloadTask({
          infoHash: 'a'.repeat(40),
          uris: [],
          status: TaskStatus.Paused,
        }),
      ],
    })
    expect(
      (
        await workspace.collect({
          input: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
        })
      )?.items[0].duplicate?.status
    ).toBe('active')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
