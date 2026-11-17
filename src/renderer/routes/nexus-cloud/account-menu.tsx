import {
  Banner,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Group,
  IconButton,
  Input,
  Item,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { MoreIcon } from '@renderer/components/icons'
import { Commands } from '@shared/protocol/commands'
import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cloudCall, cloudError } from './cloud-client'
import { CloudLoginButton } from './cloud-login-button'

export function AccountMenu({
  account,
  onError,
}: {
  account: CloudAccount
  onError(kind: string): void
}) {
  const { t } = useTranslation()
  const [edit, setEdit] = useState(false)
  const [login, setLogin] = useState(false)
  const [note, setNote] = useState('')
  const [transfer, setTransfer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (
    command: Parameters<typeof cloudCall>[0],
    payload: unknown
  ) => {
    setBusy(true)
    setError('')
    try {
      await cloudCall(command, payload)
      setEdit(false)
    } catch (err) {
      const kind = cloudError(err)
      onError(kind)
      setError(kind)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton aria-label={t('nexus.more')} disabled={busy}>
              <MoreIcon />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setNote(account.note ?? '')
              setTransfer(account.transferOnly ?? false)
              setError('')
              setEdit(true)
            }}
          >
            {t('nexus.cloudV3.note')}
          </DropdownMenuItem>
          {!['123', 'aliyun'].includes(account.platform) && (
            <DropdownMenuItem
              onClick={() =>
                void run(Commands.NexusCloudUpdateAccount, {
                  id: account.id,
                  transferOnly: !account.transferOnly,
                  note: account.note ?? '',
                })
              }
            >
              {t(
                account.transferOnly
                  ? 'nexus.v12.unsetTransferOnly'
                  : 'nexus.v12.transferOnly'
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => void run(Commands.NexusCloudHealth, account.id)}
          >
            {t('nexus.v11.detect')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              if (account.platform === 'aliyun') setLogin(true)
              else
                void run(Commands.NexusCloudLogin, {
                  accountId: account.id,
                  credentials: account.platform,
                })
            }}
          >
            {t('nexus.cloudV3.reauthorize')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('nexus.v14.frequency')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={account.governor}
            onValueChange={(value) => {
              if (value === 'standard' || value === 'conservative')
                void run(Commands.NexusCloudUpdateAccount, {
                  id: account.id,
                  note: account.note ?? '',
                  transferOnly: account.transferOnly ?? false,
                  governor: value,
                })
            }}
          >
            {(['standard', 'conservative'] as const).map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {t(`nexus.cloudV2.${value}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void run(Commands.NexusCloudLogout, account.id)}
          >
            {t('nexus.cloudV2.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={edit}
        onOpenChange={(value) => {
          if (!busy) setEdit(value)
        }}
      >
        <DialogContent>
          <DialogTitle>{t('nexus.cloudV3.edit')}</DialogTitle>
          <Group>
            <Item title={t('nexus.cloudV3.note')}>
              <Input
                aria-label={t('nexus.cloudV3.note')}
                value={note}
                maxLength={128}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </Item>
            {!['123', 'aliyun'].includes(account.platform) && (
              <Item title={t('nexus.cloudV3.transferOnly')}>
                <Switch
                  aria-label={t('nexus.cloudV3.transferOnly')}
                  checked={transfer}
                  disabled={
                    busy || ['123', 'aliyun'].includes(account.platform)
                  }
                  onCheckedChange={setTransfer}
                />
              </Item>
            )}
          </Group>
          {error && <Banner>{t(`nexus.cloudError.${error}`)}</Banner>}
          <DialogFooter>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => setEdit(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(Commands.NexusCloudUpdateAccount, {
                  id: account.id,
                  note,
                  transferOnly: transfer,
                })
              }
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={login} onOpenChange={setLogin}>
        <DialogContent>
          <DialogTitle>{t('nexus.cloudV3.reauthorize')}</DialogTitle>
          <Group>
            <Item title={t(`nexus.platform.${account.platform}`)}>
              <CloudLoginButton
                platform={account.platform}
                accountId={account.id}
                onError={onError}
                onSuccess={() => setLogin(false)}
              />
            </Item>
          </Group>
        </DialogContent>
      </Dialog>
    </>
  )
}
