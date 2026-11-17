import {
  Button,
  Group,
  Item,
  Status,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { CloudIcon, LocalDeviceIcon } from '@renderer/components/icons'
import { toast } from '@renderer/components/ui/toast'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloud } from '../nexus-cloud/cloud-client'
import { useNexusWorkspace } from '../nexus-downloads/use-workspace'
import { ServiceSettings } from '../nexus-settings/service-settings'
import { OfflineDownload } from './offline-download'
import { RemoteJobs } from './remote-jobs'
import { RemoteNodes } from './remote-nodes'
import { SpeedProfilesPanel } from './speed-profiles'

export function NexusServicesPage() {
  const { t } = useTranslation()
  const workspace = useNexusWorkspace()
  const cloud = useCloud()
  const [offlineOpen, setOfflineOpen] = useState(false)
  const enabled = workspace?.preferences.offline115 ?? false
  const loggedIn = cloud?.accounts.some(
    (account) =>
      account.platform === '115' &&
      account.state === 'ready' &&
      account.health?.login === 'valid' &&
      !account.needsLocalLogin
  )
  return (
    <div className="page on">
      <header className="phead">
        <h1>{t('nexus.nav.services')}</h1>
      </header>
      <div className="svc overflow-auto">
        <p className="lead">{t('nexus.v11.localDefault')}</p>
        <>
          <Group>
            <Item
              title={t('nexus.services.local')}
              description={t('nexus.v11.localHelp')}
              lead={
                <span className="ft">
                  <LocalDeviceIcon />
                </span>
              }
            >
              <Status>{t('nexus.services.default')}</Status>
            </Item>
            <Item
              title={
                <Button
                  variant="quiet"
                  className="nx-flush-title"
                  onClick={() => setOfflineOpen(true)}
                >
                  {t('nexus.remote.use115')}
                </Button>
              }
              description={t('nexus.v11.offlineHelp')}
              lead={
                <span className="ft">
                  <CloudIcon />
                </span>
              }
            >
              <Status tone={loggedIn ? 'ok' : 'off'}>
                {t(
                  loggedIn
                    ? 'nexus.cloudV2.loggedIn'
                    : 'nexus.cloud.notLoggedIn'
                )}
              </Status>
              <Switch
                aria-label={t('nexus.remote.use115')}
                checked={enabled}
                disabled={!workspace}
                onCheckedChange={(value) => {
                  void transport
                    .invoke(Commands.NexusUpdatePreferences, {
                      offline115: value,
                    })
                    .then(() => {
                      if (value && !loggedIn) setOfflineOpen(true)
                    })
                    .catch(() =>
                      toast.add({
                        type: 'error',
                        title: t('nexus.settings.saveFailed'),
                      })
                    )
                }}
              />
            </Item>
          </Group>
        </>
        <OfflineDownload open={offlineOpen} onOpenChange={setOfflineOpen} />
        <RemoteJobs />
        <RemoteNodes />
        <SpeedProfilesPanel />
        <ServiceSettings />
      </div>
    </div>
  )
}
