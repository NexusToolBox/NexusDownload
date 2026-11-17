import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  type NexusSnapshot,
  nexusSnapshotSchema,
} from '@shared/schemas/nexus-workspace'
import { useEffect, useState } from 'react'

export function useNexusWorkspace() {
  const [workspace, setWorkspace] = useState<NexusSnapshot | null>(null)
  useEffect(() => {
    let active = true
    let revision = 0
    const refresh = () => {
      const request = ++revision
      void transport
        .invoke(Queries.GetNexusWorkspace)
        .then((raw) => {
          const parsed = nexusSnapshotSchema.safeParse(raw)
          if (active && request === revision && parsed.success)
            setWorkspace(parsed.data)
        })
        .catch(() => undefined)
    }
    transport.on(Events.NexusWorkspaceChanged, refresh)
    const detach = transport.onConnectionChange?.((event) => {
      if (event.state === 'connected') refresh()
    })
    refresh()
    return () => {
      active = false
      transport.off(Events.NexusWorkspaceChanged, refresh)
      detach?.()
    }
  }, [])
  return workspace
}
