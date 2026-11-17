import {
  Button,
  Choice,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Group,
  Input,
  Item,
  Section,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  connectorSchema,
  type ParserConnector,
} from '@shared/schemas/nexus-services'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RemoteSubmit } from '../nexus-services/remote-jobs'

interface Snapshot {
  connectors: ParserConnector[]
  realDebrid: {
    authorized: boolean
    device: { userCode: string; url: string; expires: number } | null
  }
}
export function ServiceSettings() {
  const { t } = useTranslation()
  const [state, setState] = useState<Snapshot>()
  const [config, setConfig] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      void transport
        .invoke(Queries.GetNexusServices)
        .then((raw) => {
          if (alive) setState(raw as Snapshot)
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
  const run = async (request: unknown) => {
    setBusy(true)
    setError('')
    try {
      const r = (await transport.invoke(
        Commands.NexusServicesAction,
        request
      )) as { ok: boolean; value: unknown; error: string }
      if (!r.ok) throw new Error(r.error)
      if (r.value && typeof r.value === 'object' && 'connectors' in r.value)
        setState(r.value as Snapshot)

      setKey('')
      return true
    } catch {
      setError(t('nexus.v4.services.failed'))
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('nexus.v4.services.title')}>
      <Group>
        {state?.connectors.map((c) => (
          <Item className="" key={c.id}>
            <div className="t">
              <span>{c.name}</span>
              <small>{c.platforms.join(', ')}</small>
            </div>
            <Button
              onClick={() => {
                setConfig(JSON.stringify(c, null, 2))
                setError('')
                setEditing(true)
              }}
            >
              {t('nexus.v11.edit')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run({ action: 'connector-remove', id: c.id })}
            >
              {t('common.delete')}
            </Button>
          </Item>
        ))}
        <Item className="">
          <div className="t">
            <span>{t('nexus.v11.customConnector')}</span>
          </div>
          <Button
            onClick={() => {
              setConfig(
                JSON.stringify(
                  {
                    id: 'custom',
                    name: 'Parser',
                    platforms: ['example.com'],
                    endpoint: 'https://api.example.com/parse',
                    method: 'POST',
                    inputField: 'url',
                    resultField: 'data.url',
                    titleField: 'data.title',
                  },
                  null,
                  2
                )
              )
              setKey('')
              setError('')
              setEditing(true)
            }}
          >
            {t('nexus.v11.add')}
          </Button>
        </Item>
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{t('nexus.v11.customConnector')}</DialogTitle>
              <DialogDescription>
                {t('nexus.v4.services.privacy')}
              </DialogDescription>
            </DialogHeader>
            <Group>
              {(
                [
                  'id',
                  'name',
                  'platforms',
                  'endpoint',
                  'method',
                  'inputField',
                  'resultField',
                  'titleField',
                ] as const
              ).map((field) => {
                const data = JSON.parse(config || '{}') as Record<
                  string,
                  unknown
                >
                const value =
                  field === 'platforms'
                    ? Array.isArray(data[field])
                      ? data[field].join(', ')
                      : ''
                    : String(data[field] ?? '')
                const change = (value: string) =>
                  setConfig(
                    JSON.stringify({
                      ...data,
                      [field]:
                        field === 'platforms'
                          ? value.split(',').map((x) => x.trim())
                          : value,
                    })
                  )
                return (
                  <Item key={field} title={t(`nexus.v12.connector.${field}`)}>
                    {field === 'method' ? (
                      <Choice
                        label={t(`nexus.v12.connector.${field}`)}
                        value={value}
                        choices={['GET', 'POST'].map((value) => ({
                          value,
                          label: value,
                        }))}
                        onChange={change}
                      />
                    ) : (
                      <Input
                        aria-label={t(`nexus.v12.connector.${field}`)}
                        value={value}
                        onChange={(e) => change(e.target.value)}
                      />
                    )}
                  </Item>
                )
              })}
              <Item title={t('nexus.v4.services.key')}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  aria-label={t('nexus.v4.services.key')}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </Item>
            </Group>
            <DialogFooter>
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  try {
                    void run({
                      action: 'connector-save',
                      connector: connectorSchema.parse(JSON.parse(config)),
                      ...(key ? { key } : {}),
                    }).then((saved) => {
                      if (saved) setEditing(false)
                    })
                  } catch {
                    setError(t('nexus.v4.services.failed'))
                  }
                }}
              >
                {t('common.save')}
              </Button>
            </DialogFooter>
            {error && <p role="alert">{error}</p>}
          </DialogContent>
        </Dialog>
        <Item className="">
          <div className="t">
            <span>Real-Debrid</span>
            <small>{t('nexus.v11.remoteReturn')}</small>
          </div>
          {state?.realDebrid.authorized && (
            <span
              className="nexus-status-dot"
              role="img"
              aria-label={t('nexus.v11.accountValid')}
            />
          )}
          <Button
            disabled={busy}
            onClick={() =>
              void run({
                action: state?.realDebrid.authorized
                  ? 'rd-logout'
                  : 'rd-authorize',
              })
            }
          >
            {t(
              state?.realDebrid.authorized
                ? 'nexus.v4.services.disconnect'
                : 'nexus.v4.services.authorize'
            )}
          </Button>
          {state?.realDebrid.device && (
            <div>
              <a
                href={state.realDebrid.device.url}
                target="_blank"
                rel="noreferrer"
              >
                {state.realDebrid.device.url}
              </a>
              <strong> {state.realDebrid.device.userCode}</strong>
              <Button
                disabled={busy}
                onClick={() => void run({ action: 'rd-poll' })}
              >
                {t('nexus.v4.services.checkAuthorization')}
              </Button>
            </div>
          )}
        </Item>
        {state?.realDebrid.authorized && <RemoteSubmit />}
        {error && !editing && <p role="alert">{error}</p>}
      </Group>
    </Section>
  )
}
