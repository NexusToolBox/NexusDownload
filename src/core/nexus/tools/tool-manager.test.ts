import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { CredentialBroker } from '../cloud/credential-broker'
import { ToolManager, toolDownloadUrl } from './tool-manager'

it('limits mirror prefixes to HTTPS without credentials, preserving the pinned URL', () => {
  const url = 'https://github.com/owner/repo/releases/download/v1/tool.exe'
  expect(toolDownloadUrl(url, 'https://mirror.example.test/')).toBe(
    `https://mirror.example.test/${url}`
  )
  expect(
    toolDownloadUrl(
      'https://codeberg.org/asset',
      'https://mirror.example.test/'
    )
  ).toBe('https://codeberg.org/asset')
  expect(() => toolDownloadUrl(url, 'http://mirror.example.test')).toThrow()
  expect(() =>
    toolDownloadUrl(url, 'https://mirror.example.test/?url=')
  ).toThrow()
})

it('rejects changed tool bytes before installing or writing a receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-tool-'))
  try {
    const broker = new CredentialBroker(path.join(root, 'receipt'), {
      available: async () => true,
      encrypt: async (s) => Buffer.from(s),
      decrypt: async (b) => b.toString(),
    })
    await broker.load()
    const tools = new ToolManager(
      root,
      broker,
      () => undefined,
      async () => new Response('untrusted bytes')
    )
    await expect(
      tools.action({ action: 'install', id: 'yt-dlp' })
    ).rejects.toThrow('tools.hash')
    expect(
      tools.snapshot().tools.find((t) => t.id === 'yt-dlp')?.installed
    ).toBe(null)
    await expect(tools.executable('yt-dlp')).rejects.toThrow('tools.yt-dlp')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
