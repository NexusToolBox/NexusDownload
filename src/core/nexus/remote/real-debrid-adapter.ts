import type { RemoteJob } from '@shared/schemas/nexus-remote'
import { remoteFileSchema } from '@shared/schemas/nexus-remote'
import { mediaUrl, obj, str } from '../media/domestic-parsers'
import type { RemoteJobAdapter } from './remote-job-adapter'
import { retrieveRemoteFile } from './retrieve-file'

type Api = (
  route: string,
  method?: string,
  data?: Record<string, string>
) => Promise<Record<string, unknown>>
/** Real-Debrid REST 1.0; no account authorization is forwarded to download hosts. */
export function realDebridAdapter(
  api: Api,
  fetcher?: typeof fetch
): RemoteJobAdapter {
  const info = (job: RemoteJob) => api(`torrents/info/${job.remoteId}`)
  return {
    async submit(job) {
      if (job.source.startsWith('magnet:'))
        return str(
          (await api('torrents/addMagnet', 'POST', { magnet: job.source })).id
        )
      const result = await api('unrestrict/link', 'POST', {
        link: mediaUrl(job.source),
      })
      if (!str(result.id)) throw new Error('remote.invalid')
      return `link:${str(result.id)}`
    },
    async recover(job) {
      if (job.remoteId) return job.remoteId
      if (!job.source.startsWith('magnet:')) return null
      const hash = /btih:([a-f0-9]{40})/i.exec(job.source)?.[1]?.toLowerCase()
      if (!hash) return null
      const results = await api('torrents')
      const rows = Array.isArray(results.items) ? results.items : []
      const matches = rows
        .map(obj)
        .filter((r) => str(r.hash).toLowerCase() === hash)
      return matches.length === 1 ? str(matches[0].id) : null
    },
    async query(job) {
      if (job.remoteId?.startsWith('link:'))
        return { ready: true, progress: 100 }
      let data = await info(job)
      if (data.status === 'waiting_files_selection') {
        await api(`torrents/selectFiles/${job.remoteId}`, 'POST', {
          files: 'all',
        })
        data = await info(job)
      }
      if (['magnet_error', 'error', 'virus', 'dead'].includes(str(data.status)))
        throw new Error('remote.failed')
      return {
        ready: data.status === 'downloaded',
        progress: Number(data.progress) || 0,
      }
    },
    async listFiles(job) {
      if (job.remoteId?.startsWith('link:')) {
        const rows = (await api('downloads')).items
        const data = obj(
          (Array.isArray(rows) ? rows : []).find(
            (r) => str(obj(r).id) === job.remoteId?.slice(5)
          )
        )
        return [
          remoteFileSchema.parse({
            id: job.remoteId,
            name: str(data.filename),
            bytes: Number(data.filesize),
          }),
        ]
      }
      const data = await info(job)
      return (Array.isArray(data.files) ? data.files : [])
        .map(obj)
        .filter((f) => !!f.selected)
        .map((f) =>
          remoteFileSchema.parse({
            id: String(f.id),
            name: str(f.path),
            bytes: Number(f.bytes),
          })
        )
    },
    async retrieve(job, file, checkpoint) {
      await retrieveRemoteFile(
        job,
        file,
        async () => {
          if (job.remoteId?.startsWith('link:')) {
            const rows = (await api('downloads')).items
            const data = obj(
              (Array.isArray(rows) ? rows : []).find(
                (r) => str(obj(r).id) === job.remoteId?.slice(5)
              )
            )
            return { url: mediaUrl(data.download), headers: {} }
          }
          const data = await info(job)
          const selected = (Array.isArray(data.files) ? data.files : [])
            .map(obj)
            .filter((f) => !!f.selected)
          const index = selected.findIndex((f) => String(f.id) === file.id)
          const links = Array.isArray(data.links) ? data.links : []
          const result = await api('unrestrict/link', 'POST', {
            link: mediaUrl(links[index]),
          })
          if (Number(result.filesize) !== file.bytes)
            throw new Error('remote.identity')
          return { url: mediaUrl(result.download), headers: {} }
        },
        checkpoint,
        fetcher
      )
    },
    async cleanup(job) {
      if (job.remoteId?.startsWith('link:'))
        await api(`downloads/delete/${job.remoteId.slice(5)}`, 'DELETE')
      else await api(`torrents/delete/${job.remoteId}`, 'DELETE')
    },
  }
}
