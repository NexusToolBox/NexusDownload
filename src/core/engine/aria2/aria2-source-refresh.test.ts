import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Aria2Adapter } from './aria2-adapter'
import { Aria2RpcClient } from './aria2-rpc-client'
import type { JsonRpcProtocol } from './json-rpc-protocol'
import type { WebSocketTransport } from './web-socket-transport'

function rpcFixture() {
  const call = vi.fn().mockResolvedValue([1, 1])
  const protocol = { call, onNotification: vi.fn() }
  const client = new Aria2RpcClient(
    {} as WebSocketTransport,
    protocol as unknown as JsonRpcProtocol,
    ''
  )
  return { client, call }
}

function adapterFixture() {
  const rpc = {
    onBtDownloadComplete: vi.fn(),
    onDownloadComplete: vi.fn(),
    onDownloadError: vi.fn(),
    getFiles: vi.fn().mockResolvedValue([
      {
        index: '1',
        uris: [
          { uri: 'https://example.test/old', status: 'used' },
          { uri: 'https://example.test/old', status: 'waiting' },
        ],
      },
    ]),
    changeUri: vi.fn().mockResolvedValue([2, 1]),
    changeOption: vi.fn().mockResolvedValue('OK'),
    unpause: vi.fn(),
  }
  return {
    rpc,
    adapter: new Aria2Adapter(rpc as unknown as Aria2RpcClient),
  }
}

describe('HTTP source replacement', () => {
  it('keeps RPC file indices and insertion positions distinct and invalidates metadata', async () => {
    const { client, call } = rpcFixture()
    const changed = vi.fn()
    client.onTaskMetadataChanged(changed)
    await expect(
      client.changeUri('gid', 1, [], ['https://example.test/new'], 0)
    ).resolves.toEqual([1, 1])
    expect(call).toHaveBeenCalledWith(
      'aria2.changeUri',
      ['gid', 1, [], ['https://example.test/new'], 0],
      undefined
    )
    expect(changed).toHaveBeenCalledWith('gid')
    await client.changeUri('gid', 2, [], ['https://example.test/new'])
    expect(call.mock.calls[1]?.[1]).toHaveLength(4)
  })

  it.each([null, 'OK', [-1, 1], [0, '1'], [0, 1, 2]])(
    'rejects a malformed engine result without publishing it: %j',
    async (result) => {
      const { client, call } = rpcFixture()
      const changed = vi.fn()
      client.onTaskMetadataChanged(changed)
      call.mockResolvedValue(result)
      await expect(client.changeUri('gid', 1, [], [])).rejects.toThrow(
        'Invalid aria2 URI change result'
      )
      expect(changed).not.toHaveBeenCalled()
    }
  )

  it('replaces duplicate old sources and headers in order without resuming the task', async () => {
    const { adapter, rpc } = adapterFixture()
    // Values are generated at runtime and never saved as test snapshots.
    const credential = randomBytes(16).toString('hex')
    const headers = {
      Cookie: `p0=${credential}`,
      Referer: 'https://example.test/',
    }
    await expect(
      adapter.changeDownloadSource('gid', {
        uris: ['https://example.test/new'],
        headers,
        userAgent: 'NexusDownload-P0',
      })
    ).resolves.toEqual({ removed: 2, added: 1 })
    expect(rpc.changeUri).toHaveBeenCalledWith(
      'gid',
      1,
      ['https://example.test/old', 'https://example.test/old'],
      ['https://example.test/new'],
      0
    )
    const options = rpc.changeOption.mock.calls[0]?.[1] as {
      header: string[]
      referer: string
      'user-agent': string
    }
    // Boolean assertions keep failure diagnostics free of credential values.
    expect(options.header.includes(`Cookie: p0=${credential}`)).toBe(true)
    expect(options.header.includes('Referer: https://example.test/')).toBe(true)
    expect(options.referer).toBe('')
    expect(options['user-agent']).toBe('NexusDownload-P0')
    expect(rpc.changeUri.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.changeOption.mock.invocationCallOrder[0] ?? 0
    )
    expect(rpc.unpause).not.toHaveBeenCalled()
  })

  it('clears old custom headers and prevents fallback to an ambient cookie store', async () => {
    const { adapter, rpc } = adapterFixture()
    await adapter.changeDownloadSource('gid', {
      uris: ['https://example.test/new'],
      headers: {},
    })
    expect(rpc.changeOption).toHaveBeenCalledWith('gid', {
      header: ['Cookie: '],
      referer: '',
    })
  })

  it.each<import('../engine-adapter').ChangeDownloadSourceParams>([
    { uris: [], headers: {} },
    { uris: ['magnet:?xt=urn:btih:abc'], headers: {} },
    { uris: ['https://example.test/new'], headers: {}, fileIndex: 0 },
    { uris: ['https://example.test/new'], headers: { Range: 'bytes=0-' } },
    { uris: ['https://example.test/new'], headers: { Referer: 'x\r\ny' } },
  ])(
    'rejects unsafe replacement input before mutating the engine',
    async (params) => {
      const { adapter, rpc } = adapterFixture()
      await expect(
        adapter.changeDownloadSource('gid', params)
      ).rejects.toThrow()
      expect(rpc.changeUri).not.toHaveBeenCalled()
      expect(rpc.changeOption).not.toHaveBeenCalled()
    }
  )

  it('does not update headers when the output is missing or the URI change fails', async () => {
    const { adapter, rpc } = adapterFixture()
    rpc.getFiles.mockResolvedValueOnce([])
    const input = { uris: ['https://example.test/new'], headers: {} }
    await expect(adapter.changeDownloadSource('gid', input)).rejects.toThrow(
      'HTTP output file is unavailable'
    )
    rpc.changeUri.mockRejectedValueOnce(new Error('engine refused edit'))
    await expect(adapter.changeDownloadSource('gid', input)).rejects.toThrow(
      'engine refused edit'
    )
    expect(rpc.changeOption).not.toHaveBeenCalled()
  })

  it('propagates a header failure and never resumes after a partial edit', async () => {
    const { adapter, rpc } = adapterFixture()
    rpc.changeOption.mockRejectedValueOnce(new Error('engine refused headers'))
    await expect(
      adapter.changeDownloadSource('gid', {
        uris: ['https://example.test/new'],
        headers: {},
      })
    ).rejects.toThrow('engine refused headers')
    expect(rpc.unpause).not.toHaveBeenCalled()
  })
})
