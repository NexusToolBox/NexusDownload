import { Chip, Item, Status } from '@renderer/components/desktop-kit/nexus'
import {
  AccountAvatar,
  accountName,
  PlatformLogo,
} from '@renderer/components/desktop-kit/nexus/platform-logo'
import type { CloudAccount, CloudPlatform } from '@shared/schemas/nexus-cloud'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccountMenu } from './account-menu'
import { CloudLoginButton } from './cloud-login-button'
import { CloudRecoveryButton } from './recovery-button'
export function AccountRow({
  platform,
  account,
  sub = false,
}: {
  platform: CloudPlatform
  account?: CloudAccount
  sub?: boolean
}) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const reason =
    error ||
    account?.reason ||
    (account?.health?.login === 'error'
      ? 'network'
      : account?.health?.login === 'expired'
        ? 'login'
        : '')
  return (
    <Item
      sub={sub}
      lead={
        account ? (
          <AccountAvatar account={account} />
        ) : (
          <PlatformLogo platform={platform} />
        )
      }
      title={
        <>
          {account
            ? accountName(account, t(`nexus.platform.${platform}`))
            : t(`nexus.platform.${platform}`)}
          {account?.health?.member && (
            <Chip>{t('nexus.cloudV3.memberYes')}</Chip>
          )}
        </>
      }
      description={
        account?.needsLocalLogin
          ? t('nexus.v13.localLogin')
          : reason
            ? `${t(`nexus.platform.${platform}`)}，${t(`nexus.cloudError.${reason}`)}`
            : account
              ? `${t(`nexus.platform.${platform}`)}${account.note ? ` · ${account.note}` : ''}`
              : platform === 'aliyun'
                ? t('nexus.cloudError.open-platform')
                : undefined
      }
    >
      {account && !reason && <Status label={t('nexus.v12.normal')} />}
      {!account && (
        <CloudLoginButton
          platform={platform}
          onError={setError}
          onSuccess={() => setError('')}
        />
      )}
      {account && reason && (
        <CloudRecoveryButton
          platform={platform}
          accountId={account.id}
          reason={reason}
          onError={setError}
        />
      )}
      {account && <AccountMenu account={account} onError={setError} />}
    </Item>
  )
}
