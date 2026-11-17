import {
  Banner,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Group,
  IconButton,
  Input,
  Item,
  Section,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { CloseIcon } from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import type { ProcessingRecord } from '@shared/schemas/nexus-processing'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueues, workflowCall } from '../nexus-settings/queue-settings'
export function useProcessing() {
  const [records, setRecords] = useState<ProcessingRecord[]>([])
  useEffect(() => {
    let revision = 0
    let alive = true
    const load = () => {
      const current = ++revision
      void transport
        .invoke(Queries.GetNexusWorkflow)
        .then((raw) => {
          if (alive && current === revision)
            setRecords(
              (raw as { processing: ProcessingRecord[] }).processing ?? []
            )
        })
        .catch(() => undefined)
    }
    transport.on(Events.NexusWorkspaceChanged, load)
    const detach = transport.onConnectionChange?.((e) => {
      if (e.state === 'connected') load()
    })
    load()
    return () => {
      alive = false
      transport.off(Events.NexusWorkspaceChanged, load)
      detach?.()
    }
  }, [])
  return records
}
export function ProcessingSteps({
  taskId,
  completed,
}: {
  taskId: string
  completed: boolean
}) {
  const { t } = useTranslation()
  const records = useProcessing()
  const record = records.find((r) => r.taskIds.includes(taskId))
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const run = (req: unknown) =>
    void workflowCall(req).catch(() => setError(t('nexus.v4.workflow.failed')))
  const steps = record?.steps.filter(
    (step) =>
      step.status !== 'skipped' &&
      step.name !== 'notify' &&
      (step.name !== 'organize' || Boolean(record.moves.length)) &&
      (step.name !== 'verify' || Boolean(record.config.sha256))
  )
  if (!steps?.length && completed) return null
  return (
    <Section title={t('nexus.v4.processing.title')}>
      <Group>
        {!record && !completed && (
          <Item title={t('nexus.v4.extractPackage')}>
            <Switch
              id={`extract-task-${taskId}`}
              onCheckedChange={(extract) =>
                run({
                  action: 'processing-save',
                  id: taskId,
                  config: { extract, trashArchives: false },
                })
              }
            />
          </Item>
        )}
        {steps?.map((s) => (
          <Item
            key={s.name}
            title={`${t(`nexus.v4.processing.${s.name}`)} · ${t(`nexus.v4.processing.status.${s.status}`)}`}
            description={s.reason && t(`nexus.v4.${s.reason}`)}
          >
            {s.status === 'failed' && (
              <Button
                onClick={() => {
                  run({
                    action: 'processing-retry',
                    id: record?.id,
                    step: s.name,
                    ...(password ? { password } : {}),
                  })
                  setPassword('')
                }}
              >
                {t('nexus.retry')}
              </Button>
            )}
          </Item>
        ))}
        {record?.steps.some(
          (s) => s.reason === 'processing.passwordOrVolume'
        ) && (
          <Item title={t('nexus.v4.processing.password')}>
            <Input
              type="password"
              aria-label={t('nexus.v4.processing.password')}
              placeholder={t('nexus.v4.processing.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Item>
        )}
      </Group>
      {record?.outputs.map((file) => (
        <small className="save-path" key={file}>
          {file}
        </small>
      ))}
      {error && <p role="alert">{error}</p>}
    </Section>
  )
}
export function PasswordBook() {
  const { t } = useTranslation()
  const snapshot = useQueues()
  const [open, setOpen] = useState(false)
  const [retained, setRetained] = useState<number[]>([])
  const [expectedCount, setExpectedCount] = useState(0)
  const [entries, setEntries] = useState<{ id: string; value: string }[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const show = () => {
    const count = snapshot?.passwordCount ?? 0
    setExpectedCount(count)
    setRetained(Array.from({ length: count }, (_, i) => i))
    setEntries([])
    setMessage('')
    setOpen(true)
  }
  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      await workflowCall({
        action: 'processing-password-book',
        passwords: entries.map((entry) => entry.value.trim()).filter(Boolean),
        keepIndices: retained,
        expectedCount,
      })
      setOpen(false)
      setEntries([])
    } catch {
      setMessage(t('nexus.v4.workflow.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section>
      <Group>
        <Item
          title={t('nexus.v4.processing.passwordBook')}
          description={t('nexus.v12.savedPasswords', {
            count: snapshot?.passwordCount ?? 0,
          })}
        >
          <Button onClick={show}>{t('nexus.v12.manage')}</Button>
        </Item>
      </Group>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value)
            if (!value) setEntries([])
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t('nexus.v4.processing.passwordBook')}</DialogTitle>
          <Group>
            {retained.map((index) => (
              <Item
                key={`saved-${index}`}
                title={t('nexus.v12.passwordEntry', { index: index + 1 })}
              >
                <span className="nx-password-mask">••••••••</span>
                <IconButton
                  variant="danger"
                  aria-label={t('common.remove')}
                  onClick={() =>
                    setRetained(retained.filter((i) => i !== index))
                  }
                >
                  <CloseIcon />
                </IconButton>
              </Item>
            ))}
            {entries.map((entry, index) => (
              <Item
                key={entry.id}
                title={t('nexus.v12.passwordEntry', {
                  index: retained.length + index + 1,
                })}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  aria-label={t('nexus.v12.passwordEntry', {
                    index: retained.length + index + 1,
                  })}
                  value={entry.value}
                  onChange={(e) =>
                    setEntries(
                      entries.map((item) =>
                        item.id === entry.id
                          ? { ...item, value: e.target.value }
                          : item
                      )
                    )
                  }
                />
                <IconButton
                  variant="danger"
                  aria-label={t('common.remove')}
                  onClick={() =>
                    setEntries(entries.filter((item) => item.id !== entry.id))
                  }
                >
                  <CloseIcon />
                </IconButton>
              </Item>
            ))}
            <Item title={t('nexus.v12.addPassword')}>
              <Button
                variant="quiet"
                disabled={retained.length + entries.length >= 200}
                onClick={() =>
                  setEntries([
                    ...entries,
                    { id: crypto.randomUUID(), value: '' },
                  ])
                }
              >
                {t('nexus.v11.add')}
              </Button>
            </Item>
          </Group>
          {message && <Banner>{message}</Banner>}
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
              onClick={() => void save()}
            >
              {t('common.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
