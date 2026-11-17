import { Banner, Button } from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { useTranslation } from 'react-i18next'
import { useAppUpdate } from '../settings/cards/use-app-update'

export function openUpdateDialog() {
  window.location.hash = '/settings?section=about'
}
export function ReleaseNotes({ text }: { text?: string }) {
  const { t } = useTranslation()
  const occurrences = new Map<string, number>()
  return (
    <div className="nx-release-notes">
      {(text || t('nexus.v13.update.noNotes')).split(/\r?\n/).map((line) => {
        const occurrence = (occurrences.get(line) ?? 0) + 1
        occurrences.set(line, occurrence)
        const key = `${line}-${occurrence}`
        const heading = /^#{1,6}\s+(.+)/.exec(line)
        return heading ? (
          <h3 key={key}>{heading[1]}</h3>
        ) : (
          <p key={key}>
            {line.replace(/^[-*]\s+/, '• ').replace(/\*\*([^*]+)\*\*/g, '$1')}
          </p>
        )
      })}
    </div>
  )
}
export function NexusUpdatePill() {
  const { state } = useAppUpdate()
  const { t } = useTranslation()
  if (
    !state.availableVersion ||
    ['idle', 'up-to-date', 'cancelled'].includes(state.phase)
  )
    return null
  return (
    <Button variant="quiet" className="spill" onClick={openUpdateDialog}>
      {t('nexus.v13.update.available', { version: state.availableVersion })}
    </Button>
  )
}
export function NexusUpdateBanner() {
  const { state } = useAppUpdate()
  const { t } = useTranslation()
  if (!state.completedVersion && !state.restoredVersion) return null
  return (
    <Banner
      tone="warn"
      action={
        <>
          <Button variant="quiet" onClick={openUpdateDialog}>
            {t('nexus.v13.update.viewNotes')}
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              void transport.invoke(Commands.NexusUpdateAction, {
                action: 'dismiss-completed',
              })
            }
          >
            {t('common.close')}
          </Button>
        </>
      }
    >
      {state.restoredVersion
        ? t('nexus.v13.update.restored', { version: state.restoredVersion })
        : t('nexus.v13.update.completed', { version: state.completedVersion })}
    </Banner>
  )
}
