import { Button, Item } from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Job {
  id: string
  name: string
  status: string
  progress: number
}
export function useExternalJobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      void transport
        .invoke(Queries.GetNexusMedia)
        .then((raw) => {
          if (alive) setJobs((raw as { jobs: Job[] }).jobs ?? [])
        })
        .catch(() => undefined)
    transport.on(Events.NexusWorkspaceChanged, load)
    load()
    return () => {
      alive = false
      transport.off(Events.NexusWorkspaceChanged, load)
    }
  }, [])
  return jobs
}
export function ExternalJobs({ exclude = [] }: { exclude?: string[] }) {
  const { t } = useTranslation()
  const jobs = useExternalJobs()
  return (
    <>
      {jobs
        .filter((j) => !exclude.includes(j.id))
        .map((job) => (
          <Item key={job.id} className="">
            <div className="t">
              {job.name}
              <small>
                {t(`nexus.status.${job.status}`)} ·{' '}
                {Math.round(job.progress * 100)}%
              </small>
            </div>
            <Button
              disabled={job.status === 'completed'}
              onClick={() =>
                void transport.invoke(Commands.NexusExternalAction, {
                  id: job.id,
                  action: job.status === 'downloading' ? 'pause' : 'resume',
                })
              }
            >
              {t(job.status === 'downloading' ? 'nexus.pause' : 'nexus.resume')}
            </Button>
          </Item>
        ))}
    </>
  )
}
