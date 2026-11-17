import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { locateFfmpeg } from './ffmpeg-locator'

describe('locateFfmpeg', () => {
  it('returns the resolved PATH binary without probing its version', async () => {
    const resolveExecutable = vi.fn(async (p: string) =>
      p === 'ffmpeg' ? path.resolve('/usr/local/bin/ffmpeg') : null
    )
    const r = await locateFfmpeg(
      {
        manualPath: '',
        userDataBinariesDir: path.resolve('/x'),
        platform: 'linux',
        envPath: null,
      },
      resolveExecutable
    )
    expect(r.available).toBe(true)
    expect(r.binaryPath).toBe(path.resolve('/usr/local/bin/ffmpeg'))
    expect(r.version).toBeNull()
    expect(resolveExecutable).toHaveBeenCalledWith(path.resolve('/x/ffmpeg'))
    expect(resolveExecutable).toHaveBeenCalledWith('ffmpeg')
  })

  it('preserves manual, user data, environment, then PATH priority', async () => {
    const resolveExecutable = vi.fn(async (candidate: string) =>
      candidate === path.resolve('/environment/ffmpeg') ? candidate : null
    )
    const r = await locateFfmpeg(
      {
        manualPath: path.resolve('/manual/ffmpeg'),
        userDataBinariesDir: path.resolve('/user-data/binaries'),
        platform: 'linux',
        envPath: path.resolve('/environment/ffmpeg'),
      },
      resolveExecutable
    )

    expect(r).toEqual({
      available: true,
      binaryPath: path.resolve('/environment/ffmpeg'),
      version: null,
    })
    expect(
      resolveExecutable.mock.calls.map(([candidate]) => candidate)
    ).toEqual([
      path.resolve('/manual/ffmpeg'),
      path.resolve('/user-data/binaries/ffmpeg'),
      path.resolve('/environment/ffmpeg'),
    ])
  })

  it('reports unavailable when no executable path resolves', async () => {
    const resolveExecutable = vi.fn(async () => null)
    const r = await locateFfmpeg(
      {
        manualPath: '',
        userDataBinariesDir: path.resolve('/x'),
        platform: 'linux',
        envPath: null,
      },
      resolveExecutable
    )
    expect(r.available).toBe(false)
    expect(r.binaryPath).toBeNull()
    expect(r.version).toBeNull()
  })
})
