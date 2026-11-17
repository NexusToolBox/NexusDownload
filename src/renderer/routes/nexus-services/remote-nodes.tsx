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
  Section,
  Status,
} from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import type { RemoteNode } from '@shared/schemas/nexus-remote'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RemoteSubmit } from './remote-jobs'

type Node = RemoteNode & {
  paired: boolean
  pairing: { userCode: string; expiresAt: number } | null
}
export function RemoteNodes() {
  const { t } = useTranslation()
  const uid = useId()
  const [nodes, setNodes] = useState<Node[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [bridge, setBridge] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void transport
        .invoke(Queries.GetNexusServices)
        .then((raw) => {
          if (alive) setNodes((raw as { nodes: Node[] }).nodes ?? [])
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
  const run = async (action: unknown) => {
    setBusy(true)
    setError('')
    try {
      const r = (await transport.invoke(
        Commands.NexusServicesAction,
        action
      )) as { ok: boolean; error?: string; value: { nodes: Node[] } }
      if (!r.ok) throw new Error(r.error)
      setNodes(r.value.nodes)
      setOpen(false)
    } catch (error) {
      const code =
        error instanceof Error ? error.message.split('.').at(-1) : 'network'
      setError(
        t(`nexus.remote.error.${code}`, {
          defaultValue: t('nexus.remote.error.network'),
        })
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title={t('nexus.remote.nodes')}
      action={
        <Button onClick={() => setOpen(true)}>
          {t('nexus.remote.addNode')}
        </Button>
      }
    >
      <Group>
        {!nodes.length && (
          <Item
            title={t('nexus.v13.noNodes')}
            description={t('nexus.remote.nodeHelp')}
          >
            <Status tone="off">{t('nexus.v12.notConfigured')}</Status>
          </Item>
        )}
        {nodes.map((node) => (
          <div key={node.id}>
            <Item title={node.name} description={node.url}>
              <Status tone={node.paired ? 'ok' : 'off'}>
                {t(
                  node.paired
                    ? 'nexus.remote.paired'
                    : 'nexus.v12.notConfigured'
                )}
              </Status>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void run({ action: 'node-remove', id: node.id })}
              >
                {t('nexus.remote.removeNode')}
              </Button>
            </Item>
            {node.pairing ? (
              <Item
                title={t('nexus.remote.pairHelp')}
                description={node.pairing.userCode}
              >
                <Button
                  disabled={busy}
                  onClick={() => void run({ action: 'node-poll', id: node.id })}
                >
                  {t('nexus.remote.checkPair')}
                </Button>
              </Item>
            ) : !node.paired ? (
              <Item title={t('nexus.remote.pair')}>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run({
                      action: 'node-pair',
                      node: {
                        id: node.id,
                        name: node.name,
                        url: node.url,
                        bridgeUrl: node.bridgeUrl,
                      },
                    })
                  }
                >
                  {t('nexus.remote.pair')}
                </Button>
              </Item>
            ) : (
              <RemoteSubmit adapter={`node:${node.id}`} />
            )}
          </div>
        ))}
      </Group>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t('nexus.remote.addNode')}</DialogTitle>
          <Group>
            <Item title={t('nexus.remote.nodeName')}>
              <Input
                id={`${uid}-name`}
                aria-label={t('nexus.remote.nodeName')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Item>
            <Item
              title={t('nexus.remote.nodeUrl')}
              description={t('nexus.remote.nodeHelp')}
            >
              <Input
                id={`${uid}-url`}
                aria-label={t('nexus.remote.nodeUrl')}
                placeholder="https://nas.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Item>
            <Item title={t('nexus.remote.bridgeUrl')}>
              <Input
                id={`${uid}-bridge`}
                aria-label={t('nexus.remote.bridgeUrl')}
                placeholder="https://nas.example.com"
                value={bridge}
                onChange={(e) => setBridge(e.target.value)}
              />
            </Item>
          </Group>
          {error && <p role="alert">{error}</p>}
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
              disabled={busy || !name || !url}
              onClick={() =>
                void run({
                  action: 'node-pair',
                  node: {
                    id: crypto.randomUUID(),
                    name,
                    url,
                    bridgeUrl: bridge || url,
                  },
                })
              }
            >
              {t('nexus.remote.pair')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && !open && <p role="alert">{error}</p>}
    </Section>
  )
}
