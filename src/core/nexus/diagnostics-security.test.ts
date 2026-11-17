import { randomBytes } from 'node:crypto'
import {
  access,
  appendFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { NexusDiagnostics } from './diagnostics'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function fixture(enabled: boolean, maxBytes?: number) {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-diagnostics-'))
  roots.push(root)
  const directory = path.join(root, 'diagnostics')
  return {
    directory,
    diagnostics: new NexusDiagnostics({
      directory,
      enabled: () => enabled,
      maxBytes,
    }),
  }
}
describe('private diagnostic evidence', () => {
  it('writes nothing while disabled', async () => {
    const { directory, diagnostics } = await fixture(false)
    await diagnostics.record('workspace', 'snapshot', { taskCount: 1 })
    await diagnostics.drain()
    expect(
      await access(directory)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
  })
  it('rejects arbitrary fields and revalidates exported files', async () => {
    const secret = randomBytes(24).toString('hex')
    const { directory, diagnostics } = await fixture(true)
    await diagnostics.record('workspace', 'snapshot', { taskCount: 2 })
    await diagnostics.record('workspace', 'snapshot', {
      token: secret,
    } as unknown as { taskCount: number })
    await appendFile(
      path.join(directory, 'workspace.jsonl'),
      `${JSON.stringify({ at: Date.now(), module: 'workspace', event: 'snapshot', data: { token: secret, cookie: secret, nickname: secret, avatarUrl: secret } })}\n`
    )
    const bundle = gunzipSync(await diagnostics.bundle()).toString('utf8')
    expect(bundle.includes(secret)).toBe(false)
    const parsed = JSON.parse(bundle)
    expect(parsed.records).toHaveLength(1)
    expect(
      (await readFile(path.join(directory, 'workspace.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean)
    ).toHaveLength(2)
  })
  it('bounds module rotation and event rates', async () => {
    const { directory, diagnostics } = await fixture(true, 200)
    await Promise.all(
      Array.from({ length: 50 }, () =>
        diagnostics.record('transfer', 'completed', { fileCount: 1 })
      )
    )
    const files = await readdir(directory)
    expect(files.length <= 4).toBe(true)
    const records = JSON.parse(
      gunzipSync(await diagnostics.bundle()).toString('utf8')
    ).records
    expect(records.length <= 10).toBe(true)
  })
})
