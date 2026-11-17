import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Group,
  Input,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { AdvancedGroup } from '../nexus-settings/advanced-group'
import { cloudCall, cloudError } from './cloud-client'

export function KoulingDialog({
  onResolved,
  initialInput = '',
  openOnMount = false,
  onClose,
}: {
  onResolved: (input: string) => void
  initialInput?: string
  openOnMount?: boolean
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(openOnMount)
  const [consent, setConsent] = useState(false)
  const [input, setInput] = useState(initialInput)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t('nexus.cloudV2.kouling')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            onClose?.()
            setConsent(false)
            setInput('')
            setKey('')
            setError('')
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t('nexus.cloudV2.kouling')}</DialogTitle>
          <DialogDescription>
            {t('nexus.cloudV2.koulingPrivacy')}
          </DialogDescription>
          <Group>
            <Item title={t('nexus.cloudV2.kouling')}>
              <Input
                aria-label={t('nexus.cloudV2.kouling')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={120}
              />
            </Item>
          </Group>
          <AdvancedGroup>
            <Group>
              <Item title={t('nexus.cloudV2.starseaKey')}>
                <Input
                  type="password"
                  aria-label={t('nexus.cloudV2.starseaKey')}
                  placeholder={t('nexus.cloudV2.starseaKey')}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                />
              </Item>
            </Group>
          </AdvancedGroup>
          <label
            htmlFor="nexus-kouling-consent"
            className="flex items-center gap-3"
          >
            <Checkbox
              id="nexus-kouling-consent"
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            />
            {t('nexus.cloudV2.koulingConfirm')}
          </label>
          {error && <p role="alert">{t(`nexus.cloudError.${error}`)}</p>}
          <Button
            size="sm"
            disabled={!consent || !input.trim() || busy}
            onClick={() => {
              setBusy(true)
              setError('')
              void cloudCall(Commands.NexusCloudKouling, {
                input,
                consent,
                serviceKey: key || undefined,
              })
                .then((value) => {
                  const result = z.object({ url: z.string() }).parse(value)
                  onResolved(result.url)
                  setOpen(false)
                  setInput('')
                  setKey('')
                  setConsent(false)
                })
                .catch((e) => setError(cloudError(e)))
                .finally(() => setBusy(false))
            }}
          >
            {t('nexus.cloudV2.convert')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
