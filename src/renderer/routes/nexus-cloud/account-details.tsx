import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  Group,
  Input,
  Item,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { Commands } from '@shared/protocol/commands'
import type { CloudAccount } from '@shared/schemas/nexus-cloud'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cloudCall, cloudError } from './cloud-client'

export function AccountDetails({
  account,
  onError,
}: {
  account: CloudAccount
  onError: (kind: string) => void
}) {
  const { t } = useTranslation()
  const uid = useId()
  const [note, setNote] = useState(account.note ?? '')
  const [transfer, setTransfer] = useState(account.transferOnly ?? false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setNote(account.note ?? '')
    setTransfer(account.transferOnly ?? false)
  }, [account.note, account.transferOnly])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        {t('nexus.cloudV3.edit')}
      </DialogTrigger>
      <DialogContent className="space-y-3">
        <DialogTitle>{t('nexus.cloudV3.edit')}</DialogTitle>
        <Item title={<label htmlFor={uid}>{t('nexus.cloudV3.note')}</label>}>
          <Input
            id={uid}
            maxLength={128}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </Item>
        <label htmlFor={`${uid}-transfer`} className="flex items-center gap-2">
          <Group>
            <Item title={''}>
              <Switch
                id={`${uid}-transfer`}
                checked={transfer}
                onCheckedChange={setTransfer}
                disabled={
                  busy ||
                  account.platform === '123' ||
                  account.platform === 'aliyun'
                }
              />
            </Item>
          </Group>
          {t('nexus.cloudV3.transferOnly')}
        </label>
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              busy ||
              (note === (account.note ?? '') &&
                transfer === (account.transferOnly ?? false))
            }
            onClick={() => {
              setBusy(true)
              void cloudCall(Commands.NexusCloudUpdateAccount, {
                id: account.id,
                note,
                transferOnly: transfer,
              })
                .then(() => setOpen(false))
                .catch((e) => onError(cloudError(e)))
                .finally(() => setBusy(false))
            }}
          >
            {t('nexus.cloudV3.saveAccount')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
