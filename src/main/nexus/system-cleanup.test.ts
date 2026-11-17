import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  target: '',
  exists: false,
  failure: null as Error | null,
  remove: vi.fn(),
  login: vi.fn(),
  protocol: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\Profile',
    setLoginItemSettings: state.login,
    isDefaultProtocolClient: (protocol: string) => protocol === 'magnet',
    removeAsDefaultProtocolClient: state.protocol,
  },
  shell: { readShortcutLink: () => ({ target: state.target }) },
}))
vi.mock('node:fs', () => ({ existsSync: () => state.exists }))
vi.mock('node:fs/promises', () => ({ unlink: state.remove }))
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    state.execute(...args.slice(0, -1))
    const callback = args.at(-1) as (
      error: Error | null,
      stdout: string,
      stderr: string
    ) => void
    callback(state.failure, '', '')
  },
}))

import { clearSystemRemnants } from './system-cleanup'

beforeEach(() => {
  vi.clearAllMocks()
  state.target = process.execPath
  state.failure = null
})
describe.skipIf(process.platform !== 'win32')(
  'system cleanup ownership',
  () => {
    it('removes its own shortcut and owned protocol and registry entries', async () => {
      await clearSystemRemnants()
      expect(state.remove).toHaveBeenCalledWith(
        expect.stringContaining('NexusDownload.lnk')
      )
      expect(state.login).toHaveBeenCalledWith({ openAtLogin: false })
      expect(state.protocol.mock.calls).toEqual([['magnet']])
      const script = Buffer.from(
        state.execute.mock.calls[0][1][3],
        'base64'
      ).toString('utf16le')
      expect(script).toContain("$value.ProgId -like 'NexusDownload.*'")
      expect(script).toContain('NexusDownload.File.Torrent')
      expect(script).not.toContain('HKLM:')
    })
    it('leaves a shortcut owned by another executable alone', async () => {
      state.target = 'C:\\Other\\Tool.exe'
      await clearSystemRemnants()
      expect(state.remove).not.toHaveBeenCalled()
    })
    it('reports incomplete cleanup to the caller', async () => {
      state.failure = new Error('registry denied')
      await expect(clearSystemRemnants()).rejects.toThrow('registry denied')
    })
  }
)
