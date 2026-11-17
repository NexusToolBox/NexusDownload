import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  type NexusDiskSpace,
  nexusDiskSpaceSchema,
} from '@shared/schemas/nexus-disk'
import { useEffect, useState } from 'react'

export function useNexusDiskSpace(directory?: string) {
  const [disk, setDisk] = useState<NexusDiskSpace | null>(null)
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void transport
        .invoke(Queries.GetNexusDiskSpace, { directory })
        .then((raw) => {
          const value = nexusDiskSpaceSchema.safeParse(raw)
          if (!disposed) setDisk(value.success ? value.data : null)
        })
        .catch(() => {
          if (!disposed) setDisk(null)
        })
    }
    const changed = () => refresh()
    transport.on(Events.SettingsChanged, changed)
    const detach = transport.onConnectionChange?.((event) => {
      if (event.state === 'connected') refresh()
    })
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
      transport.off(Events.SettingsChanged, changed)
      detach?.()
    }
  }, [directory])
  return disk
}
