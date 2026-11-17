import {
  Banner,
  Button,
  Chip,
  Choice,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Group,
  IconButton,
  Input,
  Item,
  Section,
  Segmented,
  Status,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { MoreIcon } from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  completionActionSchema,
  type NexusQueue,
  queueSchema,
} from '@shared/schemas/nexus-workflow'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
export interface QueueSnapshot {
  passwordCount?: number
  diskBlocked?: string[]
  wakeStatus?: Record<string, string>
  queues: NexusQueue[]
  members: Record<string, { queueId: string; wanted: boolean }>
  countdowns: Record<string, { phase: string; deadline: number | null }>
  wake: { id: string; at: number | null }[]
}
export function useQueues() {
  const [state, setState] = useState<QueueSnapshot>()
  useEffect(() => {
    let revision = 0
    let alive = true
    const load = () => {
      const current = ++revision
      void transport
        .invoke(Queries.GetNexusWorkflow)
        .then((raw) => {
          if (alive && current === revision) setState(raw as QueueSnapshot)
        })
        .catch(() => undefined)
    }
    transport.on(Events.NexusWorkspaceChanged, load)
    load()
    const detach = transport.onConnectionChange?.((event) => {
      if (event.state === 'connected') load()
    })
    return () => {
      alive = false
      transport.off(Events.NexusWorkspaceChanged, load)
      detach?.()
    }
  }, [])
  return state
}
export async function workflowCall(request: unknown) {
  const r = (await transport.invoke(Commands.NexusWorkflowAction, request)) as {
    ok: boolean
  }
  if (!r.ok) throw new Error('workflow.failed')
}
export function QueueSettings() {
  const { t } = useTranslation()
  const state = useQueues()
  const [draft, setDraft] = useState<NexusQueue>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (request: unknown) => {
    setBusy(true)
    setError('')
    try {
      await workflowCall(request)
      if ((request as { action: string }).action === 'queue-save')
        setDraft(undefined)
    } catch {
      setError(t('nexus.v4.workflow.failed'))
    } finally {
      setBusy(false)
    }
  }
  const update = (patch: Partial<NexusQueue>) =>
    setDraft((v) => (v ? { ...v, ...patch } : v))
  const times = Array.from({ length: 96 }, (_, index) => {
    const value = `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`
    return { value, label: value }
  })
  return (
    <Section
      title={t('nexus.settings.sections.queues')}
      action={
        <Button
          onClick={() =>
            setDraft(
              queueSchema.parse({
                id: crypto.randomUUID(),
                name: t('nexus.v4.newQueue'),
              })
            )
          }
        >
          {t('nexus.v4.newQueue')}
        </Button>
      }
    >
      <Group>
        {state?.queues.map((queue) => (
          <Item
            key={queue.id}
            title={queue.name}
            description={
              <span className="nx-queue-meta">
                <Chip>
                  {t('nexus.v12.concurrency', { count: queue.concurrency })}
                </Chip>
                <Chip>
                  {queue.schedule.enabled
                    ? t('nexus.v12.daily', {
                        start: queue.schedule.start,
                        stop: queue.schedule.stop,
                      })
                    : t('nexus.v12.manual')}
                </Chip>
                {queue.completion !== 'none' && (
                  <Chip>
                    {t(`nexus.v4.completionAction.${queue.completion}`)}
                  </Chip>
                )}
              </span>
            }
          >
            <Status tone={queue.running ? 'live' : 'off'}>
              {queue.running
                ? t('nexus.v12.running')
                : queue.schedule.enabled
                  ? t('nexus.v12.queueStart', { time: queue.schedule.start })
                  : t('nexus.v12.manual')}
            </Status>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <IconButton aria-label={t('nexus.more')} disabled={busy}>
                    <MoreIcon />
                  </IconButton>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setDraft(structuredClone(queue))}
                >
                  {t('nexus.v12.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void run({
                      action: 'queue-run',
                      id: queue.id,
                      running: !queue.running,
                    })
                  }
                >
                  {t(
                    queue.running ? 'nexus.v4.stopQueue' : 'nexus.v4.startQueue'
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void run({ action: 'cancel-completion', id: queue.id })
                  }
                >
                  {t('nexus.v4.cancelAction')}
                </DropdownMenuItem>
                {queue.id !== 'main' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        void run({ action: 'queue-delete', id: queue.id })
                      }
                    >
                      {t('common.remove')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </Item>
        ))}
      </Group>
      {error && <Banner>{error}</Banner>}
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(undefined)
        }}
      >
        {draft && (
          <DialogContent>
            <DialogTitle>{t('nexus.v12.editQueue')}</DialogTitle>
            <form
              className="nx-dialog-form"
              onSubmit={(event) => {
                event.preventDefault()
                void run({ action: 'queue-save', queue: draft })
              }}
            >
              <Group>
                <Item title={t('nexus.v4.queueName')}>
                  <Input
                    aria-label={t('nexus.v4.queueName')}
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </Item>
                <Item title={t('nexus.v4.concurrency')}>
                  <Segmented
                    label={t('nexus.v4.concurrency')}
                    value={String(draft.concurrency)}
                    choices={[
                      1,
                      3,
                      5,
                      8,
                      ...(![1, 3, 5, 8].includes(draft.concurrency)
                        ? [draft.concurrency]
                        : []),
                    ].map((value) => ({
                      value: String(value),
                      label: String(value),
                    }))}
                    onChange={(value) => update({ concurrency: Number(value) })}
                  />
                </Item>
                <Item title={t('nexus.v4.retries')}>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    aria-label={t('nexus.v4.retries')}
                    value={draft.retries}
                    onChange={(e) =>
                      update({ retries: Number(e.target.value) })
                    }
                  />
                </Item>
                <Item title={t('nexus.v4.schedule')}>
                  <Switch
                    aria-label={t('nexus.v4.schedule')}
                    checked={draft.schedule.enabled}
                    onCheckedChange={(enabled) =>
                      update({ schedule: { ...draft.schedule, enabled } })
                    }
                  />
                </Item>
                {draft.schedule.enabled && (
                  <>
                    <Item title={t('nexus.v4.start')}>
                      <Choice
                        label={t('nexus.v4.start')}
                        value={draft.schedule.start}
                        choices={times}
                        onChange={(start) =>
                          update({ schedule: { ...draft.schedule, start } })
                        }
                      />
                    </Item>
                    <Item title={t('nexus.v4.stop')}>
                      <Choice
                        label={t('nexus.v4.stop')}
                        value={draft.schedule.stop}
                        choices={times}
                        onChange={(stop) =>
                          update({ schedule: { ...draft.schedule, stop } })
                        }
                      />
                    </Item>
                    <Item title={t('nexus.v12.repeat')}>
                      <div className="nx-weekdays">
                        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                          <Button
                            key={day}
                            variant="quiet"
                            aria-pressed={draft.schedule.days.includes(day)}
                            onClick={() =>
                              update({
                                schedule: {
                                  ...draft.schedule,
                                  date: undefined,
                                  days: draft.schedule.days.includes(day)
                                    ? draft.schedule.days.filter(
                                        (d) => d !== day
                                      )
                                    : [...draft.schedule.days, day],
                                },
                              })
                            }
                          >
                            {t(`nexus.v4.weekday.${day}`)}
                          </Button>
                        ))}
                      </div>
                    </Item>
                    <Item title={t('nexus.v4.onceDate')}>
                      <Input
                        aria-label={t('nexus.v4.onceDate')}
                        placeholder="YYYY-MM-DD"
                        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
                        value={draft.schedule.date ?? ''}
                        onChange={(e) =>
                          update({
                            schedule: {
                              ...draft.schedule,
                              date: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </Item>
                    <Item
                      title={t('nexus.v4.wake')}
                      description={t('nexus.v4.wakeHelp')}
                    >
                      <Switch
                        aria-label={t('nexus.v4.wake')}
                        checked={draft.schedule.wake}
                        onCheckedChange={(wake) =>
                          update({ schedule: { ...draft.schedule, wake } })
                        }
                      />
                    </Item>
                  </>
                )}
                <Item title={t('nexus.v4.completion')}>
                  <Choice
                    label={t('nexus.v4.completion')}
                    value={draft.completion}
                    choices={completionActionSchema.options.map((value) => ({
                      value,
                      label: t(`nexus.v4.completionAction.${value}`),
                    }))}
                    onChange={(value) =>
                      update({
                        completion: completionActionSchema.parse(value),
                      })
                    }
                  />
                </Item>
                {draft.completion === 'open' && (
                  <Item title={t('nexus.v4.openFile')}>
                    <Input
                      aria-label={t('nexus.v4.openFile')}
                      value={draft.openFile}
                      onChange={(e) => update({ openFile: e.target.value })}
                    />
                  </Item>
                )}
              </Group>
              {error && <Banner>{error}</Banner>}
              <DialogFooter>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setDraft(undefined)}
                >
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" type="submit" disabled={busy}>
                  {t('common.apply')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Section>
  )
}
export function QueueTaskControl({ taskId }: { taskId?: string }) {
  const { t } = useTranslation()
  const state = useQueues()
  if (!state || state.queues.length <= 1) return null
  return (
    <Group>
      <Item title={t('nexus.settings.sections.queues')}>
        <Choice
          label={t('nexus.settings.sections.queues')}
          disabled={!taskId}
          value={taskId ? (state.members[taskId]?.queueId ?? 'main') : 'main'}
          choices={state.queues.map((queue) => ({
            value: queue.id,
            label: queue.name,
          }))}
          onChange={(queueId) => {
            if (taskId)
              void workflowCall({
                action: 'assign',
                queueId,
                taskIds: [taskId],
              })
          }}
        />
      </Item>
    </Group>
  )
}
