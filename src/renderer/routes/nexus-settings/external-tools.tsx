import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Group,
  IconButton,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import { MoreIcon } from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import type { ToolId } from '@shared/schemas/nexus-tools'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changeToolBundle, TOOL_BUNDLES } from './tool-bundles'

interface ToolState {
  tools: { id: ToolId; installed: string | null; busy: boolean }[]
}
export function ExternalTools() {
  const { t } = useTranslation()
  const [state, setState] = useState<ToolState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const load = () =>
      void transport
        .invoke(Queries.GetNexusTools)
        .then((raw) => {
          if (alive) setState(raw as ToolState)
        })
        .catch(() => {
          if (alive) setError('tools.failed')
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
  const action = async (
    bundle: keyof typeof TOOL_BUNDLES,
    operation: 'install' | 'uninstall'
  ) => {
    setBusy(true)
    setError('')
    try {
      await changeToolBundle(bundle, operation)
      setState((await transport.invoke(Queries.GetNexusTools)) as ToolState)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'tools.failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group>
        {(Object.keys(TOOL_BUNDLES) as (keyof typeof TOOL_BUNDLES)[]).map(
          (bundle) => {
            const tools = TOOL_BUNDLES[bundle].map((id) =>
              state?.tools.find((tool) => tool.id === id)
            )
            const installed = tools.every((tool) => !!tool?.installed)
            const disabled = busy || !state || tools.some((tool) => tool?.busy)
            return (
              <Item
                key={bundle}
                title={t(
                  `nexus.v14.${bundle === 'video' ? 'videoTool' : bundle === 'gallery' ? 'galleryTool' : 'archiveTool'}`
                )}
                description={installed ? t('nexus.v14.installed') : undefined}
              >
                {installed ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <IconButton
                          aria-label={t('nexus.more')}
                          disabled={disabled}
                        >
                          <MoreIcon />
                        </IconButton>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => void action(bundle, 'install')}
                      >
                        {t('nexus.v4.updateTool')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void action(bundle, 'uninstall')}
                      >
                        {t('nexus.v4.uninstall')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    disabled={disabled}
                    onClick={() => void action(bundle, 'install')}
                  >
                    {t('nexus.v4.install')}
                  </Button>
                )}
              </Item>
            )
          }
        )}
      </Group>
      {error && (
        <p role="alert">
          {t(`nexus.v4.${error}`, { defaultValue: t('nexus.v4.tools.failed') })}
        </p>
      )}
    </>
  )
}
