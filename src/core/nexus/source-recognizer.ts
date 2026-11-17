import { createHash, randomUUID } from 'node:crypto'
import type {
  NexusFileType,
  NexusInboxEntry,
  NexusPlatform,
} from '@shared/schemas/nexus-workspace'

const platforms: [RegExp, NexusPlatform][] = [
  [/^(?:pan|yun)\.baidu\.com$/, 'baidu'],
  [/^pan\.quark\.cn$/, 'quark'],
  [/^drive\.uc\.cn$/, 'uc'],
  [/^(?:www\.)?(?:alipan|aliyundrive)\.com$/, 'aliyun'],
  [/^(?:www\.)?115(?:cdn)?\.com$|^115pan\.com$/, '115'],
  [/^(?:www\.)?123(?:pan|684|865)\.com$|^(?:www\.)?123pan\.cn$/, '123'],
]
const extensions: [NexusFileType, string[]][] = [
  ['video', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'ts', 'm4v', 'm3u8', 'mpd']],
  ['audio', ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg']],
  ['archive', ['zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz']],
  [
    'document',
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub'],
  ],
  ['software', ['exe', 'msi', 'msix', 'iso', 'img']],
  ['image', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']],
]
export function classifyFilename(name: string): NexusFileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return extensions.find(([, values]) => values.includes(ext))?.[0] ?? 'other'
}
export function recognizeSources(
  input: string
): { entry: NexusInboxEntry; raw: string }[] {
  const matches =
    input.match(
      /magnet:\?[^\s<>"'，。；）]+|(?:https?|ftp):\/\/[^\s<>"'，。；）]+/gi
    ) ?? []
  const seen = new Set<string>()
  const result: { entry: NexusInboxEntry; raw: string }[] = []
  for (const match of matches.slice(0, 50)) {
    const raw = match.replace(/[),;。]+$/, '')
    try {
      const url = new URL(raw)
      if (url.username || url.password) continue
      let platform: NexusPlatform = 'http'
      let identityInput = raw
      let title = url.hostname
      let shareId: string | undefined
      if (url.protocol === 'magnet:') {
        const hash = url.searchParams
          .get('xt')
          ?.match(/^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i)?.[1]
        if (!hash) continue
        platform = 'magnet'
        identityInput = hash.toLowerCase()
        title = url.searchParams.get('dn')?.slice(0, 200) || 'BitTorrent'
      } else {
        platform =
          platforms.find(([pattern]) =>
            pattern.test(url.hostname.toLowerCase())
          )?.[1] ?? 'http'
        if (platform !== 'http') {
          shareId = url.pathname.match(/\/(?:s|t)\/([a-zA-Z0-9_-]{1,128})/)?.[1]
          title = url.hostname
        } else {
          const name = decodeURIComponent(url.pathname.split('/').pop() || '')
          // Long opaque path tokens remain memory-only, just like query credentials.
          title =
            name && name.length < 160 && /\.[a-z0-9]{1,8}$/i.test(name)
              ? name
              : url.hostname
        }
      }
      const identity = createHash('sha256').update(identityInput).digest('hex')
      if (seen.has(identity)) continue
      seen.add(identity)
      const id = randomUUID()
      result.push({
        raw,
        entry: {
          id,
          title,
          fileType:
            /(^|\.)github(?:usercontent)?\.com$/i.test(url.hostname) &&
            /\.zip$/i.test(title)
              ? 'software'
              : classifyFilename(title),
          addedAt: Date.now(),
          source: {
            id,
            identity,
            platform,
            host: url.hostname,
            shareId,
            resourceKind: 'original-file',
            expectedBytes: null,
          },
        },
      })
    } catch {
      /* Unrecognized text remains outside the download workflow. */
    }
  }
  return result
}
