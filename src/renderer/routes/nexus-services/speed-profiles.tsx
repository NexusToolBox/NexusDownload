import { Group, Item } from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  type SpeedProfile,
  speedProfileSchema,
} from '@shared/schemas/nexus-speed'
import { formatBytes } from '@shared/utils/format-bytes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCloud } from '../nexus-cloud/cloud-client'

export function SpeedProfilesPanel() {
  const { t } = useTranslation()
  const cloud = useCloud()
  const [profiles, setProfiles] = useState<SpeedProfile[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      void transport
        .invoke(Queries.GetNexusSpeed)
        .then((raw) => {
          if (alive) setProfiles(z.array(speedProfileSchema).parse(raw))
        })
        .catch(() => undefined)
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
  if (!profiles.length) return null
  return (
    <Group className="mt-4">
      <h2>{t('nexus.speed.title')}</h2>
      {profiles.map((p) => {
        const account = cloud?.accounts.find((a) => a.id === p.accountId)
        const number =
          (cloud?.accounts.findIndex((a) => a.id === p.accountId) ?? -1) + 1
        return (
          <Item className="" key={`${p.platform}-${p.accountId}-${p.method}`}>
            <div className="t">
              {t(`nexus.platform.${p.platform}`)} ·{' '}
              {p.accountId
                ? account?.note ||
                  (number > 0
                    ? t('nexus.cloudV2.accountNumber', { count: number })
                    : t('nexus.speed.removedAccount'))
                : t('nexus.speed.noLogin')}
              <small>
                {t(
                  p.method === 'offline'
                    ? 'nexus.offline.title'
                    : `nexus.cloudV2.method.${p.method}`
                )}
              </small>
            </div>
            <span>
              {p.averageBps === null ? '—' : `${formatBytes(p.averageBps)}/s`} ·{' '}
              {t('nexus.speed.success', {
                percent: Math.round((p.successRate || 0) * 100),
              })}{' '}
              · {t('nexus.speed.attempts', { count: p.attempts })}
            </span>
          </Item>
        )
      })}
    </Group>
  )
}
