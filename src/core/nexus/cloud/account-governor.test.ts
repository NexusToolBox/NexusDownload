import { expect, it, vi } from 'vitest'
import { AccountGovernor, type GovernorState } from './account-governor'

it('persists frequency preferences across reload and a daily reset', async () => {
  let now = Date.UTC(2026, 10, 17)
  let saved: GovernorState | undefined
  const persist = vi.fn(async (_id: string, state: GovernorState) => {
    saved = state
  })
  const wait = vi.fn(async (ms: number) => {
    now += ms
  })
  const options = { persist, pause: vi.fn(), now: () => now, wait }
  const first = new AccountGovernor(options)
  await first.setProfile('account', 'conservative')
  const next = new AccountGovernor(options)
  next.load('account', saved as GovernorState)
  await next.run('account', 'quark', 'request', async () => {})
  await next.run('account', 'quark', 'request', async () => {})
  expect(wait).toHaveBeenLastCalledWith(2000)
  now += 86400000
  expect(next.snapshot('account', 'quark')).toMatchObject({
    governor: 'conservative',
    requests: 0,
    transferLimit: 20,
  })
  await next.setProfile('account', 'standard')
  expect(next.snapshot('account', 'quark').transferLimit).toBe(100)
})
it('keeps platform defaults when loading preferences without a profile', () => {
  const governor = new AccountGovernor({ persist: vi.fn(), pause: vi.fn() })
  expect(governor.snapshot('first', 'baidu').governor).toBe('conservative')
  expect(governor.snapshot('second', 'quark').governor).toBe('standard')
})
