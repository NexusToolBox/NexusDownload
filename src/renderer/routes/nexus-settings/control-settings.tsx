import {
  Button,
  Group,
  Input,
  Item,
  Section,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import type { ControlSnapshot } from '@shared/schemas/nexus-control'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ControlSettings({
  kind = 'phone',
}: {
  kind?: 'phone' | 'mcp'
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<ControlSnapshot>()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      void transport
        .invoke(Queries.GetNexusControl)
        .then((raw) => {
          if (alive) setState(raw as ControlSnapshot)
        })
        .catch(() => {
          if (alive) setError(true)
        })
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
  const run = async (request: unknown) => {
    setBusy(true)
    setError(false)
    try {
      const r = (await transport.invoke(
        Commands.NexusControlAction,
        request
      )) as { ok: boolean; value: ControlSnapshot }
      if (!r.ok) throw new Error('control.failed')
      setState(r.value)
      setCode('')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  if (kind === 'mcp')
    return (
      <Section>
        <Group>
          <Item className="">
            <div className="t">{t('nexus.control.mcp')}</div>
            <Switch
              disabled={busy || !state}
              checked={state?.mcp.enabled || false}
              aria-label={t('nexus.control.mcp')}
              onCheckedChange={(enabled) =>
                void run({ action: 'mcp-enable', enabled })
              }
            />
          </Item>
          {(error || state?.mcp.error) && (
            <p role="alert">{t('nexus.control.failed')}</p>
          )}
          {state?.mcp.enabled && state.mcp.config !== null && (
            <div className="space-y-3 p-4">
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(JSON.stringify(state.mcp.config, null, 2))
                    .catch(() => setError(true))
                }
              >
                {t('nexus.v14.copy')}
              </Button>
              <p>{t('nexus.control.configHint')}</p>
            </div>
          )}
        </Group>
      </Section>
    )
  return (
    <Section>
      <Group>
        <Item className="">
          <div className="t">{t('nexus.control.phone')}</div>
          <Switch
            checked={state?.phone.enabled || false}
            disabled={busy || !state}
            aria-label={t('nexus.control.phone')}
            onCheckedChange={(enabled) =>
              void run({ action: 'phone-enable', enabled })
            }
          />
        </Item>
        {(error || state?.phone.error) && (
          <p role="alert">{t('nexus.control.failed')}</p>
        )}
        {state?.phone.enabled && (
          <div className="space-y-4 p-4">
            <p>{t('nexus.control.lanOnly')}</p>
            {state.phone.qr ? (
              <img
                src={state.phone.qr}
                alt={t('nexus.control.scan')}
                width={240}
                height={240}
              />
            ) : (
              <p>{t('nexus.control.noLan')}</p>
            )}
            {state.phone.urls.map((url) => (
              <p key={url}>{url}</p>
            ))}
            <Item title={t('nexus.control.code')}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('nexus.control.code')}
                aria-label={t('nexus.control.code')}
                maxLength={20}
              />
              <Button
                size="sm"
                disabled={busy || !code}
                onClick={() => void run({ action: 'phone-pair', code })}
              >
                {t('nexus.control.pair')}
              </Button>
            </Item>
            {state.phone.devices.map((device) => (
              <Item key={device.id} className="">
                <div className="t">{device.name}</div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run({ action: 'phone-remove', id: device.id })
                  }
                >
                  {t('nexus.control.removeDevice')}
                </Button>
              </Item>
            ))}
          </div>
        )}
      </Group>
    </Section>
  )
}
