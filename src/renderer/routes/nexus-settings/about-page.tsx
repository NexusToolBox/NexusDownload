import { Button, Group, Item } from '@renderer/components/desktop-kit/nexus'
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  DownloadIcon,
} from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { getNexusWebsiteUrl } from '@shared/nexus-release-config'
import { NEXUS_VERSION } from '@shared/nexus-version'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAppUpdate } from '../settings/cards/use-app-update'
import { openUpdateDialog } from './update-ui'
export function NexusAbout() {
  const { t, i18n } = useTranslation()
  const [, setParams] = useSearchParams()
  const update = useAppUpdate()
  const { state } = update
  const [failure, setFailure] = useState(false)
  const available = !!state.availableVersion
  const busy = state.phase === 'downloading' || state.phase === 'installing'
  const ready = state.phase === 'downloaded'
  const title = busy
    ? t('nexus.v13.update.downloading')
    : ready
      ? t('nexus.v13.update.ready')
      : available
        ? t('nexus.v13.update.available', { version: state.availableVersion })
        : t('nexus.v13.update.check')
  const external = (url: string) =>
    void transport.invoke(Commands.OpenExternal, url)
  return (
    <div className="nx-about">
      <div className="nx-about-head">
        <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="" />
        <div>
          <h2>NexusDownload</h2>
          <p>{t('nexus.v13.update.version', { version: NEXUS_VERSION })}</p>
        </div>
      </div>
      <Group>
        <Item
          title={title}
          description={
            state.error
              ? t(
                  `nexus.v13.update.error.${state.error.message.split('.').at(-1)}`,
                  { defaultValue: t('nexus.v13.update.error.install') }
                )
              : undefined
          }
        >
          {busy ? (
            <Button
              variant="quiet"
              className="nx-update-inline-progress"
              onClick={() => openUpdateDialog()}
            >
              {(state.progress?.transferred ?? 0) > 0 ? (
                <>
                  <progress
                    max={100}
                    value={state.progress?.percent ?? 0}
                    aria-label={title}
                  />
                  <span>{Math.floor(state.progress?.percent ?? 0)}%</span>
                </>
              ) : (
                t('nexus.v152.connecting')
              )}
            </Button>
          ) : (
            <>
              {!available && state.phase === 'up-to-date' && (
                <span className="muted">{t('nexus.v13.update.latest')}</span>
              )}
              {available && (
                <Button variant="quiet" onClick={() => openUpdateDialog()}>
                  {t('nexus.v13.update.viewNotes')}
                </Button>
              )}
              <Button
                variant={available ? 'primary' : 'secondary'}
                disabled={state.phase === 'checking'}
                onClick={() => {
                  if (available) {
                    openUpdateDialog()
                    if (!ready) void update.download()
                  } else void update.check()
                }}
              >
                {t(
                  available
                    ? ready
                      ? 'nexus.v13.update.restart'
                      : 'nexus.v13.update.update'
                    : 'nexus.v13.update.checkButton'
                )}
              </Button>
            </>
          )}
        </Item>
        <Item title={t('nexus.v13.update.website')}>
          <Button
            variant="quiet"
            aria-label={t('nexus.v13.update.website')}
            onClick={() =>
              external(
                getNexusWebsiteUrl(i18n.resolvedLanguage ?? i18n.language)
              )
            }
          >
            <ArrowUpRightIcon />
          </Button>
        </Item>
        <Item title={t('nexus.v15.feedback')}>
          <Button
            variant="quiet"
            aria-label={t('nexus.v15.feedback')}
            onClick={() => void transport.invoke(Commands.NexusFeedback)}
          >
            <ArrowUpRightIcon />
          </Button>
        </Item>
        <Item title={t('nexus.v13.update.licenses')}>
          <Button
            variant="quiet"
            aria-label={t('nexus.v13.update.licenses')}
            onClick={() => setParams({ section: 'about', licenses: 'main' })}
          >
            <ChevronRightIcon />
          </Button>
        </Item>
        <Item
          title={t('nexus.settings.exportDiagnostics')}
          description={failure ? t('nexus.actionFailed') : undefined}
        >
          <Button
            variant="quiet"
            aria-label={t('nexus.settings.exportDiagnostics')}
            onClick={() => {
              setFailure(false)
              void transport
                .invoke(Commands.NexusExportDiagnostics)
                .catch(() => setFailure(true))
            }}
          >
            <DownloadIcon />
          </Button>
        </Item>
      </Group>
    </div>
  )
}
