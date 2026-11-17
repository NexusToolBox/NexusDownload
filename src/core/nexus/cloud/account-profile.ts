import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'

export interface FetchedProfile {
  nickname: string
  avatar: string
  fields: string[]
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const at = (value: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((v, part) => record(v)[part], value)
function imageAddress(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value)
      if (url.protocol === 'https:' && !url.username && !url.password)
        return url.href
    } catch {
      /* Missing or malformed image field. */
    }
    return ''
  }
  // 115 returns a size-keyed object; prefer the largest numeric size.
  return (
    Object.entries(record(value))
      .sort(([a], [b]) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
      .map(([, image]) => imageAddress(image))
      .find(Boolean) ?? ''
  )
}
export function parseProfile(
  responses: unknown[],
  names: string[],
  avatars: string[]
): FetchedProfile {
  const fields = new Set<string>()
  const collect = (value: unknown, prefix = '', depth = 0) => {
    if (depth > 3 || fields.size >= 100) return
    for (const [key, child] of Object.entries(record(value))) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) continue
      const field = prefix ? `${prefix}.${key}` : key
      fields.add(field)
      collect(child, field, depth + 1)
    }
  }
  for (const response of responses) collect(response)
  const nickname = responses
    .flatMap((r) => names.map((key) => at(r, key)))
    .find((v) => typeof v === 'string' && v.trim())
  const avatar =
    responses
      .flatMap((r) => avatars.map((key) => imageAddress(at(r, key))))
      .find(Boolean) ?? ''
  return {
    nickname: typeof nickname === 'string' ? nickname.trim().slice(0, 256) : '',
    avatar,
    fields: [...fields],
  }
}
function imageType(bytes: Buffer): string | undefined {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'webp'
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif'
  return undefined
}
export async function cacheAvatar(
  directory: string,
  id: string,
  address: string,
  request = fetch
) {
  if (!/^account-[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid account id')
  if (!imageAddress(address)) return undefined
  const response = await request(address, {
    signal: AbortSignal.timeout(15000),
    credentials: 'omit',
  })
  if (!response.ok) return undefined
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const parts: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2 * 1024 * 1024) return undefined
      parts.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const bytes = Buffer.concat(parts)
  const ext = imageType(bytes)
  if (!ext) return undefined
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${id}.${ext}`)
  await writeFileAtomic(file, bytes)
  return file
}
export async function readAvatar(directory: string, file?: string) {
  if (!file || path.dirname(path.resolve(file)) !== path.resolve(directory))
    return undefined
  try {
    const bytes = await readFile(file)
    const ext = imageType(bytes)
    if (!ext || bytes.length > 2 * 1024 * 1024) return undefined
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`
  } catch {
    return undefined
  }
}
export async function removeAvatar(directory: string, file?: string) {
  if (file && path.dirname(path.resolve(file)) === path.resolve(directory))
    await rm(file, { force: true })
}
