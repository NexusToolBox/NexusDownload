import { Button } from '@renderer/components/desktop-kit/nexus'
import { Commands } from '@shared/protocol/commands'
import type { CloudPlatform } from '@shared/schemas/nexus-cloud'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cloudCall, cloudError } from './cloud-client'
import { CloudLoginButton } from './cloud-login-button'

export function CloudRecoveryButton({
  platform,
  accountId,
  reason,
  onError,
}: {
  platform: CloudPlatform
  accountId?: string
  reason: string
  onError(kind: string): void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  if (reason === 'rate') return null
  if (accountId && ['permission', 'network', 'headers'].includes(reason))
    return (
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void cloudCall(Commands.NexusCloudHealth, accountId)
            .catch((error) => onError(cloudError(error)))
            .finally(() => setBusy(false))
        }}
      >
        {t('nexus.v14.checkAccount')}
      </Button>
    )
  return (
    <CloudLoginButton
      platform={platform}
      accountId={accountId}
      onError={onError}
      label={t(
        ['captcha', 'risk'].includes(reason)
          ? 'nexus.v14.verify'
          : 'nexus.cloudV2.login'
      )}
    />
  )
}
