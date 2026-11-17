import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { redactLogText } from '@shared/lib/log-redact'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialBroker, mergeCookies } from './credential-broker'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
describe('credential boundary', () => {
  it('never overwrites an unreadable vault through a later guest request', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-vault-corrupt-'))
    roots.push(root)
    const file = path.join(root, 'vault.bin'),
      original = randomBytes(64)
    await writeFile(file, original)
    const broker = new CredentialBroker(file, {
      available: async () => true,
      encrypt: async () => Buffer.alloc(0),
      decrypt: async () => {
        throw new Error('unavailable')
      },
    })
    await expect(broker.load()).rejects.toThrow('cloud.login')
    await expect(
      broker.update('cloud-state', () => JSON.stringify({}))
    ).rejects.toThrow('cloud.login')
    expect((await readFile(file)).equals(original)).toBe(true)
  })
  it('serializes refreshes and only commits state after encryption and disk write', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-vault-'))
    roots.push(root)
    const mask = randomBytes(32)
    const transform = (b: Buffer) =>
      Buffer.from(b.map((v, i) => v ^ mask[i % mask.length]))
    const cipher = {
      available: async () => true,
      encrypt: async (s: string) => transform(Buffer.from(s)),
      decrypt: async (b: Buffer) => transform(b).toString(),
    }
    const file = path.join(root, 'vault.bin')
    const broker = new CredentialBroker(file, cipher)
    await broker.load()
    const secret = randomBytes(32).toString('hex')
    await broker.update('account', () => secret)
    await Promise.all([
      broker.update('counter', () => '1'),
      broker.update('counter', (current) => String(Number(current) + 1)),
    ])
    expect(broker.get('counter') === '2').toBe(true)
    expect((await readFile(file)).includes(secret)).toBe(false)
    const restored = new CredentialBroker(file, cipher)
    await restored.load()
    expect(restored.get('account') === secret).toBe(true)
    let exchanges = 0
    const rotated = randomBytes(32).toString('hex')
    const exchange = async () => {
      exchanges++
      await broker.update('counter', () => '3')
      return rotated
    }
    await Promise.all([
      broker.refresh('account', exchange),
      broker.refresh('account', exchange),
    ])
    expect(exchanges).toBe(1)
    expect(broker.get('account') === rotated).toBe(true)
    await expect(
      broker.refresh('account', async () => {
        await broker.remove('account')
        return secret
      })
    ).rejects.toThrow('cloud.login')
    await broker.update('account', () => secret)
    cipher.available = async () => false
    await expect(broker.update('account', () => '')).rejects.toThrow(
      'cloud.login'
    )
    expect(broker.get('account') === secret).toBe(true)
  })
  it('merges response cookies for every platform and redacts secrets in free text', () => {
    const a = randomBytes(12).toString('hex')
    const b = randomBytes(12).toString('hex')
    expect(
      mergeCookies(`__pus=${a}`, [
        `__puus=${b}; Path=/`,
        `foreign=${b}`,
      ]).includes('foreign')
    ).toBe(true)
    const log = redactLogText(
      `Cookie: __pus=${a}\n提取码：${b}\nhttps://invalid.test/f?stoken=${a}&passcode=${b}`
    )
    expect(log.includes(a) || log.includes(b)).toBe(false)
  })
})
