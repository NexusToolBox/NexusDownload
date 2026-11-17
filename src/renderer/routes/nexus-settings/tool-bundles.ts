import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import type { ToolId } from '@shared/schemas/nexus-tools'

export const TOOL_BUNDLES = {
  video: ['yt-dlp', 'deno', 'ffmpeg'],
  gallery: ['gallery-dl'],
  archive: ['7zip'],
} as const satisfies Record<string, readonly ToolId[]>

export function toolBundle(id: string): keyof typeof TOOL_BUNDLES {
  return id === 'gallery-dl' ? 'gallery' : id === '7zip' ? 'archive' : 'video'
}

export async function changeToolBundle(
  bundle: keyof typeof TOOL_BUNDLES,
  action: 'install' | 'uninstall'
) {
  for (const id of TOOL_BUNDLES[bundle]) {
    const result = (await transport.invoke(Commands.NexusToolsAction, {
      action,
      id,
    })) as { ok: boolean; error?: string }
    if (!result.ok) throw new Error(result.error || 'tools.failed')
  }
}
