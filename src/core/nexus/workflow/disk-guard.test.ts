import { expect, it, vi } from 'vitest'
import { DiskGuard } from './disk-guard'

it('blocks unknown and low space, allows recovery and accounts for expanded bytes', () => {
  let free: number | null = null
  const changed = vi.fn()
  const guard = new DiskGuard(
    () => 500,
    changed,
    (directory) => ({
      directory,
      volume: 'test',
      freeBytes: free,
      totalBytes: 10000,
    })
  )
  expect(guard.available('test')).toBe(false)
  free = 600
  expect(guard.available('test', 200)).toBe(false)
  expect(guard.available('test')).toBe(true)
  expect(guard.snapshot().diskBlocked).toEqual([])
  expect(changed).toHaveBeenCalledTimes(2)
})
