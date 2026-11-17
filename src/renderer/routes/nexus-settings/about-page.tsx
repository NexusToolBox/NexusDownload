import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Group,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  DownloadIcon,
} from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { NEXUS_RELEASE_CONFIG } from '@shared/nexus-release-config'
import { NEXUS_VERSION } from '@shared/nexus-version'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import noticesZh from '../../../../THIRD_PARTY_NOTICES.zh-CN.md?raw'
import { useAppUpdate } from '../settings/cards/use-app-update'
import { ReleaseNotes } from './update-ui'

export function NexusAbout() {
  const { t } = useTranslation()
  const update = useAppUpdate()
  const { state } = update
  const [licenses, setLicenses] = useState(false)
  const [notes, setNotes] = useState(false)
  const [restart, setRestart] = useState(false)
  const [failure, setFailure] = useState(false)
  const available = !!state.availableVersion
  const busy = state.phase === 'downloading' || state.phase === 'installing'
  const title = busy
    ? t('nexus.v13.update.downloading')
    : state.phase === 'downloaded'
      ? t('nexus.v13.update.ready')
      : available
        ? t('nexus.v13.update.available', { version: state.availableVersion })
        : t('nexus.v13.update.check')
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
        <Item title={t('nexus.v15.feedback')}>
          <Button
            variant="quiet"
            aria-label={t('nexus.v15.feedback')}
            onClick={() => void transport.invoke(Commands.NexusFeedback)}
          >
            <ArrowUpRightIcon />
          </Button>
        </Item>
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
            <div className="nx-update-inline-progress" role="status">
              <progress
                max={100}
                value={state.progress?.percent ?? 0}
                aria-label={title}
              />
              <span>{Math.floor(state.progress?.percent ?? 0)}%</span>
            </div>
          ) : (
            <>
              {!available && state.phase === 'up-to-date' && (
                <span className="muted">{t('nexus.v13.update.latest')}</span>
              )}
              {available && (
                <Button
                  variant="quiet"
                  aria-expanded={notes}
                  onClick={() => setNotes(!notes)}
                >
                  {t('nexus.v13.update.viewNotes')}
                </Button>
              )}
              <Button
                variant={available ? 'primary' : 'secondary'}
                disabled={state.phase === 'checking'}
                onClick={() => {
                  if (state.phase === 'downloaded') {
                    if (state.activeTasks?.length) setRestart(true)
                    else void update.install()
                  } else if (available) void update.download()
                  else void update.check()
                }}
              >
                {t(
                  available
                    ? state.phase === 'downloaded'
                      ? 'nexus.v13.update.restart'
                      : 'nexus.v13.update.update'
                    : 'nexus.v13.update.checkButton'
                )}
              </Button>
            </>
          )}
        </Item>
        {notes && state.releaseNotes && (
          <ReleaseNotes text={state.releaseNotes} />
        )}
        <Item title={t('nexus.v13.update.website')}>
          <Button
            variant="quiet"
            aria-label={t('nexus.v13.update.website')}
            onClick={() =>
              void transport.invoke(
                Commands.OpenExternal,
                NEXUS_RELEASE_CONFIG.website
              )
            }
          >
            <ArrowUpRightIcon />
          </Button>
        </Item>
        <Item title={t('nexus.v13.update.licenses')}>
          <Button
            variant="quiet"
            aria-label={t('nexus.v13.update.licenses')}
            onClick={() => setLicenses(true)}
          >
            <ChevronRightIcon />
          </Button>
        </Item>
        <Item
          title={t('nexus.v14.diagnostics')}
          description={
            failure
              ? t('nexus.actionFailed')
              : t('nexus.settings.diagnosticsDescription')
          }
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
      <Dialog open={licenses} onOpenChange={setLicenses}>
        <DialogContent>
          <DialogTitle>{t('nexus.v13.update.licenses')}</DialogTitle>
          <div className="nx-license-text">{noticesZh}</div>
        </DialogContent>
      </Dialog>
      <Dialog open={restart} onOpenChange={setRestart}>
        <DialogContent>
          <DialogTitle>
            {t('nexus.v13.update.pauseTasks', {
              count: state.activeTasks?.length ?? 0,
            })}
          </DialogTitle>
          <DialogFooter>
            <Button variant="quiet" onClick={() => setRestart(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setRestart(false)
                void update.install()
              }}
            >
              {t('nexus.v13.update.restart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
