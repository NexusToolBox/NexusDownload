import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { EngineAdapter } from '@core/engine/engine-adapter'
import { TaskStatus } from '@shared/types/task'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountGovernor } from './account-governor'
import { CloudError } from './cloud-adapter'
import { prepareCloudDirectory, safeCloudName } from './cloud-path'
import { type RenewalPhase, renewDownload } from './renewal'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function root() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexus-safety-'))
  roots.push(directory)
  return directory
}
describe('cloud output admission', () => {
  it.each([
    '..',
    '../escape',
    'a/b',
    'C:escape',
    'NUL.txt',
    'COM1',
    'a.',
    'a ',
    'a\0b',
  ])('rejects unsafe remote names (%s)', (name) => {
    expect(() => safeCloudName(name)).toThrow('cloud.path')
  })
  it('preserves nested folders and refuses junction escapes', async () => {
    const directory = await root()
    const outside = await root()
    expect(await prepareCloudDirectory(directory, ['A', 'B'])).toBe(
      path.join(await realpath(directory), 'A', 'B')
    )
    await symlink(outside, path.join(directory, 'escape'), 'junction')
    await expect(
      prepareCloudDirectory(directory, ['escape', 'file'])
    ).rejects.toThrow('cloud.path')
  })
})
describe('account governor', () => {
  it('serializes the same account while independent accounts proceed', async () => {
    let now = 2000
    const governor = new AccountGovernor({
      persist: async () => undefined,
      pause: async () => undefined,
      now: () => now,
      wait: async (ms) => {
        now += ms
      },
    })
    const events: string[] = []
    let release = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    const first = governor.run('a', 'baidu', 'link', async () => {
      events.push('first')
      await held
    })
    const second = governor.run('a', 'baidu', 'link', async () => {
      events.push('second')
    })
    await governor.run('b', 'baidu', 'link', async () => {
      events.push('other')
    })
    expect(events.includes('second')).toBe(false)
    release()
    await Promise.all([first, second])
    expect(events.at(-1)).toBe('second')
    expect(now).toBe(4000)
  })
  it.each(['risk', 'captcha', 'rate'] as const)(
    'pauses all account work on %s and requires manual acknowledgement',
    async (kind) => {
      const pause = vi.fn(async () => undefined)
      const governor = new AccountGovernor({
        persist: async () => undefined,
        pause,
        wait: async () => undefined,
      })
      await expect(
        governor.run('a', 'baidu', 'request', async () => {
          throw new CloudError(kind)
        })
      ).rejects.toThrow(`cloud.${kind}`)
      const request = vi.fn(async () => true)
      await expect(
        governor.run('a', 'baidu', 'request', request)
      ).rejects.toThrow()
      expect(request).not.toHaveBeenCalled()
      expect(pause).toHaveBeenCalledOnce()
      await governor.resume('a')
      expect(await governor.run('a', 'baidu', 'request', request)).toBe(true)
    }
  )
  it('persists transfer consumption before dispatch and refuses the daily limit', async () => {
    const governor = new AccountGovernor({
      persist: async () => undefined,
      pause: async () => undefined,
      wait: async () => undefined,
    })
    for (let i = 0; i < 20; i++)
      await governor.run('a', 'baidu', 'transfer', async () => undefined)
    const send = vi.fn(async () => undefined)
    await expect(governor.run('a', 'baidu', 'transfer', send)).rejects.toThrow(
      'cloud.rate'
    )
    expect(send).not.toHaveBeenCalled()
    expect(governor.snapshot('a', 'baidu').transfers).toBe(20)
  })
})
describe('renewal transaction', () => {
  async function fixture(checkpoint: 'present' | 'absent' = 'present') {
    const directory = await root()
    const output = path.join(directory, 'file.motrix')
    await writeFile(output, 'saved')
    const order: string[] = []
    const binding = {
      gid: '1234567890abcdef',
      output,
      phase: 'ready' as RenewalPhase,
    }
    let removed = false
    const engine = {
      getTaskStatus: async () => ({
        status: removed ? TaskStatus.Removed : TaskStatus.Paused,
        connections: 0,
      }),
      pauseTask: async () => {
        order.push('pause')
      },
      getCheckpointStatus: async () => {
        order.push('checkpoint')
        return checkpoint
      },
      forceRemoveTask: async () => {
        order.push('remove')
        removed = true
      },
      removeDownloadResult: async () => {
        order.push('retire')
      },
      createDownload: vi.fn(async () => {
        order.push('add')
        return binding.gid
      }),
      resumeTask: vi.fn(async () => {
        order.push('resume')
      }),
    } as unknown as EngineAdapter
    const resource = {
      fileId: 'file1',
      bytes: 5000000000,
      version: 'v1',
      kind: 'original-file' as const,
      url: 'https://invalid.test/a',
      headers: {},
    }
    const input = {
      engine,
      binding,
      persist: async (phase: RenewalPhase) => {
        order.push(`persist:${phase}`)
      },
      resolve: async () => {
        order.push('resolve')
        return { resource, uri: 'http://127.0.0.1/opaque' }
      },
      wait: async () => undefined,
    }
    return { order, input, engine }
  }
  it('checks the saved checkpoint before removal and re-adds the same path and GID', async () => {
    const test = await fixture()
    await renewDownload(test.input)
    expect(test.order.indexOf('checkpoint')).toBeLessThan(
      test.order.indexOf('remove')
    )
    expect(test.order.indexOf('persist:removed')).toBeLessThan(
      test.order.indexOf('remove')
    )
    expect(test.order.indexOf('add')).toBeLessThan(test.order.indexOf('resume'))
    expect(test.engine.createDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gid: test.input.binding.gid,
        filename: 'file.motrix',
        resumePolicy: 'checkpoint',
        pause: true,
      })
    )
  })
  it('never removes or resumes when checkpoint cannot be proved', async () => {
    const test = await fixture('absent')
    await expect(renewDownload(test.input)).rejects.toThrow('cloud.checkpoint')
    expect(test.order.includes('remove')).toBe(false)
    expect(test.engine.resumeTask).not.toHaveBeenCalled()
  })
  it('preserves bytes and blocks after an add failure', async () => {
    const test = await fixture()
    vi.mocked(test.engine.createDownload).mockRejectedValue(new Error('failed'))
    await expect(renewDownload(test.input)).rejects.toThrow('failed')
    expect(test.input.binding.phase).toBe('blocked')
    expect(test.engine.resumeTask).not.toHaveBeenCalled()
  })
})
