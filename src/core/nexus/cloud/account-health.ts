import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { type CloudAdapter, CloudError } from './cloud-adapter'

export async function inspectAccountHealth(
  adapter: CloudAdapter,
  now = Date.now()
): Promise<NonNullable<CloudAccount['health']>> {
  const result: NonNullable<CloudAccount['health']> = {
    checkedAt: now,
    login: 'unknown',
    member: null,
    quota: null,
    platformUsedBytes: null,
    expiresAt: null,
  }
  try {
    await adapter.checkLogin()
    result.login = 'valid'
    if (adapter.health) Object.assign(result, await adapter.health())
    try {
      const quota = await adapter.quota()
      if (
        Number.isSafeInteger(quota.total) &&
        quota.total > 0 &&
        Number.isSafeInteger(quota.used) &&
        quota.used >= 0
      )
        result.quota = quota
    } catch (error) {
      if (
        error instanceof CloudError &&
        ['login', 'login-elsewhere', 'risk', 'rate', 'captcha'].includes(
          error.kind
        )
      )
        throw error
    }
  } catch (error) {
    result.login =
      error instanceof CloudError &&
      ['login', 'login-elsewhere'].includes(error.kind)
        ? 'expired'
        : 'error'
  }
  return result
}

/** Only explicit boolean/0/1 membership flags are accepted; absent fields remain unknown. */
export function membershipFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return null
}
