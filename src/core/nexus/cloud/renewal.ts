import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { EngineAdapter } from '@core/engine/engine-adapter'
import { TaskStatus } from '@shared/types/task'
import { CloudError, type CloudResource } from './cloud-adapter'

export type RenewalPhase =
  | 'pausing'
  | 'checkpoint'
  | 'removed'
  | 'readded'
  | 'ready'
  | 'blocked'
export interface RenewalBinding {
  gid: string
  output: string
  phase: RenewalPhase
}
export async function renewDownload(input: {
  engine: EngineAdapter
  binding: RenewalBinding
  resolve: () => Promise<{ resource: CloudResource; uri: string }>
  persist: (phase: RenewalPhase) => Promise<void>
  wait?: (ms: number) => Promise<void>
  validateOutput?: () => Promise<void>
}) {
  const { engine, binding } = input
  const wait =
    input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const phase = async (next: RenewalPhase) => {
    await input.persist(next)
    binding.phase = next
  }
  try {
    await input.validateOutput?.()
    const info = await lstat(binding.output).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      }
    )
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new CloudError('path')
    const current = await engine.getTaskStatus(binding.gid)
    if (current?.status === TaskStatus.Completed)
      throw new CloudError('identity')
    const fresh = !info && (!current || current.downloadedBytes === 0)
    if (
      current &&
      ![TaskStatus.Removed, TaskStatus.Error].includes(current.status)
    ) {
      await phase('pausing')
      if (current.status !== TaskStatus.Paused)
        await engine.pauseTask(binding.gid)
      let paused = false
      for (let i = 0; i < 100; i++) {
        const status = await engine.getTaskStatus(binding.gid)
        if (status?.status === TaskStatus.Paused && status.connections === 0) {
          paused = true
          break
        }
        await wait(100)
      }
      if (!paused) throw new CloudError('checkpoint')
    }
    let checkpoint = fresh
    for (let i = 0; !checkpoint && i < 50; i++) {
      if ((await engine.getCheckpointStatus?.(binding.output)) === 'present') {
        checkpoint = true
        break
      }
      await wait(100)
    }
    if (!checkpoint) throw new CloudError('checkpoint')
    await phase('checkpoint')
    const { resource, uri } = await input.resolve()
    await phase('removed')
    if (
      current &&
      ![TaskStatus.Removed, TaskStatus.Error].includes(current.status)
    )
      await engine.forceRemoveTask(binding.gid)
    let removed = false
    for (let i = 0; i < 100; i++) {
      const status = await engine.getTaskStatus(binding.gid)
      if (
        !status ||
        [TaskStatus.Removed, TaskStatus.Error].includes(status.status)
      ) {
        removed = true
        break
      }
      await wait(100)
    }
    if (!removed) throw new CloudError('checkpoint')
    await engine.removeDownloadResult(binding.gid)
    if (
      !fresh &&
      (await engine.getCheckpointStatus?.(binding.output)) !== 'present'
    )
      throw new CloudError('checkpoint')
    await input.validateOutput?.()
    if (fresh && (await lstat(binding.output).catch(() => null)))
      throw new CloudError('path')
    const gid = await engine.createDownload({
      gid: binding.gid,
      uris: [uri],
      headers: {},
      saveDir: path.dirname(binding.output),
      filename: path.basename(binding.output),
      resumePolicy: fresh ? 'none' : 'checkpoint',
      pause: true,
      connections: 1,
      fileAllocation: 'none',
      extraEngineOptions: {
        'auto-file-renaming': 'false',
        'allow-overwrite': 'false',
        'max-tries': '1',
      },
    })
    if (gid !== binding.gid) throw new CloudError('identity')
    await phase('readded')
    if (
      !fresh &&
      (await engine.getCheckpointStatus?.(binding.output)) !== 'present'
    )
      throw new CloudError('checkpoint')
    await engine.resumeTask(gid)
    await phase('ready')
    return resource
  } catch (error) {
    await phase('blocked')
    throw error
  }
}
