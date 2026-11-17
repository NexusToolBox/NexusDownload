import { createHash } from 'node:crypto'
import path from 'node:path'
import { relocatePortablePath } from '@core/session/portable-relocation'
import {
  CredentialBroker,
  type CredentialCipher,
} from './cloud/credential-broker'

// Only these records contain local paths. Cookies, URLs, sources and passwords
// remain opaque, even when their text happens to resemble a Windows path.
const records: Record<string, ReadonlySet<string>> = {
  'media-recovery': new Set(['saveDir', 'tmpDir', 'mediaMetaPath']),
  'external-jobs': new Set(['directory', 'files']),
  'processing-records': new Set([
    'directory',
    'files',
    'outputs',
    'archives',
    'source',
    'target',
  ]),
  packages: new Set(['directory']),
  'remote-jobs': new Set(['directory', 'localPath']),
  'cloud-state': new Set(['output', 'root']),
}

export function relocateJobRecord(
  key: string,
  raw: string,
  roots: string[],
  target: string
): string {
  const fields = records[key]
  if (!fields || !raw) return raw
  const visit = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string')
      return fields.has(field)
        ? relocatePortablePath(value, roots, target)
        : value
    if (Array.isArray(value)) return value.map((v) => visit(v, field))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, visit(v, k)])
      )
    return value
  }
  const document = JSON.parse(raw)
  const parsed =
    key === 'cloud-state'
      ? { ...document, bindings: visit(document.bindings) }
      : visit(document)
  if (key === 'remote-jobs' && Array.isArray(parsed))
    for (const job of parsed) {
      // The submit key includes the destination; moving must not duplicate a job.
      job.key = createHash('sha256')
        .update(
          JSON.stringify([job.adapter, job.source, path.resolve(job.directory)])
        )
        .digest('hex')
    }
  return JSON.stringify(parsed)
}

/** Called before the portable relocation journal commits, so failures retry. */
export async function relocateEncryptedJobs(
  directory: string,
  roots: string[],
  target: string,
  cipher: CredentialCipher
) {
  for (const name of ['nexus-media.bin', 'nexus-credentials.bin']) {
    const broker = new CredentialBroker(path.join(directory, name), cipher)
    await broker.load()
    for (const key of Object.keys(records)) {
      const original = broker.get(key)
      const next = relocateJobRecord(key, original, roots, target)
      if (next !== original) await broker.update(key, () => next)
    }
    await broker.drain()
  }
}
