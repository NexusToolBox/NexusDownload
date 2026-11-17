import { afterEach, expect, it, vi } from 'vitest'
import { NexusGlobalShortcut } from './global-shortcut'

afterEach(() => vi.useRealTimers())
it('registers once, opens the add flow, reports conflicts, and releases only its own shortcut', () => {
  const host = { register: vi.fn(() => true), unregister: vi.fn() }
  const open = vi.fn(),
    changed = vi.fn()
  const shortcut = new NexusGlobalShortcut({ host, open, changed })
  shortcut.apply('Alt+D')
  shortcut.apply('Alt+D')
  expect(host.register).toHaveBeenCalledTimes(1)
  const callback = host.register.mock.calls[0] as unknown as [
    string,
    () => void,
  ]
  callback[1]()
  expect(open).toHaveBeenCalledOnce()
  host.register.mockReturnValueOnce(false)
  shortcut.apply('Ctrl+Alt+N')
  expect(host.unregister).toHaveBeenCalledWith('Alt+D')
  expect(changed).toHaveBeenLastCalledWith(false)
  shortcut.apply('Ctrl+Alt+D')
  shortcut.capture(true)
  expect(changed).toHaveBeenLastCalledWith(null)
  shortcut.capture(false)
  expect(changed).toHaveBeenLastCalledWith(true)
  shortcut.apply('')
  expect(changed).toHaveBeenLastCalledWith(null)
  shortcut.apply('Alt+D')
  shortcut.dispose()
  expect(host.unregister).toHaveBeenLastCalledWith('Alt+D')
})

it('restores registration when recording is interrupted and handles registration exceptions inline', () => {
  vi.useFakeTimers()
  const host = { register: vi.fn(() => true), unregister: vi.fn() },
    changed = vi.fn()
  const shortcut = new NexusGlobalShortcut({ host, changed, open() {} })
  shortcut.apply('Alt+D')
  shortcut.capture(true)
  vi.advanceTimersByTime(30000)
  expect(changed).toHaveBeenLastCalledWith(true)
  host.register.mockImplementationOnce(() => {
    throw new Error('unavailable')
  })
  shortcut.apply('Alt+N')
  expect(changed).toHaveBeenLastCalledWith(false)
  shortcut.dispose()
})
