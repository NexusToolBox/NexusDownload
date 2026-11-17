import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { connectorSchema } from '@shared/schemas/nexus-services'
import { afterEach, expect, it, vi } from 'vitest'
import { CredentialBroker } from '../cloud/credential-broker'
import { ServiceConnectors } from './service-connectors'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true })
})
async function fixture(fetcher: typeof fetch) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-services-'))
  dirs.push(root)
  const broker = new CredentialBroker(path.join(root, 'data'), {
    available: async () => true,
    encrypt: async (s) => Buffer.from(s),
    decrypt: async (b) => b.toString(),
  })
  await broker.load()
  const service = new ServiceConnectors({
    broker,
    fetcher,
    changed: () => undefined,
    assertDisk: () => undefined,
  })
  await service.load()
  return service
}
it('uses declared host mappings without forwarding login context', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      data: { url: 'https://cdn.example.com/video.mp4', title: 'Video' },
    })
  )
  const service = await fixture(fetcher)
  await service.action({
    action: 'connector-save',
    connector: connectorSchema.parse({
      id: 'test',
      name: 'test',
      platforms: ['example.com'],
      endpoint: 'https://api.example.com/parse',
      method: 'POST',
    }),
  })
  expect(await service.parse('https://unrelated.test/video')).toBe(null)
  expect(
    (await service.parse('https://www.example.com/video'))?.assets[0].url
  ).toBe('https://cdn.example.com/video.mp4')
  expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
  expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Cookie')
})
it('rejects executable schemes and credential-bearing connector URLs', () => {
  for (const endpoint of [
    'http://example.com',
    'file:///test',
    'https://name@example.com/api',
  ])
    expect(() =>
      connectorSchema.parse({
        id: 'test',
        name: 'test',
        platforms: ['example.com'],
        endpoint,
        method: 'POST',
      })
    ).toThrow()
})
it('keeps device material private and respects the server polling interval', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      device_code: Math.random().toString(36),
      user_code: Math.random().toString(36).slice(2),
      verification_url: 'https://real-debrid.com/device',
      expires_in: 300,
      interval: 10,
    })
  )
  const service = await fixture(fetcher)
  await service.action({ action: 'rd-authorize' })
  expect(service.snapshot().realDebrid.device).not.toHaveProperty('code')
  // Mock pending credentials, then a second poll must remain local.
  fetcher.mockResolvedValue(Response.json({}))
  await service.action({ action: 'rd-poll' })
  await service.action({ action: 'rd-poll' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
