import { transport } from '@renderer/lib/transport'
import type { CommandChannel } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  type CloudSnapshot,
  cloudResultSchema,
  cloudSnapshotSchema,
} from '@shared/schemas/nexus-cloud'
import { useEffect, useState } from 'react'

export async function cloudCall(
  command: CommandChannel,
  payload?: unknown
): Promise<unknown> {
  const result = cloudResultSchema.parse(
    await transport.invoke(command, payload)
  )
  if (!result.ok) throw new Error(result.error)
  return result.value
}
export function cloudError(error: unknown) {
  return error instanceof Error &&
    [
      'login',
      'login-elsewhere',
      'captcha',
      'risk',
      'rate',
      'permission',
      'extraction-code',
      'expired-share',
      'expired-link',
      'headers',
      'size',
      'identity',
      'space',
      'checkpoint',
      'path',
      'network',
      'unsupported',
      'playback',
      'open-platform',
      'share-auth',
    ].includes(error.message)
    ? error.message
    : 'network'
}
export function useCloud() {
  const [state, setState] = useState<CloudSnapshot | null>(null)
  useEffect(() => {
    let alive = true
    let revision = 0
    const refresh = () => {
      const request = ++revision
      void transport
        .invoke(Queries.GetNexusCloud)
        .then((raw) => {
          const parsed = cloudSnapshotSchema.safeParse(raw)
          if (alive && request === revision && parsed.success)
            setState(parsed.data)
        })
        .catch(() => undefined)
    }
    transport.on(Events.NexusWorkspaceChanged, refresh)
    const detach = transport.onConnectionChange?.((event) => {
      if (event.state === 'connected') refresh()
    })
    refresh()
    return () => {
      alive = false
      transport.off(Events.NexusWorkspaceChanged, refresh)
      detach?.()
    }
  }, [])
  return state
}
let pendingInput = ''
export function setCloudInput(input: string) {
  pendingInput = input
}
export function takeCloudInput() {
  const input = pendingInput
  pendingInput = ''
  return input
}
