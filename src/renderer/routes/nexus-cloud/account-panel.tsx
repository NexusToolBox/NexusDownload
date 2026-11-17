import {
  Banner,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Group,
  IconButton,
  Item,
  Meter,
  Status,
} from '@renderer/components/desktop-kit/nexus'
import {
  AccountAvatar,
  accountName,
} from '@renderer/components/desktop-kit/nexus/platform-logo'
import { ChevronDownIcon, RefreshIcon } from '@renderer/components/icons'
import { Commands } from '@shared/protocol/commands'
import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { formatBytes } from '@shared/utils/format-bytes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cloudCall, cloudError } from './cloud-client'
import { CloudLoginButton } from './cloud-login-button'
import { CloudRecoveryButton } from './recovery-button'

export function AccountPanel({
  account,
  accounts,
  onChange,
  onError,
  capabilities,
}: {
  account: CloudAccount
  accounts: CloudAccount[]
  onChange(id: string): void
  onError(kind: string): void
  capabilities: {
    own: boolean
    withoutSave: boolean
    guest: boolean
    save: boolean
  }
}) {
  const { t, i18n } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const reason =
    account.reason ||
    (account.health?.login === 'expired'
      ? 'login'
      : account.health?.login === 'error'
        ? 'network'
        : '')
  const quota = account.health?.quota
  const check = () => {
    setBusy(true)
    void cloudCall(Commands.NexusCloudHealth, account.id)
      .catch((error) => onError(cloudError(error)))
      .finally(() => setBusy(false))
  }
  return (
    <aside
      className="nx-account-panel"
      aria-label={t('nexus.cloud.accountStatus')}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="quiet" className="nx-account-head" />}
        >
          <AccountAvatar account={account} />
          <span className="nx-account-heading">
            <b>
              {accountName(account, t(`nexus.platform.${account.platform}`))}
            </b>
            <small>
              {t(`nexus.platform.${account.platform}`)}
              {account.note ? ` · ${account.note}` : ''}
            </small>
          </span>
          {account.health?.member && (
            <Chip>{t('nexus.cloudV3.memberYes')}</Chip>
          )}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {accounts.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => onChange(item.id)}>
              <AccountAvatar account={item} />{' '}
              {accountName(item, t(`nexus.platform.${item.platform}`))}
              {item.id === account.id && ' ✓'}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAdding(true)}>
            {t('nexus.v11.addAccount')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {quota ? (
        <Meter
          used={quota.used}
          total={quota.total}
          label={t('nexus.v12.capacity', {
            used: formatBytes(quota.used),
            total: formatBytes(quota.total),
          })}
        />
      ) : null}
      {reason ? (
        <Banner
          action={
            <CloudRecoveryButton
              reason={reason}
              platform={account.platform}
              accountId={account.id}
              onError={onError}
            />
          }
        >
          {t(
            account.needsLocalLogin
              ? 'nexus.v13.localLogin'
              : `nexus.cloudError.${reason}`
          )}
        </Banner>
      ) : (
        <div className="nx-account-health">
          <span className="inline-flex items-center gap-2" role="status">
            <Status label={t('nexus.v12.normal')} />
            <span>
              {t('nexus.v12.normal')}
              {account.health?.checkedAt
                ? ` · ${new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: '2-digit', minute: '2-digit', hour12: false }).format(account.health.checkedAt)}`
                : ''}
            </span>
          </span>
          <IconButton
            aria-label={t('nexus.v11.detect')}
            disabled={busy}
            onClick={check}
          >
            <RefreshIcon />
          </IconButton>
        </div>
      )}
      <div>
        <p className="nx-account-caption">{t('nexus.cloud.capabilities')}</p>
        <div className="nx-account-capabilities">
          {(['own', 'without-save', 'save'] as const)
            .filter(
              (method) =>
                (method !== 'own' || account.authorization !== 'share') &&
                capabilities[method === 'without-save' ? 'withoutSave' : method]
            )
            .map((method) => (
              <Chip key={method}>{t(`nexus.v13.capability.${method}`)}</Chip>
            ))}
          {account.platform === '115' && account.health?.login === 'valid' && (
            <Chip>{t('nexus.v13.capability.offline')}</Chip>
          )}
        </div>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogTitle>{t('nexus.v11.addAccount')}</DialogTitle>
          <Group>
            <Item title={t(`nexus.platform.${account.platform}`)}>
              <CloudLoginButton
                platform={account.platform}
                onError={onError}
                onSuccess={() => setAdding(false)}
              />
            </Item>
          </Group>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
