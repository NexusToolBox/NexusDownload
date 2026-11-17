import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import { toast } from '@renderer/components/ui/toast'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function SystemCleanup() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <>
      <Item title={t('nexus.v15.cleanup.title')}>
        <Button variant="quiet" onClick={() => setOpen(true)}>
          {t('nexus.v15.cleanup.button')}
        </Button>
      </Item>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogTitle>{t('nexus.v15.cleanup.title')}</DialogTitle>
          <p>{t('nexus.v15.cleanup.description')}</p>
          {failed && <p role="alert">{t('nexus.v15.cleanup.failed')}</p>}
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
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setFailed(false)
                void transport
                  .invoke(Commands.NexusSystemCleanup)
                  .then(() => {
                    setOpen(false)
                    toast.add({
                      title: t('nexus.v15.cleanup.done'),
                      type: 'success',
                    })
                  })
                  .catch(() => setFailed(true))
                  .finally(() => setBusy(false))
              }}
            >
              {t('nexus.v15.cleanup.button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
