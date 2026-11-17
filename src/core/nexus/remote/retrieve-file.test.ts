import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { remoteFileSchema, remoteJobSchema } from '@shared/schemas/nexus-remote'
import { expect, it, vi } from 'vitest'
import { retrieveRemoteFile } from './retrieve-file'

it('resumes interrupted bytes with strict Range identity and verifies the trusted hash', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexus-range-'))
  try {
    const bytes = Buffer.from('a complete remote file')
    const job = remoteJobSchema.parse({
      id: randomUUID(),
      key: 'key',
      adapter: 'test',
      source: 'https://example.com',
      directory,
      maxBytes: 1024,
      createdAt: Date.now(),
    })
    const file = remoteFileSchema.parse({
      id: 'file',
      name: 'item.dat',
      bytes: bytes.length,
      hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    })
    let calls = 0
    const fetcher = vi.fn<typeof fetch>(async (_url, opts) => {
      calls++
      if (calls === 1) {
        let reads = 0
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (reads++ === 0) controller.enqueue(bytes.subarray(0, 5))
              else controller.error(new Error('reset'))
            },
          }),
          { headers: { etag: '"file-v1"' } }
        )
      }
      expect(opts?.headers).toMatchObject({
        Range: 'bytes=5-',
        'If-Range': '"file-v1"',
      })
      return new Response(bytes.subarray(5), {
        status: 206,
        headers: {
          etag: '"file-v1"',
          'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`,
        },
      })
    })
    const resolve = async () => ({
      url: 'https://example.com/item',
      headers: {},
    })
    await expect(
      retrieveRemoteFile(job, file, resolve, async () => {}, fetcher)
    ).rejects.toThrow()
    await retrieveRemoteFile(job, file, resolve, async () => {}, fetcher)
    expect(file.verified).toBe(true)
    expect(await readFile(file.localPath!)).toEqual(bytes)
    expect(
      (await readdir(path.dirname(file.localPath!))).some((f) =>
        f.endsWith('.part')
      )
    ).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('never marks a mismatched hash as verified', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexus-hash-'))
  try {
    const job = remoteJobSchema.parse({
      id: randomUUID(),
      key: 'key',
      adapter: 'test',
      source: 'https://example.com',
      directory,
      maxBytes: 1024,
      createdAt: Date.now(),
    })
    const file = remoteFileSchema.parse({
      id: 'file',
      name: 'item.dat',
      bytes: 4,
      hash: `sha256:${createHash('sha256').update('good').digest('hex')}`,
    })
    await expect(
      retrieveRemoteFile(
        job,
        file,
        async () => ({ url: 'https://example.com/item', headers: {} }),
        async () => {},
        async () => new Response('evil')
      )
    ).rejects.toThrow('remote.integrity')
    expect(file.verified).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
