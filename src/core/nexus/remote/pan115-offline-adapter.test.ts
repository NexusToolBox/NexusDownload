// Constructed p115client ab2fd4d6 / YunX 1.3.4 protocol playback. SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'
import { remoteJobSchema } from '@shared/schemas/nexus-remote'
import { expect, it } from 'vitest'
import { CloudHttp } from '../cloud/cloud-http'
import { Pan115Adapter } from '../cloud/pan115-adapter'
import { pan115OfflineAdapter } from './pan115-offline-adapter'

it('uses an owned job directory, reports quota, reconciles a lost response and confines cleanup', async () => {
  const job = remoteJobSchema.parse({
    id: randomUUID(),
    key: 'key',
    adapter: '115:account',
    source: 'https://example.com/item',
    directory: 'D:/Downloads',
    maxBytes: 1024,
    createdAt: Date.now(),
  })
  const cookie = randomUUID()
  let created = false
  const calls: { url: URL; body: URLSearchParams }[] = []
  const a = new Pan115Adapter(
    new CloudHttp({
      cookie: () => `UID=${cookie}`,
      merge: async () => {},
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const body = new URLSearchParams(String(init?.body ?? ''))
        calls.push({ url, body })
        if (url.pathname === '/files/add') {
          created = true
          return Response.json({ state: true, cid: '77' })
        }
        if (url.pathname === '/files')
          return Response.json({
            state: true,
            count: created ? 1 : 0,
            data: created
              ? [{ cid: '77', n: `NexusDownload_tr_${job.id}` }]
              : [],
          })
        if (url.pathname === '/rb/delete') return Response.json({ state: true })
        const ac = body.get('ac') || url.searchParams.get('ac')
        if (ac === 'get_quota_info')
          return Response.json({ state: true, quota: 9, total: 10 })
        if (ac === 'add_task_url') {
          expect(body.get('wp_path_id')).toBe('77')
          return Response.json({ state: true, info_hash: 'remote-hash' })
        }
        if (ac === 'task_lists')
          return Response.json({
            state: true,
            tasks: [
              {
                info_hash: 'remote-hash',
                url: job.source,
                wp_path_id: '77',
                status: 2,
                percentDone: 100,
              },
            ],
          })
        if (ac === 'task_del') {
          expect(body.get('flag')).toBe('0')
          return Response.json({ state: true })
        }
        throw new Error('unexpected request')
      },
    })
  )
  const remote = pan115OfflineAdapter(() => a)
  job.remoteId = await remote.submit(job)
  expect(await remote.query(job)).toEqual({
    ready: true,
    progress: 100,
    usage: '9 / 10',
  })
  expect(JSON.parse((await remote.recover(job))!)).toEqual(
    JSON.parse(job.remoteId)
  )
  await remote.cleanup(job)
  expect(
    calls.filter((c) => c.url.pathname === '/rb/delete')[0].body.get('fid[0]')
  ).toBe('77')
})
it('requires a logged-in account and treats platform verification as a pause', async () => {
  const a = new Pan115Adapter(
    new CloudHttp({ cookie: () => '', merge: async () => {} })
  )
  await expect(a.offline('task_lists')).rejects.toThrow('cloud.login')
  const b = new Pan115Adapter(
    new CloudHttp({
      cookie: () => randomUUID(),
      merge: async () => {},
      fetch: async () =>
        Response.json({ state: false, errno: 911, error: 'captcha' }),
    })
  )
  await expect(b.offline('add_task_url', {}, true)).rejects.toThrow(
    'cloud.captcha'
  )
})

it('recognizes the offline errcode authorization response without surfacing its body', async () => {
  const a = new Pan115Adapter(
    new CloudHttp({
      cookie: () => randomUUID(),
      merge: async () => {},
      fetch: async () => Response.json({ state: false, errcode: 990001 }),
    })
  )
  await expect(a.offline('task_lists')).rejects.toThrow('cloud.login')
})
