import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { type CloudAdapter, CloudError } from './cloud-adapter'

type AccountHealth = NonNullable<CloudAccount['health']>

export async function readAccountDetails(
  adapter: CloudAdapter,
  health: AccountHealth
) {
  const details = await adapter.health?.()
  if (details) {
    health.member = details.member
    health.platformUsedBytes = details.platformUsedBytes ?? null
    health.expiresAt = details.expiresAt ?? null
  }
  const { total, used } = details?.quota ?? (await adapter.quota())
  health.quota =
    Number.isSafeInteger(total) &&
    total > 0 &&
    Number.isSafeInteger(used) &&
    used >= 0
      ? { total, used }
      : null
}

export async function inspectAccountHealth(
  adapter: CloudAdapter,
  now = Date.now(),
  { loginVerified = false } = {}
): Promise<AccountHealth> {
  const result: AccountHealth = {
    checkedAt: now,
    login: 'unknown',
    member: null,
    quota: null,
    platformUsedBytes: null,
    expiresAt: null,
  }
  try {
    if (!loginVerified) await adapter.checkLogin()
    result.login = 'valid'
    try {
      await readAccountDetails(adapter, result)
    } catch (error) {
      if (
        !loginVerified &&
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
