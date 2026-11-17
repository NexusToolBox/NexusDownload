import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Queries } from '@shared/protocol/queries'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppUpdate } from '../settings/cards/use-app-update'
import { ReleaseNotes } from './release-notes'

export { ReleaseNotes } from './release-notes'

const OPEN_UPDATE = 'nexus:open-update'
export function openUpdateDialog(completed = false) {
  window.dispatchEvent(new CustomEvent(OPEN_UPDATE, { detail: { completed } }))
}
export function NexusUpdatePill() {
  const { state } = useAppUpdate()
  const { t } = useTranslation()
  const completed = !!(state.completedVersion || state.restoredVersion)
  if (
    !completed &&
    (!state.availableVersion || ['idle', 'up-to-date'].includes(state.phase))
  )
    return null
  const label = completed
    ? t(
        state.restoredVersion
          ? 'nexus.v13.update.restored'
          : 'nexus.v13.update.completed',
        { version: state.completedVersion ?? state.restoredVersion }
      )
    : state.phase === 'downloading'
      ? (state.progress?.transferred ?? 0) > 0
        ? `${t('nexus.v13.update.downloading')} ${Math.floor(state.progress?.percent ?? 0)}%`
        : t('nexus.v152.connecting')
      : state.phase === 'downloaded'
        ? t('nexus.v13.update.ready')
        : t('nexus.v13.update.available', { version: state.availableVersion })
  return (
    <Button
      variant="quiet"
      className="spill"
      onClick={() => openUpdateDialog(completed)}
    >
      {label}
    </Button>
  )
}
export function NexusUpdateBanner() {
  return null
}
export function NexusUpdateDialog() {
  const update = useAppUpdate()
  const { state } = update
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [confirm, setConfirm] = useState<number | null>(null)
  useEffect(() => {
    const show = (event: Event) => {
      setCompleted(Boolean((event as CustomEvent).detail?.completed))
      setConfirm(null)
      setOpen(true)
    }
    window.addEventListener(OPEN_UPDATE, show)
    return () => window.removeEventListener(OPEN_UPDATE, show)
  }, [])
  useEffect(() => {
    if (
      state.phase !== 'available' ||
      !state.automatic ||
      state.prompted ||
      !state.availableVersion
    )
      return
    let pending = false
    let active = true
    const attempt = async () => {
      if (
        pending ||
        document.hidden ||
        document.querySelector('[role="dialog"],[role="alertdialog"]')
      )
        return
      const key = `nexus:update-prompted:${state.availableVersion}`
      if (localStorage.getItem(key)) return
      pending = true
      try {
        const consent = (await transport.invoke(
          Queries.GetDisclaimerState
        )) as { disclaimerAccepted?: boolean }
        if (
          !active ||
          !consent.disclaimerAccepted ||
          document.hidden ||
          document.querySelector('[role="dialog"],[role="alertdialog"]')
        )
          return
        localStorage.setItem(key, '1')
        setCompleted(false)
        setOpen(true)
        await transport.invoke(Commands.NexusUpdateAction, {
          action: 'mark-prompted',
        })
      } finally {
        pending = false
      }
    }
    const timer = setInterval(() => {
      void attempt().catch(() => undefined)
    }, 1000)
    void attempt().catch(() => undefined)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [state.phase, state.automatic, state.prompted, state.availableVersion])
  const ready = state.phase === 'downloaded'
  const downloading =
    state.phase === 'downloading' || state.phase === 'installing'
  const received = (state.progress?.transferred ?? 0) > 0
  const count = state.activeTasks?.length ?? 0
  const version = completed
    ? (state.completedVersion ?? state.restoredVersion)
    : state.availableVersion
  const close = () => {
    setOpen(false)
    setConfirm(null)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent className="nx-update-dialog" initialFocus={false}>
        <div className="nx-update-head">
          <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="" />
          <div>
            <DialogTitle>
              {completed
                ? t('nexus.v13.update.completed', { version })
                : `NexusDownload ${version ?? state.currentVersion}`}
            </DialogTitle>
            <div className="nx-update-meta">
              {ready ? (
                t('nexus.v152.downloadComplete')
              ) : completed ? null : (
                <>
                  <Chip tone="live">{t('nexus.v152.newVersion')}</Chip>
                  {state.publishedAt && (
                    <time dateTime={state.publishedAt}>
                      {new Date(state.publishedAt).toLocaleDateString(
                        i18n.resolvedLanguage,
                        { month: 'short', day: 'numeric' }
                      )}
                    </time>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <ReleaseNotes
          text={
            completed
              ? (state.completedReleaseNotes ?? state.releaseNotes)
              : state.releaseNotes
          }
        />
        {state.error && (
          <p role="alert">
            {t(
              `nexus.v13.update.error.${state.error.message.split('.').at(-1)}`,
              { defaultValue: t('nexus.v13.update.error.download') }
            )}
          </p>
        )}
        {confirm !== null && ready && !completed && (
          <p className="nx-update-confirm">
            {t('nexus.v13.update.pauseTasks', { count })}
          </p>
        )}
        <DialogFooter>
          {completed ? (
            <Button variant="primary" onClick={close}>
              {t('nexus.v152.ok')}
            </Button>
          ) : downloading ? (
            <>
              <div className="nx-update-progress" role="status">
                {received ? (
                  <>
                    <progress
                      max={100}
                      value={state.progress?.percent ?? 0}
                      aria-label={t('nexus.v13.update.downloading')}
                    />
                    <span>{Math.floor(state.progress?.percent ?? 0)}%</span>
                  </>
                ) : (
                  <span>{t('nexus.v152.connecting')}</span>
                )}
              </div>
              {state.browserFallback && state.releaseUrl && (
                <Button
                  variant="quiet"
                  onClick={() =>
                    void transport.invoke(
                      Commands.OpenExternal,
                      state.releaseUrl
                    )
                  }
                >
                  {t('nexus.v152.browserDownload')}
                </Button>
              )}
              <Button variant="quiet" onClick={close}>
                {t('nexus.v152.background')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="quiet" onClick={close}>
                {t(ready ? 'nexus.v152.later' : 'nexus.v152.notNow')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (ready) {
                    if (count && confirm !== count) setConfirm(count)
                    else void update.install()
                  } else void update.download()
                }}
              >
                {t(
                  ready ? 'nexus.v13.update.restart' : 'nexus.v13.update.update'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
