// Protocol adapted from p115client ab2fd4d6115607fd6dac1238ebbfb074d3dea4d7 (MIT).
// File access reuses YunX Desktop 1.3.4 translations. SPDX-License-Identifier: AGPL-3.0-only

import { type RemoteJob, remoteFileSchema } from '@shared/schemas/nexus-remote'
import { z } from 'zod'
import type { AdapterFile } from '../cloud/cloud-adapter'
import { array, object, text } from '../cloud/cloud-http'
import type { Pan115Adapter } from '../cloud/pan115-adapter'
import type { RemoteJobAdapter } from './remote-job-adapter'
import { retrieveRemoteFile } from './retrieve-file'

const refSchema = z.object({
  hash: z.string().min(1),
  directory: z.string().min(1),
})
export function pan115OfflineAdapter(
  get: () => Pan115Adapter,
  fetcher?: typeof fetch
): RemoteJobAdapter {
  const ref = (job: RemoteJob) =>
    refSchema.parse(JSON.parse(job.remoteId || '{}'))
  const folder = async (job: RemoteJob, create = false) => {
    const a = get()
    const name = `NexusDownload_tr_${job.id}`
    const matches = (await a.listFiles('0')).filter(
      (f) => f.directory && f.name === name
    )
    if (matches.length > 1) throw new Error('remote.identity')
    if (matches[0]) return matches[0].id
    return create ? a.ensureTempDir(name) : null
  }
  const tasks = async () => {
    const all: Record<string, unknown>[] = []
    for (let page = 1; page <= 100; page++) {
      const data = await get().offline('task_lists', {
        page: String(page),
        page_size: '30',
      })
      const rows = array(data.tasks ?? object(data.data).tasks)
      all.push(...rows)
      if (rows.length < 30) return all
    }
    throw new Error('remote.invalid')
  }
  const find = async (job: RemoteJob) => {
    const r = ref(job)
    const row = (await tasks()).find((t) => text(t.info_hash) === r.hash)
    if (!row) throw new Error('remote.missing')
    // A cloud service moving the target outside our job directory must stop cleanup.
    if (text(row.wp_path_id) && text(row.wp_path_id) !== r.directory)
      throw new Error('remote.identity')
    return row
  }
  const files = async (job: RemoteJob) => {
    const a = get()
    const root = ref(job).directory
    const found: AdapterFile[] = []
    const visited = new Set<string>()
    const walk = async (id: string, depth = 0) => {
      if (visited.has(id) || depth > 32 || found.length > 5000)
        throw new Error('remote.invalid')
      visited.add(id)
      for (const f of await a.listFiles(id)) {
        if (f.directory) await walk(f.id, depth + 1)
        else found.push(f)
      }
    }
    await walk(root)
    return found
  }
  return {
    async submit(job) {
      const a = get()
      const directory = await folder(job, true)
      const quota = await a.offline('get_quota_info')
      if (Number(quota.quota) === 0) throw new Error('remote.quota')
      if (!directory) throw new Error('remote.invalid')
      const data = await a.offline(
        'add_task_url',
        { url: job.source, wp_path_id: directory },
        true
      )
      const hash = text(data.info_hash ?? object(data.data).info_hash)
      if (!hash) throw new Error('remote.uncertain')
      return JSON.stringify({ hash, directory })
    },
    async recover(job) {
      const directory = await folder(job)
      if (!directory) return null
      const rows = (await tasks()).filter(
        (t) =>
          text(t.wp_path_id) === directory &&
          (text(t.url) === job.source ||
            text(t.info_hash).toLowerCase() ===
              /btih:([a-f0-9]{40})/i.exec(job.source)?.[1]?.toLowerCase())
      )
      return rows.length === 1
        ? JSON.stringify({ directory, hash: text(rows[0].info_hash) })
        : null
    },
    async query(job) {
      const row = await find(job)
      const status = Number(row.status)
      if (status < 0 || status === -1) throw new Error('remote.failed')
      const quota = await get().offline('get_quota_info')
      const usage =
        typeof quota.quota === 'number' && typeof quota.total === 'number'
          ? `${quota.quota} / ${quota.total}`
          : undefined
      return {
        ready: status === 2,
        progress: Number(row.percentDone) || 0,
        usage,
      }
    },
    async listFiles(job) {
      return (await files(job)).map((f) =>
        remoteFileSchema.parse({
          id: f.id,
          name: f.name,
          bytes: f.bytes,
          hash: f.hash ? `sha1:${f.hash}` : undefined,
        })
      )
    },
    async retrieve(job, file, checkpoint) {
      const original = (await files(job)).find((f) => f.id === file.id)
      if (
        !original ||
        original.bytes !== file.bytes ||
        (file.hash && `sha1:${original.hash}` !== file.hash)
      )
        throw new Error('remote.identity')
      await retrieveRemoteFile(
        job,
        file,
        async () => get().getDownloadLink(original, 'own'),
        checkpoint,
        fetcher
      )
    },
    async cleanup(job) {
      const directory = ref(job).directory
      const existing = await folder(job)
      if (existing && existing !== directory) throw new Error('remote.identity')
      if (existing) {
        await get().restoreTransfer('', directory)
        await get().cleanupTempDir(directory)
      }
      await get().offline(
        'task_del',
        { 'hash[0]': ref(job).hash, flag: '0' },
        true
      )
    },
  }
}
