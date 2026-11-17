import { queueSchema } from '@shared/schemas/nexus-workflow'
import { expect, it } from 'vitest'
import type { CredentialBroker } from '../cloud/credential-broker'
import {
  nextQueueStart,
  QueueManager,
  scheduleWindow,
  type WorkflowTask,
} from './queue-manager'

it('keeps an overnight queue on the starting weekday', () => {
  const queue = queueSchema.parse({
    id: 'night',
    name: 'night',
    schedule: {
      enabled: true,
      start: '23:00',
      stop: '07:00',
      days: [1],
      wake: true,
    },
  })
  expect(scheduleWindow(queue, new Date(2026, 10, 17, 2, 0))?.key).toBe(
    '2026-11-16'
  )
  expect(scheduleWindow(queue, new Date(2026, 10, 17, 7, 0))).toBe(null)
  expect(scheduleWindow(queue, new Date(2026, 10, 18, 2, 0))).toBe(null)
  expect(nextQueueStart(queue, new Date(2026, 10, 16, 20))).toBe(
    new Date(2026, 10, 16, 23).getTime()
  )
})
it('does not repeat a dated schedule on another day', () => {
  const queue = queueSchema.parse({
    id: 'once',
    name: 'once',
    schedule: {
      enabled: true,
      date: '2026-11-16',
      start: '10:00',
      stop: '11:00',
    },
  })
  expect(scheduleWindow(queue, new Date(2026, 10, 17, 10, 30))).toBe(null)
})

it('enforces concurrency and preserves a user pause while filling the freed slot', async () => {
  const tasks: WorkflowTask[] = ['a', 'b', 'c'].map((id) => ({
    id,
    name: id,
    directory: 'test',
    status: 'paused',
    progress: 0,
    bytes: 1,
    downloaded: 0,
    files: [],
  }))
  const broker = {
    get: () => '',
    update: async () => undefined,
  } as unknown as CredentialBroker
  const manager = new QueueManager({
    broker,
    tasks: () => tasks,
    changed: () => undefined,
    ready: () => true,
    execute: async () => undefined,
    save: async () => undefined,
  })
  manager.setControls({
    pause: async (id) => {
      const t = tasks.find((t) => t.id === id)
      if (t) t.status = 'paused'
    },
    resume: async (id) => {
      const t = tasks.find((t) => t.id === id)
      if (t) t.status = 'downloading'
    },
    retry: async () => undefined,
  })
  await manager.intent(['a', 'b', 'c'], true)
  await manager.action({
    action: 'queue-save',
    queue: queueSchema.parse({
      id: 'main',
      name: 'Main',
      concurrency: 2,
      running: true,
    }),
  })
  expect(tasks.map((t) => t.status)).toEqual([
    'downloading',
    'downloading',
    'paused',
  ])
  await manager.intent(['a'], false)
  await manager.tick()
  await manager.tick()
  expect(tasks.map((t) => t.status)).toEqual([
    'paused',
    'downloading',
    'downloading',
  ])
  manager.dispose()
})
it('waits for processing before counting a seeding payload as completed', async () => {
  let settled = false
  const task: WorkflowTask = {
    id: 'payload',
    name: 'payload',
    directory: 'test',
    status: 'downloading',
    progress: 0,
    bytes: 1,
    downloaded: 0,
    files: [],
  }
  const manager = new QueueManager({
    broker: {
      get: () => '',
      update: async () => undefined,
    } as unknown as CredentialBroker,
    tasks: () => [task],
    settled: () => settled,
    changed: () => undefined,
    ready: () => true,
    execute: async () => undefined,
    save: async () => undefined,
  })
  manager.setControls({
    pause: async () => undefined,
    resume: async () => undefined,
    retry: async () => undefined,
  })
  try {
    await manager.action({
      action: 'queue-save',
      queue: queueSchema.parse({
        id: 'main',
        name: 'Main',
        completion: 'open',
      }),
    })
    await manager.action({ action: 'queue-run', id: 'main', running: true })
    task.status = 'seeding'
    await manager.tick()
    expect(manager.snapshot().countdowns.main.phase).toBe('waiting')
    settled = true
    await manager.tick()
    expect(manager.snapshot().countdowns.main.phase).toBe('countdown')
    await manager.action({ action: 'cancel-completion', id: 'main' })
    expect(manager.snapshot().countdowns.main.phase).toBe('off')
  } finally {
    manager.dispose()
  }
})
