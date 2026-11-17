import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { CredentialBroker } from '../cloud/credential-broker'
import { privateAddress } from './http-guard'
import { PhoneServer } from './phone-server'

const dispose: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const fn of dispose.splice(0).reverse()) await fn()
})
it('pairs by a code entered on the desktop, scopes permissions, and immediately revokes access', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-phone-'))
  dispose.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'phone.html'), '<title>NexusDownload</title>')
  const data = new Map<string, string>()
  const broker = {
    get: (k: string) => data.get(k) || '',
    update: async (k: string, fn: (s: string) => string) => {
      data.set(k, fn(data.get(k) || ''))
    },
  } as unknown as CredentialBroker
  const collect = vi.fn(),
    control = vi.fn()
  const phone = new PhoneServer({
    broker,
    webRoot: root,
    addresses: () => ['192.168.1.2'],
    changed: () => {},
    collect,
    control,
    tasks: () => [
      {
        id: 'task',
        status: 'paused',
        type: 'http',
        bytes: 100,
        completed: 30,
        speed: 0,
        failure: null,
      },
    ],
  })
  dispose.push(() => phone.stop())
  await phone.load()
  expect(phone.snapshot().urls).toEqual([])
  await phone.start(0)
  const port = new URL(phone.snapshot().urls[0]).port
  const base = `http://127.0.0.1:${port}`
  const post = (route: string, body: unknown, token?: string) =>
    fetch(base + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  expect((await fetch(base + '/tasks')).status).toBe(401)
  expect(
    (await fetch(base + '/', { headers: { Origin: 'https://example.org' } }))
      .status
  ).toBe(403)
  const rebound = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      base,
      { headers: { Host: `evil.invalid:${port}` } },
      (res) => {
        res.resume()
        resolve(res.statusCode)
      }
    )
    req.on('error', reject)
    req.end()
  })
  expect(rebound).toBe(403)
  expect((await fetch(base + '/')).status).toBe(200)
  const request = await (await post('/pair', { name: 'Phone' })).json()
  await expect(phone.approve('WRONG')).rejects.toThrow('control.pairing')
  await phone.approve(request.userCode)
  const result = await (
    await post('/poll', { requestId: request.requestId })
  ).json()
  expect(result.status).toBe('approved')
  expect(
    (await (await post('/poll', { requestId: request.requestId })).json())
      .status
  ).toBe('expired')
  expect(
    (
      await fetch(base + '/tasks', {
        headers: { Authorization: `Bearer ${result.token}` },
      })
    ).status
  ).toBe(200)
  expect(
    (
      await post(
        '/action',
        { action: 'collect', input: '磁力或分享口令' },
        result.token
      )
    ).status
  ).toBe(200)
  expect(collect).toHaveBeenCalledWith('磁力或分享口令')
  await post('/action', { action: 'resume', id: 'task' }, result.token)
  expect(control).toHaveBeenCalledWith('resume', 'task')
  expect(
    (await post('/action', { action: 'delete', id: 'task' }, result.token))
      .status
  ).toBe(400)
  await phone.revoke(phone.snapshot().devices[0].id)
  expect(
    (
      await fetch(base + '/tasks', {
        headers: { Authorization: `Bearer ${result.token}` },
      })
    ).status
  ).toBe(401)
  await phone.stop()
  expect(phone.snapshot().urls).toEqual([])
  await expect(fetch(base + '/')).rejects.toThrow()
})
it('only admits loopback and private IPv4 LAN peers', () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '172.31.5.2',
    '192.168.1.1',
    '::ffff:192.168.1.2',
  ])
    expect(privateAddress(ip)).toBe(true)
  for (const ip of [
    '8.8.8.8',
    '172.32.0.1',
    '169.254.1.2',
    '192.168.999.1',
    'fc00::1',
    'evil',
  ])
    expect(privateAddress(ip)).toBe(false)
})
