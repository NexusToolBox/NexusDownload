import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Group,
  IconButton,
  Input,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import { MoreIcon } from '@renderer/components/icons'
import { Commands } from '@shared/protocol/commands'
import type { CloudPlatform } from '@shared/schemas/nexus-cloud'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AliyunLoginButton } from './aliyun-login-button'
import { cloudCall, cloudError } from './cloud-client'

export function CloudLoginButton({
  platform,
  accountId,
  disabled = false,
  onError,
  onSuccess,
  label,
  primary = false,
}: {
  platform: CloudPlatform
  accountId?: string
  disabled?: boolean
  onError: (kind: string) => void
  onSuccess?: () => void
  primary?: boolean
  label?: string
}) {
  const { t } = useTranslation()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const login = async (passwordMode = false) => {
    setBusy(true)
    try {
      await cloudCall(
        Commands.NexusCloudLogin,
        accountId
          ? {
              accountId,
              credentials: passwordMode
                ? { platform, account, password }
                : platform,
            }
          : passwordMode
            ? { platform, account, password }
            : platform
      )
      setOpen(false)
      setAccount('')
      onSuccess?.()
    } catch (error) {
      onError(cloudError(error))
    } finally {
      setPassword('')
      setBusy(false)
    }
  }
  if (platform === 'aliyun')
    return (
      <AliyunLoginButton
        accountId={accountId}
        disabled={disabled}
        onError={onError}
        onSuccess={onSuccess}
        primary={primary}
      />
    )
  return (
    <>
      <Button
        variant={primary ? 'primary' : 'ghost'}
        disabled={disabled || busy}
        onClick={() => void login()}
      >
        {label ||
          t(
            busy
              ? 'nexus.preflight.working'
              : accountId
                ? 'nexus.cloudV3.reauthorize'
                : 'nexus.cloudV2.login'
          )}
      </Button>
      {platform === '123' && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                aria-label={t('nexus.more')}
                disabled={disabled || busy}
              >
                <MoreIcon />
              </IconButton>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setOpen(true)}>
              {t('nexus.v11.otherLogin')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value)
            setPassword('')
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t('nexus.cloudV3.login123')}</DialogTitle>
          <DialogDescription>
            {t('nexus.cloudV3.passwordHelp')}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void login(true)
            }}
          >
            <Group>
              <Item
                title={
                  <label htmlFor={`${uid}-account`}>
                    {t('nexus.cloudV3.account')}
                  </label>
                }
              >
                <Input
                  id={`${uid}-account`}
                  autoComplete="username"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  maxLength={254}
                  required
                  disabled={busy}
                />
              </Item>
              <Item
                title={
                  <label htmlFor={`${uid}-password`}>
                    {t('nexus.cloudV3.password')}
                  </label>
                }
              >
                <Input
                  id={`${uid}-password`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={256}
                  required
                  disabled={busy}
                />
              </Item>
            </Group>
            <DialogFooter>
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !account.trim() || !password}
              >
                {t(
                  busy
                    ? 'nexus.preflight.working'
                    : accountId
                      ? 'nexus.cloudV3.reauthorize'
                      : platform === '123'
                        ? 'nexus.cloudV3.login123'
                        : 'nexus.cloudV2.login'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
