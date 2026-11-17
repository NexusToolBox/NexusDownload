import { z } from 'zod'
export const toolIdSchema = z.enum([
  'yt-dlp',
  'gallery-dl',
  '7zip',
  'ffmpeg',
  'deno',
])
export type ToolId = z.infer<typeof toolIdSchema>
export const toolManifest = {
  'yt-dlp': {
    version: '2026.10.26',
    source: 'https://github.com/yt-dlp/yt-dlp',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe',
    sha256: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
    files: ['yt-dlp.exe'],
    kind: 'exe',
  },
  'gallery-dl': {
    version: '1.32.20',
    source: 'https://codeberg.org/mikf/gallery-dl',
    url: 'https://codeberg.org/mikf/gallery-dl/releases/download/v1.32.20/gallery-dl.exe',
    sha256: 'e14e498e0d95a216b3019b4f899d813ebb322868052f4f0ecfa3a0600deb84b0',
    files: ['gallery-dl.exe'],
    kind: 'exe',
  },
  '7zip': {
    version: '26.06',
    source: 'https://www.7-zip.org/',
    url: 'https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.msi',
    sha256: '6dc822569e777d9a3ecd5ffcbc22b55600af87e6c5d9810a64e8566cf5a4af9f',
    files: ['7z.exe', '7z.dll'],
    kind: 'msi',
  },
  ffmpeg: {
    version: 'N-128915-g3d16b774d7',
    source: 'https://github.com/FFmpeg-Builds/FFmpeg-Builds',
    url: 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-15-12-40/ffmpeg-N-128915-g3d16b774d7-win64-lgpl.zip',
    sha256: 'bc39b32bbcb56c0dd679e69a37e63cfce88b911240946cccfe966d30f9a279b4',
    files: ['ffmpeg.exe', 'ffprobe.exe'],
    kind: 'zip',
  },
  deno: {
    version: '2.9.8',
    source: 'https://github.com/denoland/deno',
    url: 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip',
    sha256: 'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf',
    files: ['deno.exe'],
    kind: 'zip',
  },
} as const
export const toolActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install'), id: toolIdSchema }).strict(),
  z.object({ action: z.literal('uninstall'), id: toolIdSchema }).strict(),
  z
    .object({ action: z.literal('mirror'), prefix: z.string().max(2048) })
    .strict(),
])
