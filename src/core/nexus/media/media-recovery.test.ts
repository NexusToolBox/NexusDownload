import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  type SegmentAria2,
  SegmentDownloader,
} from '@core/download/segment-downloader'
import type { FfmpegService } from '@core/ffmpeg/ffmpeg-service'
import { assembleSegments } from '@core/media/segment-assembler'
import { SegmentDecryptor } from '@core/media/segment-decryptor'
import { MediaMetaStoreImpl } from '@core/task/media-meta-store'
import { MediaTaskCoordinator } from '@core/task/media-task-coordinator'
import { TaskManager } from '@core/task/task-manager'
import { expect, it, vi } from 'vitest'
import type { CredentialBroker } from '../cloud/credential-broker'
import { MediaRecovery, segmentCheckpoints } from './media-recovery'

it.each(['hls', 'dash'] as const)(
  'restores the same %s task and reuses only intact completed segments',
  async (kind) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-media-restart-'))
    const values = new Map<string, string>()
    const broker = {
      get: (k: string) => values.get(k) || '',
      update: async (k: string, fn: (s: string) => string) => {
        values.set(k, fn(values.get(k) || ''))
      },
    } as unknown as CredentialBroker
    let firstRun = true
    const requested: string[] = []
    const callbacks: ((gid: string) => void)[] = []
    const aria: SegmentAria2 = {
      addUri: async ([url], opts) => {
        const gid = randomUUID()
        requested.push(url)
        if (!firstRun || url.endsWith('/0')) {
          await writeFile(
            path.join(opts.dir, opts.out),
            url.endsWith('/0') ? 'first' : 'second'
          )
          setTimeout(() => {
            for (const callback of callbacks) callback(gid)
          }, 1)
        }
        return gid
      },
      onComplete: (cb) => {
        callbacks.push(cb)
      },
      onError: () => {},
      tellStatus: async () => ({ totalLength: 5, completedLength: 5 }),
      forceRemove: async () => {},
      removeDownloadResult: async () => {},
    }
    const make = (tasks: TaskManager) => {
      const recovery = new MediaRecovery(broker, root)
      const coordinator = new MediaTaskCoordinator({
        recovery,
        mediaMetaStore: new MediaMetaStoreImpl(path.join(root, 'metadata')),
        taskManager: tasks,
        activityRecorder: {
          recordSubmitted: () => {},
          recordDownloadCompleted: () => {},
        },
        eventBus: { emit: () => {} },
        publishTaskUpdate: () => {},
        publishTaskUpdateNow: () => {},
        resolveFfmpegBinaryPath: async () => 'test-only',
        makeDownloader: (tmpDir) =>
          new SegmentDownloader({
            aria2: aria,
            tmpDir,
            concurrency: 1,
            checkpoints: segmentCheckpoints,
          }),
        decryptor: new SegmentDecryptor(),
        assemble: assembleSegments,
        makeFfmpeg: () =>
          ({
            run: async (job: { videoPath: string; output: string }) => {
              await copyFile(job.videoPath, job.output)
            },
            kill: () => {},
          }) as unknown as FfmpegService,
        mkdtemp: () => mkdtemp(path.join(root, 'pieces-')),
        persist: async () => {},
        pickName: async (_dir, name) => name,
      })
      return { coordinator, recovery }
    }
    let current: MediaTaskCoordinator | undefined
    try {
      const tasks = new TaskManager()
      const original = make(tasks)
      current = original.coordinator
      const id = (
        await current.submit({
          kind,
          saveDir: root,
          finalName: 'movie.mp4',
          headers: {},
          sourceMeta: null,
          video: {
            container: kind === 'hls' ? 'mpegts' : 'fmp4',
            isComplete: true,
            segments: [
              { url: 'https://example.org/0', index: 0 },
              { url: 'https://example.org/1', index: 1 },
            ],
          },
        })
      ).taskId
      await vi.waitFor(() => expect(requested).toHaveLength(2))
      await current.stopAndDrain()
      const restoredTasks = new TaskManager()
      for (const task of tasks.getAll())
        restoredTasks.add(structuredClone(task))
      firstRun = false
      requested.length = 0
      const restart = make(restoredTasks)
      current = restart.coordinator
      await restart.recovery.restore(current, restoredTasks.getAll())
      expect(restoredTasks.getAll()).toHaveLength(1)
      expect(requested).toHaveLength(0)
      expect(current.resumePending(id)).toBe(true)
      await vi.waitFor(() =>
        expect(restoredTasks.getById(id)?.status).toBe('completed')
      )
      expect(requested).toEqual(['https://example.org/1'])
      expect(await readFile(path.join(root, 'movie.mp4'), 'utf8')).toBe(
        'firstsecond'
      )
      expect(JSON.parse(values.get('media-recovery') || '[]')).toHaveLength(0)
    } finally {
      await current?.stopAndDrain()
      await rm(root, { recursive: true, force: true })
    }
  }
)
it('refuses a modified completed piece or a different segment identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-piece-'))
  try {
    const file = path.join(root, 'part.seg'),
      part = { url: 'https://example.org/0', index: 0 }
    await writeFile(file, 'good')
    await segmentCheckpoints.write(file, part)
    expect(await segmentCheckpoints.read(file, part)).toBe(4)
    expect(
      await segmentCheckpoints.read(file, {
        ...part,
        url: 'https://example.org/1',
      })
    ).toBeNull()
    await writeFile(file, 'evil')
    expect(await segmentCheckpoints.read(file, part)).toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
