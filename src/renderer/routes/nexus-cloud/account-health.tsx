import { Button } from '@renderer/components/desktop-kit/nexus'
import { Commands } from '@shared/protocol/commands'
import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { formatBytes } from '@shared/utils/format-bytes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cloudCall, cloudError } from './cloud-client'

export function AccountHealth({
  account,
  onError,
}: {
  account: CloudAccount
  onError: (kind: string) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const health = account.health
  return (
    <section
      className="nexus-account-health mt-4 space-y-3"
      aria-label={t('nexus.cloudV3.health')}
    >
      <dl className="gov">
        {health?.member != null && (
          <div>
            <dt>{t('nexus.cloudV3.member')}</dt>
            <dd>
              {t(
                health.member
                  ? 'nexus.cloudV3.memberYes'
                  : 'nexus.cloudV3.memberNo'
              )}
            </dd>
          </div>
        )}
        {health?.quota && (
          <div>
            <dt>{t('nexus.cloudV3.space')}</dt>
            <dd>
              {formatBytes(health.quota.used)} /{' '}
              {formatBytes(health.quota.total)}
            </dd>
          </div>
        )}
        {health?.platformUsedBytes != null && health.platformUsedBytes > 0 && (
          <div>
            <dt>{t('nexus.cloudV3.todayBytes')}</dt>
            <dd>{formatBytes(health.platformUsedBytes)}</dd>
          </div>
        )}
        {account.recentRiskAt && (
          <div>
            <dt>{t('nexus.cloudV3.riskAt')}</dt>
            <dd>{new Date(account.recentRiskAt).toLocaleString()}</dd>
          </div>
        )}
        {!!account.temporaryCount && (
          <div>
            <dt>{t('nexus.cloudV3.temporaryCount')}</dt>
            <dd>{account.temporaryCount}</dd>
          </div>
        )}
      </dl>
      {health?.login === 'expired' && (
        <p role="alert">{t('nexus.cloudV3.expiredWarning')}</p>
      )}
      {account.authorization === 'share' && (
        <p>{t('nexus.cloudError.open-platform')}</p>
      )}
      <Button
        variant="ghost"
        disabled={busy || account.state === 'paused'}
        onClick={() => {
          setBusy(true)
          void cloudCall(Commands.NexusCloudHealth, account.id)
            .catch((e) => onError(cloudError(e)))
            .finally(() => setBusy(false))
        }}
      >
        {t(busy ? 'nexus.preflight.working' : 'nexus.cloudV3.checkHealth')}
      </Button>
    </section>
  )
}
