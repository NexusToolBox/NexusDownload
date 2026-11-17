import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { downloadTool } from './download-tool'

it('retries a dropped response and resumes the saved prefix after a fresh invocation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-tool-resume-'))
  try {
    const bytes = Buffer.from('a complete pinned tool'),
      file = path.join(root, 'tool.part')
    const opts = {
      url: 'https://example.org/tool',
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      delay: async () => {},
    }
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = init?.headers as Record<string, string>
      if (headers.Range) {
        expect(headers.Range).toBe('bytes=5-')
        expect(headers['If-Range']).toBe('"stable"')
        return new Response(bytes.subarray(5), {
          status: 206,
          headers: {
            etag: '"stable"',
            'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`,
          },
        })
      }
      let read = false
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (!read) {
              read = true
              controller.enqueue(bytes.subarray(0, 5))
            } else controller.error(new Error('reset'))
          },
        }),
        {
          headers: { etag: '"stable"', 'content-length': String(bytes.length) },
        }
      )
    })
    await expect(
      downloadTool({ ...opts, fetcher, attempts: 1 })
    ).rejects.toThrow('tools.download')
    await downloadTool({ ...opts, fetcher })
    expect(await readFile(file)).toEqual(bytes)
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('automatically retries transient failures and never accepts a changed hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-tool-retry-'))
  try {
    const bytes = Buffer.from('trusted'),
      file = path.join(root, 'tool.part')
    const opts = {
      url: 'https://example.org/tool',
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      delay: async () => {},
    }
    let attempts = 0
    await downloadTool({
      ...opts,
      fetcher: async () => {
        if (attempts++ < 2) throw new Error('timeout')
        return new Response(bytes)
      },
    })
    expect(attempts).toBe(3)
    await rm(file)
    await expect(
      downloadTool({ ...opts, fetcher: async () => new Response('changed') })
    ).rejects.toThrow('tools.hash')
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
