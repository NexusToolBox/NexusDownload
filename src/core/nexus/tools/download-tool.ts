import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { fileSha256 } from './file-sha256'

/** Pinned SHA-256 is authoritative even when a CDN cannot supply a strong ETag. */
export async function downloadTool(options: {
  url: string
  file: string
  sha256: string
  fetcher?: typeof fetch
  timeoutMs?: number
  attempts?: number
  delay?: (ms: number) => Promise<void>
  progress?: (state: {
    attempt: number
    downloaded: number
    total: number | null
  }) => void
}) {
  const fetcher = options.fetcher ?? fetch
  const delay =
    options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const metadata = `${options.file}.json`
  await mkdir(path.dirname(options.file), { recursive: true })
  let etag: string | undefined,
    total: number | null = null
  try {
    const saved = JSON.parse(await readFile(metadata, 'utf8'))
    if (saved.sha256 === options.sha256) {
      etag = typeof saved.etag === 'string' ? saved.etag : undefined
      total = Number.isSafeInteger(saved.total) ? saved.total : null
    }
  } catch {}
  const limit = 512 * 1024 ** 2
  for (let attempt = 1; attempt <= (options.attempts ?? 4); attempt++) {
    try {
      const stat = await lstat(options.file).catch(() => null)
      if (stat && (!stat.isFile() || stat.isSymbolicLink()))
        throw new Error('tools.path')
      let offset = stat?.size ?? 0
      options.progress?.({ attempt, downloaded: offset, total })
      if (offset > limit) throw new Error('tools.download')
      if (
        offset &&
        total === offset &&
        (await fileSha256(options.file)) === options.sha256
      ) {
        await rm(metadata, { force: true })
        return
      }
      let address = options.url,
        response: Response | undefined
      const signal = AbortSignal.timeout(options.timeoutMs ?? 120000)
      for (let hop = 0; hop < 8; hop++) {
        const url = new URL(address)
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('tools.download')
        response = await fetcher(address, {
          redirect: 'manual',
          credentials: 'omit',
          signal,
          headers: {
            'Accept-Encoding': 'identity',
            ...(offset
              ? {
                  Range: `bytes=${offset}-`,
                  ...(etag ? { 'If-Range': etag } : {}),
                }
              : {}),
          },
        })
        if (response.status < 300 || response.status >= 400) break
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new Error('tools.download')
        address = new URL(location, address).href
      }
      if (!response?.ok || !response.body) {
        await response?.body?.cancel()
        throw new Error('tools.download')
      }
      const encoding = response.headers.get('content-encoding')
      if (encoding && encoding !== 'identity') {
        await response.body.cancel()
        throw new Error('tools.download')
      }
      const currentEtag = response.headers.get('etag')
      if (offset && response.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get('content-range') || ''
        )
        if (
          !match ||
          Number(match[1]) !== offset ||
          Number(match[2]) !== Number(match[3]) - 1 ||
          (total !== null && total !== Number(match[3])) ||
          (etag && etag !== currentEtag)
        ) {
          await response.body.cancel()
          await rm(options.file, { force: true })
          etag = undefined
          total = null
          throw new Error('tools.download')
        }
        total = Number(match[3])
      } else if (response.status === 200) {
        // Servers without Range support can safely restart this one asset.
        offset = 0
        const length = response.headers.get('content-length')
        total =
          length && Number.isSafeInteger(Number(length)) ? Number(length) : null
      } else {
        await response.body.cancel()
        throw new Error('tools.download')
      }
      if (total !== null && (total < 0 || total > limit)) {
        await response.body.cancel()
        throw new Error('tools.download')
      }
      etag =
        currentEtag && !currentEtag.startsWith('W/') ? currentEtag : undefined
      await writeFileAtomic(
        metadata,
        JSON.stringify({ sha256: options.sha256, etag, total }),
        { mode: 0o600 }
      )
      const handle = await open(options.file, offset ? 'a' : 'w')
      try {
        for await (const chunk of response.body) {
          if (
            offset + chunk.length > limit ||
            (total !== null && offset + chunk.length > total)
          )
            throw new Error('tools.download')
          await handle.writeFile(chunk)
          offset += chunk.length
          options.progress?.({ attempt, downloaded: offset, total })
        }
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (total !== null && offset !== total) throw new Error('tools.download')
      if ((await fileSha256(options.file)) !== options.sha256) {
        await rm(options.file, { force: true })
        await rm(metadata, { force: true })
        throw new Error('tools.hash')
      }
      await rm(metadata, { force: true })
      return
    } catch (error) {
      if (
        error instanceof Error &&
        ['tools.hash', 'tools.path'].includes(error.message)
      )
        throw error
      if (attempt >= (options.attempts ?? 4)) throw new Error('tools.download')
      await delay(Math.min(8000, 1000 * 2 ** (attempt - 1)))
    }
  }
}
