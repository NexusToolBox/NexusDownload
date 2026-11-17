import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  Group,
  Item,
  Choice as SettingChoice,
} from '@renderer/components/desktop-kit/nexus'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloud } from '../nexus-cloud/cloud-client'
import { CloudLoginButton } from '../nexus-cloud/cloud-login-button'
import { RemoteSubmit } from './remote-jobs'

export function OfflineDownload({
  source = '',
  open,
  onOpenChange,
}: {
  source?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const cloud = useCloud()
  const uid = useId()
  const [id, setId] = useState('')
  const accounts =
    cloud?.accounts.filter(
      (a) => a.platform === '115' && a.state !== 'paused'
    ) ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open === undefined && (
        <DialogTrigger render={<Button size="sm" variant="outline" />}>
          {t('nexus.remote.use115')}
        </DialogTrigger>
      )}
      <DialogContent className="space-y-3">
        <DialogTitle>{t('nexus.remote.use115')}</DialogTitle>
        {accounts.length ? (
          <>
            <label htmlFor={uid}>{t('nexus.cloud.currentAccount')}</label>
            <Group>
              <Item title={t('nexus.cloud.currentAccount')}>
                <SettingChoice
                  id={uid}
                  label={t('nexus.cloud.currentAccount')}
                  value={id || accounts[0].id}
                  onChange={setId}
                  choices={accounts.map((a, i) => ({
                    value: a.id,
                    label:
                      a.note ||
                      t('nexus.cloudV2.accountNumber', { count: i + 1 }),
                  }))}
                />
              </Item>
            </Group>
            <RemoteSubmit
              source={source}
              adapter={`115:${id || accounts[0].id}`}
            />
          </>
        ) : (
          <div className="space-y-3">
            <p>{t('nexus.remote.login115')}</p>
            <CloudLoginButton
              platform="115"
              accountId={
                cloud?.accounts.find((account) => account.platform === '115')
                  ?.id
              }
              onError={() => undefined}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
