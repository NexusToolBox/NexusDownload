import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NexusWorkspace } from './workspace'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function fixture(request: typeof fetch) {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-probe-'))
  roots.push(root)
  return new NexusWorkspace({
    file: path.join(root, 'state.json'),
    defaultDirectory: () => root,
    changed() {},
    fetch: request,
  })
}
it.each([401, 403, 404, 500, 503])(
  'blocks task creation for HTTP %s',
  async (status) => {
    const workspace = await fixture(
      vi.fn<typeof fetch>(async () => new Response(null, { status }))
    )
    const checked = await workspace.collect({
      input: 'https://example.test/file.zip',
    })
    expect(checked?.blocked).toBe(true)
    const create = vi.fn()
    await expect(
      workspace.download({ ids: checked?.items.map((i) => i.id) }, create)
    ).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  }
)
it('passes successful 403 retry headers into the task creation and recipe boundary', async () => {
  const request = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Response(null, {
        status: new Headers(init?.headers).has('Referer') ? 200 : 403,
        headers: { 'Content-Length': '16' },
      })
  )
  const workspace = await fixture(request)
  const checked = await workspace.collect({
    input: 'https://example.test/file.zip',
  })
  expect(checked?.items[0].probe?.retried).toBe(true)
  const create = vi.fn(async () => ({
    outcome: 'created' as const,
    taskId: 'one',
    gid: 'one',
  }))
  await workspace.download({ ids: checked?.items.map((i) => i.id) }, create)
  const args = create.mock.calls as unknown as [
    [{ headers: { name: string; value: string }[] }],
  ]
  expect(
    args[0][0].headers.some(
      (h) => h.name === 'Referer' && h.value === 'https://example.test/'
    )
  ).toBe(true)
  expect(args[0][0].headers.some((h) => h.name === 'User-Agent')).toBe(true)
  expect(workspace.snapshot().inbox).toHaveLength(0)
})
