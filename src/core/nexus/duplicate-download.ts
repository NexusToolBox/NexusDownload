import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { NexusDuplicate } from '@shared/schemas/nexus-duplicate'
import { type DownloadTask, TaskStatus } from '@shared/types/task'

export function normalizedSourceIdentity(input: string): string {
  const url = new URL(input)
  let canonical: string
  if (url.protocol === 'magnet:') {
    let hash = url.searchParams
      .getAll('xt')
      .map(
        (value) => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.exec(value)?.[1]
      )
      .find(Boolean)
    if (!hash) throw new Error('Invalid magnet')
    if (hash.length === 32) {
      let bits = 0,
        value = 0
      const bytes: number[] = []
      for (const character of hash.toUpperCase()) {
        value =
          (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character)
        bits += 5
        if (bits >= 8) {
          bits -= 8
          bytes.push((value >>> bits) & 255)
        }
      }
      hash = Buffer.from(bytes).toString('hex')
    }
    canonical = `btih:${hash.toLowerCase()}`
  } else {
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_.*|spm|spm_id_from|fbclid|gclid|msclkid)$/i.test(key))
        url.searchParams.delete(key)
    url.searchParams.sort()
    canonical = url.href
  }
  return createHash('sha256').update(canonical).digest('hex')
}

/** Completed history only counts while its published output is still present. */
export async function duplicateTask(
  task: DownloadTask | undefined
): Promise<NexusDuplicate | undefined> {
  if (!task || task.status === TaskStatus.Removed) return
  if (task.status !== TaskStatus.Completed)
    return { taskId: task.id, status: 'active' }
  const output = task.finalPath || task.diskPath
  if (!output || !(await stat(output).catch(() => null))) return
  return { taskId: task.id, status: 'completed' }
}
