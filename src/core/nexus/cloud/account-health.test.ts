import { describe, expect, it, vi } from 'vitest'
import { inspectAccountHealth, membershipFlag } from './account-health'
import { type CloudAdapter, CloudError } from './cloud-adapter'

describe('account health evidence', () => {
  it('keeps unsupported data unknown instead of claiming zero or membership', async () => {
    const result = await inspectAccountHealth(
      {
        checkLogin: async () => {},
        quota: async () => {
          throw new CloudError('unsupported')
        },
      } as unknown as CloudAdapter,
      123
    )
    expect(result).toEqual({
      checkedAt: 123,
      login: 'valid',
      member: null,
      quota: null,
      platformUsedBytes: null,
      expiresAt: null,
    })
    expect([undefined, null, 'vip', 5].map(membershipFlag)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })
  it('distinguishes expired login from a network error and never probes quota after failed authentication', async () => {
    const quota = vi.fn()
    const adapter = {
      checkLogin: async () => {
        throw new CloudError('login')
      },
      quota,
    } as unknown as CloudAdapter
    expect((await inspectAccountHealth(adapter)).login).toBe('expired')
    expect(quota).not.toHaveBeenCalled()
    adapter.checkLogin = async () => {
      throw new CloudError('network')
    }
    expect((await inspectAccountHealth(adapter)).login).toBe('error')
  })
})
