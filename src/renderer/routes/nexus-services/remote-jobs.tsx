import {
  Button,
  Group,
  Input,
  Item,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import type { RemoteJob } from '@shared/schemas/nexus-remote'
import { formatBytes } from '@shared/utils/format-bytes'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function RemoteJobs({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [jobs, setJobs] = useState<RemoteJob[]>([])
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void transport
        .invoke(Queries.GetNexusServices)
        .then((raw) => {
          if (alive)
            setJobs((raw as { remoteJobs: RemoteJob[] }).remoteJobs ?? [])
        })
        .catch(() => {})
    }
    transport.on(Events.NexusWorkspaceChanged, refresh)
    const detach = transport.onConnectionChange?.((e) => {
      if (e.state === 'connected') refresh()
    })
    refresh()
    return () => {
      alive = false
      transport.off(Events.NexusWorkspaceChanged, refresh)
      detach?.()
    }
  }, [])
  if (!jobs.length) return null
  return (
    <Group className="p-4 space-y-3">
      <h2>{t('nexus.remote.jobs')}</h2>
      {jobs.map((job) => (
        <div key={job.id} className="space-y-1 border-b pb-3">
          <b>
            {job.files[0]?.name ||
              (job.adapter.startsWith('115:')
                ? t('nexus.remote.use115')
                : job.adapter.startsWith('node:')
                  ? t('nexus.remote.nodes')
                  : 'Real-Debrid')}
          </b>
          <span className="ml-3">{t(`nexus.remote.phase.${job.phase}`)}</span>
          <p>
            {t('nexus.remote.remoteProgress', { percent: job.progress })} ·{' '}
            {t('nexus.remote.localProgress', {
              bytes: formatBytes(
                job.files.reduce((n, f) => n + f.downloaded, 0)
              ),
              total: formatBytes(job.files.reduce((n, f) => n + f.bytes, 0)),
            })}
          </p>
          {job.usage && <p>{t('nexus.remote.usage', { value: job.usage })}</p>}
          {job.error && (
            <p role="alert">
              {t(
                `nexus.${job.error.startsWith('cloud.') ? 'cloudError' : 'remote.error'}.${job.error.split('.').at(-1)}`,
                {
                  defaultValue: t('nexus.remote.error.failed'),
                }
              )}
            </p>
          )}
          {!compact && job.phase !== 'completed' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void transport.invoke(Commands.NexusServicesAction, {
                  action:
                    job.phase === 'waiting'
                      ? 'remote-retrieve'
                      : 'remote-refresh',
                  id: job.id,
                })
              }}
            >
              {t(
                job.phase === 'waiting'
                  ? 'nexus.remote.retrieve'
                  : 'nexus.retry'
              )}
            </Button>
          )}
        </div>
      ))}
    </Group>
  )
}
export function RemoteSubmit({
  adapter = 'real-debrid',
  source: initial = '',
}: {
  adapter?: string
  source?: string
}) {
  const uid = useId()
  const { t } = useTranslation()
  const [source, setSource] = useState(initial)
  const [directory, setDirectory] = useState('')
  const [limit, setLimit] = useState('10')
  const [retain, setRetain] = useState('24')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setSource(initial)
  }, [initial])
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const response = (await transport.invoke(Commands.NexusServicesAction, {
        action: 'remote-submit',
        adapter,
        source,
        directory,
        maxBytes: Math.floor(Number(limit) * 1024 ** 3),
        retainHours: Number(retain),
        remoteOnly,
      })) as { ok: boolean; error?: string }
      if (!response.ok) throw new Error(response.error)
      setSource('')
    } catch (error) {
      const code =
        error instanceof Error ? error.message.split('.').at(-1) : 'failed'
      setError(
        t(
          `nexus.${error instanceof Error && error.message.startsWith('cloud.') ? 'cloudError' : 'remote.error'}.${code}`,
          {
            defaultValue: t('nexus.remote.error.failed'),
          }
        )
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group>
      <Item title={t('nexus.remote.source')}>
        <Input
          id={`${uid}-source`}
          aria-label={t('nexus.remote.source')}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </Item>
      <Item title={t('nexus.remote.directory')}>
        <Input
          id={`${uid}-directory`}
          aria-label={t('nexus.remote.directory')}
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
        />
        <Button
          onClick={() =>
            void transport.invoke(Commands.PickSaveDir).then((d) => {
              if (typeof d === 'string') setDirectory(d)
            })
          }
        >
          {t('nexus.cloudV2.chooseFolder')}
        </Button>
      </Item>
      <Item title={t('nexus.remote.budget')}>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          aria-label={t('nexus.remote.budget')}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </Item>
      <Item title={t('nexus.remote.retention')}>
        <Input
          type="number"
          min="0"
          max="8760"
          aria-label={t('nexus.remote.retention')}
          value={retain}
          onChange={(e) => setRetain(e.target.value)}
        />
      </Item>
      <Item title={t('nexus.remote.remoteOnly')}>
        <Switch
          checked={remoteOnly}
          onCheckedChange={setRemoteOnly}
          aria-label={t('nexus.remote.remoteOnly')}
        />
      </Item>
      <Item title={t('nexus.remote.submit')}>
        <Button
          variant="primary"
          disabled={busy || !source || !directory || Number(limit) <= 0}
          onClick={() => void submit()}
        >
          {t('nexus.remote.submit')}
        </Button>
      </Item>
      {error && <p role="alert">{error}</p>}
    </Group>
  )
}
