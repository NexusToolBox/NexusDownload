import {
  access,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OccurrenceDispatcher } from '@core/task/occurrences/occurrence-dispatcher'
import { TaskStatus } from '@shared/types/task'
import type { TaskOccurrence } from '@shared/types/task-occurrence'
import { makeDownloadTask } from '@test-utils/task'
import { describe, expect, it } from 'vitest'
import { createNexusCompletionConsumer } from './completion-consumer'
import { NexusNetworkMarker } from './network-marker'

describe('network marking before completion delivery', () => {
  it.skipIf(process.platform !== 'win32')(
    'marks the published file before live notifications and replay',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'nexus-completion-'))
      try {
        const source = path.join(root, 'file.motrix')
        const target = path.join(root, 'file.bin')
        await writeFile(source, Buffer.alloc(64, 42))
        await rename(source, target)
        const task = makeDownloadTask({
          id: 'complete',
          finalPath: target,
          progress: 1,
          totalBytes: 64,
          status: TaskStatus.Completed,
        })
        const occurrence: TaskOccurrence = {
          occurrenceId: 'completed',
          type: 'terminal',
          taskId: task.id,
          fromStatus: TaskStatus.Finalizing,
          toStatus: TaskStatus.Completed,
          cause: 'finalize',
          errorGroup: null,
          createdAt: Date.now(),
        }
        let status = ''
        const marker = new NexusNetworkMarker({
          enabled: () => true,
          policy: async () => 'preserve',
          files: () => [],
          record: async (_id, result) => {
            status = result
          },
        })
        let notified = 0
        const dispatcher = new OccurrenceDispatcher({
          listUndispatched: () => [occurrence],
          markDispatched: () => undefined,
          log: { error: () => undefined, warn: () => undefined },
        })
        dispatcher.register(
          'nexus',
          createNexusCompletionConsumer({
            getTask: () => task,
            mark: (value) => marker.mark(value),
            completed: async () => undefined,
          })
        )
        dispatcher.register('notification', async () => {
          expect(status).toBe('marked')
          expect(await readFile(`${target}:Zone.Identifier`, 'utf8')).toContain(
            'ZoneId=3'
          )
          notified++
        })
        await dispatcher.dispatch(occurrence)
        await dispatcher.drainAtStartup()
        expect(notified).toBe(2)
        expect((await readFile(target)).equals(Buffer.alloc(64, 42))).toBe(true)
        expect(
          await access(`${source}:Zone.Identifier`)
            .then(() => true)
            .catch(() => false)
        ).toBe(false)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
  it('records marking failure without blocking a completion notification', async () => {
    let marked = false,
      notified = false,
      dispatched = false
    const task = makeDownloadTask({ progress: 1, status: TaskStatus.Completed })
    const marker = new NexusNetworkMarker({
      enabled: () => true,
      policy: async () => 'preserve',
      files: () => [],
      record: async (_id, status) => {
        marked = status === 'failed'
      },
    })
    const dispatcher = new OccurrenceDispatcher({
      listUndispatched: () => [],
      markDispatched: () => {
        dispatched = true
      },
      log: { error: () => undefined, warn: () => undefined },
    })
    dispatcher.register(
      'nexus',
      createNexusCompletionConsumer({
        getTask: () => task,
        mark: (value) => marker.mark(value),
        completed: async () => undefined,
      })
    )
    dispatcher.register('notification', () => {
      notified = true
    })
    await dispatcher.dispatch({
      occurrenceId: 'missing',
      type: 'terminal',
      taskId: task.id,
      fromStatus: TaskStatus.Finalizing,
      toStatus: TaskStatus.Completed,
      cause: 'recovery',
      errorGroup: null,
      createdAt: Date.now(),
    })
    expect(marked && notified && dispatched).toBe(true)
  })
})
