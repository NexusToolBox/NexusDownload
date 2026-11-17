import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { describe, expect, it } from 'vitest'
import { chooseCloudAccount } from './account-selector'

function account(id: string, member = false, free = 100): CloudAccount {
  return {
    id,
    platform: '115',
    state: 'ready',
    governor: 'standard',
    requests: 0,
    links: 0,
    transfers: 0,
    transferLimit: 100,
    concurrency: 1,
    health: {
      checkedAt: 1,
      login: 'valid',
      member,
      quota: { total: 100, used: 100 - free },
      platformUsedBytes: null,
      expiresAt: null,
    },
  }
}
describe('account selection policy', () => {
  it('prefers eligible membership then sufficient space without using a paused or expired account', () => {
    const ordinary = account('ordinary')
    const vip = account('vip', true)
    expect(chooseCloudAccount([ordinary, vip], 'without-save').id).toBe('vip')
    vip.health = {
      ...account('sample').health,
      checkedAt: 1,
      login: 'valid',
      member: true,
      quota: { total: 100, used: 99 },
      platformUsedBytes: null,
      expiresAt: null,
    }
    expect(chooseCloudAccount([ordinary, vip], 'save', 50).id).toBe('ordinary')
    vip.state = 'paused'
    expect(chooseCloudAccount([ordinary, vip], 'own').id).toBe('ordinary')
    if (ordinary.health) ordinary.health.login = 'expired'
    expect(() => chooseCloudAccount([ordinary, vip], 'own')).toThrow(
      'cloud.login'
    )
  })
  it('pins transfer operations to the designated account and never spills to the main account', () => {
    const main = account('main', true)
    const transfer = account('transfer')
    transfer.transferOnly = true
    expect(chooseCloudAccount([main, transfer], 'save', 5).id).toBe('transfer')
    transfer.state = 'paused'
    transfer.reason = 'risk'
    expect(() => chooseCloudAccount([main, transfer], 'save', 5)).toThrow(
      'cloud.risk'
    )
    expect(chooseCloudAccount([main, transfer], 'own').id).toBe('main')
  })
  it('enforces per-account transfer budget and stable ties', () => {
    const a = account('a'),
      b = account('b')
    a.transfers = 100
    expect(chooseCloudAccount([a, b], 'save', 1, 1).id).toBe('b')
    expect(chooseCloudAccount([a, b], 'own').id).toBe('a')
  })
})
