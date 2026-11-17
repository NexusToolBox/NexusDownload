import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Group,
  Input,
  Item,
  Choice as SettingChoice,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdvancedGroup } from '../nexus-settings/advanced-group'
import { cloudCall, cloudError } from './cloud-client'

export function AliyunLoginButton({
  disabled,
  accountId,
  onError,
  onSuccess,
  primary = false,
}: {
  disabled: boolean
  accountId?: string
  onError: (kind: string) => void
  onSuccess?: () => void
  primary?: boolean
}) {
  const { t } = useTranslation()
  const redirectUri = 'https://www.alipan.com/o/oauth/callback'
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('official')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const clear = () => {
    setFields({})
    setConsent(false)
    setError('')
  }
  const field = (key: string, secret = false, type = 'text') => (
    <Item
      title={
        <label htmlFor={`${uid}-${key}`}>{t(`nexus.cloudV3.${key}`)}</label>
      }
    >
      <Input
        id={`${uid}-${key}`}
        type={secret ? 'password' : type}
        autoComplete="off"
        value={fields[key] ?? ''}
        disabled={busy}
        required
        maxLength={secret ? 16384 : 2048}
        onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
      />
    </Item>
  )
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const credentials = {
        platform: 'aliyun',
        mode,
        ...(mode === 'official'
          ? {
              clientId: fields.clientId,
              clientSecret: fields.clientSecret,
              redirectUri,
            }
          : mode === 'online'
            ? {
                refreshToken: fields.refreshToken,
                serviceUrl: fields.serviceUrl,
                consent,
              }
            : { refreshToken: fields.refreshToken }),
      }
      await cloudCall(
        Commands.NexusCloudLogin,
        accountId ? { accountId, credentials } : credentials
      )
      setOpen(false)
      clear()
      onSuccess?.()
    } catch (e) {
      const kind = cloudError(e)
      setError(kind)
      onError(kind)
    } finally {
      setFields((v) => ({ ...v, clientSecret: '', refreshToken: '' }))
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant={primary ? 'primary' : 'ghost'}
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        {t(accountId ? 'nexus.cloudV3.reauthorize' : 'nexus.cloudV3.authorize')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value)
            clear()
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogTitle>{t('nexus.cloudV3.aliyunTitle')}</DialogTitle>
          <ol className="nx-setup-steps">
            <li>
              <Button
                variant="quiet"
                onClick={() =>
                  void transport.invoke(
                    Commands.OpenExternal,
                    'https://www.alipan.com/developer/f'
                  )
                }
              >
                {t('nexus.v14.aliyunApply')}
              </Button>
            </li>
            <li>
              {t('nexus.v14.aliyunCallback')}
              <div className="nx-copy-row">
                <code>{redirectUri}</code>
                <Button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(redirectUri)
                      .catch(() => setError('permission'))
                  }
                >
                  {t('nexus.v14.copy')}
                </Button>
              </div>
            </li>
            <li>{t('nexus.v14.aliyunValues')}</li>
          </ol>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Group>
              {mode === 'official' ? (
                <>
                  {field('clientId')}
                  {field('clientSecret', true)}
                </>
              ) : (
                <>
                  {field('refreshToken', true)}
                  {mode === 'online' ? (
                    <>
                      {field('serviceUrl', false, 'url')}
                      <p role="note">{t('nexus.cloudV3.refreshDisclosure')}</p>
                      <Item title={t('nexus.cloudV3.refreshConsent')}>
                        <Switch
                          checked={consent}
                          disabled={busy}
                          onCheckedChange={setConsent}
                          aria-label={t('nexus.cloudV3.refreshConsent')}
                        />
                      </Item>
                    </>
                  ) : (
                    <p>{t('nexus.cloudV3.shareHelp')}</p>
                  )}
                </>
              )}
            </Group>
            <AdvancedGroup>
              {' '}
              <Item
                title={
                  <label htmlFor={`${uid}-mode`}>
                    {t('nexus.cloudV3.authorizationRoute')}
                  </label>
                }
              >
                <SettingChoice
                  id={`${uid}-mode`}
                  className="select w-full"
                  label={t('nexus.cloudV3.authorizationRoute')}
                  disabled={busy}
                  value={mode}
                  choices={['official', 'online', 'share'].map((route) => ({
                    value: route,
                    label: t(`nexus.cloudV3.route.${route}`),
                  }))}
                  onChange={(value) => {
                    setMode(value)
                    clear()
                  }}
                />
              </Item>
            </AdvancedGroup>
            {error && <p role="alert">{t(`nexus.cloudError.${error}`)}</p>}
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
                disabled={busy || (mode === 'online' && !consent)}
              >
                {t(
                  busy ? 'nexus.preflight.working' : 'nexus.cloudV3.authorize'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
