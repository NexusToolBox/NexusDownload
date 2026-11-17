import type { CloudAccount, CloudMethod } from '@shared/schemas/nexus-cloud'
import { CloudError } from './cloud-adapter'

/** Stable order breaks ties. A designated transfer account never silently falls back to a main account. */
export function chooseCloudAccount(
  accounts: CloudAccount[],
  method: CloudMethod,
  requiredBytes = 0,
  count = 0
) {
  const dedicated =
    method === 'save' ? accounts.find((a) => a.transferOnly) : undefined
  const candidates = (dedicated ? [dedicated] : accounts).filter(
    (a) =>
      a.state === 'ready' &&
      a.health?.login !== 'expired' &&
      (method !== 'save' || a.transferLimit - a.transfers >= count) &&
      (method !== 'save' ||
        !a.health?.quota ||
        a.health.quota.total - a.health.quota.used >= requiredBytes)
  )
  candidates.sort(
    (a, b) =>
      Number(b.health?.member === true) - Number(a.health?.member === true) ||
      Number(
        !!b.health?.quota &&
          b.health.quota.total - b.health.quota.used >= requiredBytes
      ) -
        Number(
          !!a.health?.quota &&
            a.health.quota.total - a.health.quota.used >= requiredBytes
        )
  )
  if (!candidates.length)
    throw new CloudError(
      dedicated?.reason ?? (method === 'save' ? 'space' : 'login')
    )
  return candidates[0]
}
