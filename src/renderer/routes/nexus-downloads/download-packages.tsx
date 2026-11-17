import {
  Button,
  Group,
  Input,
  Item,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import { formatBytes } from '@shared/utils/format-bytes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workflowCall } from '../nexus-settings/queue-settings'
import { ProcessingSteps } from './processing-steps'
export interface PackageView {
  id: string
  name: string
  taskIds: string[]
  directory: string
  extract: boolean
  trashArchives: boolean
  progress: number
  bytes: number
  completed: boolean
  members: { id: string; name: string; status: string; progress: number }[]
}
export function usePackages() {
  const [packages, setPackages] = useState<PackageView[]>([])
  useEffect(() => {
    let revision = 0
    let alive = true
    const load = () => {
      const current = ++revision
      void transport
        .invoke(Queries.GetNexusWorkflow)
        .then((raw) => {
          if (alive && current === revision)
            setPackages((raw as { packages: PackageView[] }).packages ?? [])
        })
        .catch(() => undefined)
    }
    transport.on(Events.NexusWorkspaceChanged, load)
    load()
    return () => {
      alive = false
      transport.off(Events.NexusWorkspaceChanged, load)
    }
  }, [])
  return packages
}
export function DownloadPackages({ onSelect }: { onSelect(id: string): void }) {
  const { t } = useTranslation()
  const packages = usePackages()
  const [expanded, setExpanded] = useState<string[]>([])
  const [error, setError] = useState('')
  const run = (request: unknown) =>
    void workflowCall(request).catch(() =>
      setError(t('nexus.v4.workflow.failed'))
    )
  return (
    <>
      {packages.map((pkg) => (
        <section key={pkg.id} className="nexus-v4-package">
          <Item className="">
            <Button
              aria-expanded={expanded.includes(pkg.id)}
              onClick={() =>
                setExpanded((v) =>
                  v.includes(pkg.id)
                    ? v.filter((id) => id !== pkg.id)
                    : [...v, pkg.id]
                )
              }
            >
              {pkg.name} · {pkg.taskIds.length}
            </Button>
            <span>
              {Math.min(100, Math.round(pkg.progress * 100))}% ·{' '}
              {formatBytes(pkg.bytes)}
            </span>
            <Button
              disabled={pkg.completed}
              onClick={() =>
                run({
                  action: 'package-control',
                  id: pkg.id,
                  wanted: !pkg.members.some((m) => m.status === 'downloading'),
                })
              }
            >
              {t(
                pkg.members.some((m) => m.status === 'downloading')
                  ? 'nexus.pause'
                  : 'nexus.resume'
              )}
            </Button>
          </Item>
          {expanded.includes(pkg.id) && (
            <div className="children">
              <Group>
                <Item title={t('nexus.v4.extractPackage')}>
                  <Switch
                    id={`extract-${pkg.id}`}
                    checked={pkg.extract}
                    onCheckedChange={(extract) =>
                      run({
                        action: 'package-save',
                        id: pkg.id,
                        extract,
                        trashArchives: pkg.trashArchives,
                      })
                    }
                  />
                </Item>
                <Item title={t('nexus.v4.trashArchives')}>
                  <Switch
                    id={`trash-${pkg.id}`}
                    checked={pkg.trashArchives}
                    onCheckedChange={(trashArchives) =>
                      run({
                        action: 'package-save',
                        id: pkg.id,
                        extract: pkg.extract,
                        trashArchives,
                      })
                    }
                  />
                </Item>
                <Item title={t('nexus.v4.packageText')}>
                  <Input
                    aria-label={t('nexus.v4.packageText')}
                    placeholder={t('nexus.v4.packageText')}
                    onBlur={(e) => {
                      if (e.target.value) {
                        run({
                          action: 'package-save',
                          id: pkg.id,
                          extract: pkg.extract,
                          trashArchives: pkg.trashArchives,
                          pageText: e.target.value,
                        })
                        e.target.value = ''
                      }
                    }}
                  />
                </Item>
              </Group>
              <ProcessingSteps
                taskId={pkg.taskIds[0]}
                completed={pkg.completed}
              />
              <Group>
                {pkg.members.map((member) => (
                  <Item
                    key={member.id}
                    title={member.name}
                    description={`${t(`nexus.status.${member.status}`)} · ${Math.round(member.progress * 100)}%`}
                  >
                    <Button variant="quiet" onClick={() => onSelect(member.id)}>
                      {t('nexus.fullTaskTools')}
                    </Button>
                  </Item>
                ))}
              </Group>
            </div>
          )}
        </section>
      ))}
      {error && <p role="alert">{error}</p>}
    </>
  )
}
