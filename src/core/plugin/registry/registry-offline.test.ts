import { describe, expect, it, vi } from 'vitest'
import { RegistryClient } from './registry-client'

describe('offline plugin distribution', () => {
  it('exposes no market and never reads cache or requests the network', async () => {
    const fetchImpl = vi.fn()
    const statImpl = vi.fn()
    const readFileImpl = vi.fn()
    const client = new RegistryClient({
      enabled: false,
      cachePath: 'unused-cache',
      fetchImpl,
      statImpl,
      readFileImpl,
    })
    expect(await client.load()).toBeNull()
    expect(await client.refresh()).toBeNull()
    expect(await client.list('2.4.1')).toEqual([])
    expect(await client.get('motrix.filename-template', '2.4.1')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(statImpl).not.toHaveBeenCalled()
    expect(readFileImpl).not.toHaveBeenCalled()
    expect(client.status().cached).toBe(false)
  })
})
