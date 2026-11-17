import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import type { RemoteFile, RemoteJob } from '@shared/schemas/nexus-remote'

export async function verifyRemoteFile(file: string, meta: RemoteFile) {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== meta.bytes)
    throw new Error('remote.integrity')
  if (meta.hash) {
    const [algorithm, expected] = meta.hash.split(':')
    const hash = createHash(algorithm)
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    if (hash.digest('hex') !== expected.toLowerCase())
      throw new Error('remote.integrity')
  }
}
/** Separate per-job outputs, strict Range identity and no credentials in durable metadata. */
export async function retrieveRemoteFile(
  job: RemoteJob,
  file: RemoteFile,
  resolve: () => Promise<{ url: string; headers: Record<string, string> }>,
  checkpoint: () => Promise<void>,
  fetcher: typeof fetch = fetch
) {
  const root = await realpath(job.directory)
  const directory = path.join(root, `NexusDownload-${job.id}`)
  await mkdir(directory, { recursive: true })
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error('remote.path')
  const name = path
    .basename(file.name.replace(/\\/g, '/'))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject filesystem control characters
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error('remote.path')
  const prefix = createHash('sha256').update(file.id).digest('hex').slice(0, 12)
  const output = path.join(directory, `${prefix}-${name}`)
  const partial = `${output}.part`
  const finalStat = await lstat(output).catch(() => null)
  if (finalStat) {
    await verifyRemoteFile(output, file)
    file.localPath = output
    file.downloaded = file.bytes
    file.verified = true
    await checkpoint()
    return
  }
  const stat = await lstat(partial).catch(() => null)
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error('remote.path')
  let offset = stat?.size ?? 0
  if (offset > file.bytes) throw new Error('remote.integrity')
  if (offset && !file.hash && !file.etag) throw new Error('remote.identity')
  if (!file.bytes && !stat) await (await open(partial, 'wx')).close()
  if (offset < file.bytes) {
    const resource = await resolve()
    const url = new URL(resource.url)
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      )
    )
      throw new Error('remote.tls')
    const headers = {
      ...resource.headers,
      'Accept-Encoding': 'identity',
      ...(offset
        ? {
            Range: `bytes=${offset}-`,
            ...(file.etag ? { 'If-Range': file.etag } : {}),
          }
        : {}),
    }
    const response = await fetcher(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(300000),
    })
    const etag = response.headers.get('etag')
    if (
      offset &&
      (response.status !== 206 ||
        response.headers.get('content-range') !==
          `bytes ${offset}-${file.bytes - 1}/${file.bytes}` ||
        (file.etag && etag !== file.etag))
    ) {
      await response.body?.cancel()
      throw new Error('remote.identity')
    }
    if (!offset && response.status !== 200) {
      await response.body?.cancel()
      throw new Error('remote.network')
    }
    if (etag && !etag.startsWith('W/')) file.etag = etag
    await checkpoint()
    if (!response.body) throw new Error('remote.network')
    const handle = await open(partial, stat ? 'a' : 'wx')
    let saved = offset
    try {
      for await (const chunk of response.body) {
        if (offset + chunk.length > file.bytes)
          throw new Error('remote.integrity')
        await handle.writeFile(chunk)
        offset += chunk.length
        file.downloaded = offset
        if (offset - saved >= 4 * 1024 ** 2) {
          await handle.sync()
          await checkpoint()
          saved = offset
        }
      }
      await handle.sync()
    } finally {
      await handle.close()
      await checkpoint()
    }
  }
  await verifyRemoteFile(partial, file)
  await rename(partial, output)
  file.localPath = output
  file.downloaded = file.bytes
  file.verified = true
  await checkpoint()
}
