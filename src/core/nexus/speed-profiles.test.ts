import { TaskStatus } from '@shared/types/task'
import { makeDownloadTask } from '@test-utils/task'
import { expect, it } from 'vitest'
import type { CredentialBroker } from './cloud/credential-broker'
import { SpeedProfiles } from './speed-profiles'

it('preserves damaged optional statistics without blocking downloads or overwriting them', async () => {
  let writes = 0
  const broker = {
    get: () => '{broken',
    update: async () => {
      writes++
    },
  } as unknown as CredentialBroker
  const profiles = new SpeedProfiles(broker, () => {})
  expect(() => profiles.load()).not.toThrow()
  await profiles.begin('t', {
    platform: '115',
    accountId: 'local',
    method: 'offline',
  })
  await profiles.save()
  expect(writes).toBe(0)
  expect(profiles.snapshot()).toEqual([])
})

it('separates account/method, excludes pause/downtime and persists outcomes without double counting', async () => {
  const data = new Map<string, string>()
  const broker = {
    get: (k: string) => data.get(k) || '',
    update: async (k: string, fn: (s: string) => string) => {
      data.set(k, fn(data.get(k) || ''))
    },
  } as unknown as CredentialBroker
  const key = {
    platform: 'quark' as const,
    accountId: 'account',
    method: 'own' as const,
  }
  let profiles = new SpeedProfiles(broker, () => {})
  profiles.load()
  const task = makeDownloadTask({
    id: 't',
    status: TaskStatus.Downloading,
    downloadedBytes: 0,
  })
  await profiles.begin('t', key, 1000)
  await profiles.observe([task], 2000)
  task.downloadedBytes = 1000
  await profiles.observe([task], 3000)
  task.status = TaskStatus.Paused
  await profiles.observe([task], 4000)
  await profiles.observe([task], 100000)
  task.status = TaskStatus.Downloading
  await profiles.observe([task], 101000)
  task.downloadedBytes = 2000
  task.status = TaskStatus.Completed
  await profiles.observe([task], 102000)
  expect(profiles.estimate(key, 5000, 0).seconds).toBe(5)
  expect(
    profiles.estimate({ ...key, accountId: 'another' }, 5000, 0).seconds
  ).toBeNull()
  expect(
    profiles.estimate({ ...key, method: 'save' }, 5000, 0).seconds
  ).toBeNull()
  expect(profiles.estimate(key, 5000, 1).seconds).toBeNull()
  profiles = new SpeedProfiles(broker, () => {})
  profiles.load()
  await profiles.observe([task], 200000)
  expect(profiles.snapshot()[0].attempts).toBe(1)
  await profiles.begin('error', key, 201000)
  const failed = makeDownloadTask({ id: 'error', status: TaskStatus.Error })
  await profiles.observe([task, failed], 202000)
  expect(profiles.snapshot()[0].successRate).toBe(0.5)
})
