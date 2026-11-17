import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeDownloadTask } from '@test-utils/task'
import { afterEach, expect, it, vi } from 'vitest'
import type { CredentialBroker } from '../cloud/credential-broker'
import { McpServer } from './mcp-server'
import { controlTaskView } from './task-view'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexus-mcp-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const data = new Map<string, string>()
  const broker = {
    get: (k: string) => data.get(k) || '',
    update: async (k: string, fn: (s: string) => string) => {
      data.set(k, fn(data.get(k) || ''))
    },
  } as unknown as CredentialBroker
  const secret = randomBytes(32).toString('hex')
  const raw = makeDownloadTask({
    id: 'task',
    status: 'error' as never,
    name: secret,
    errorMessage: secret,
    uris: [`https://example.org/${secret}`],
  })
  const deps = {
    broker,
    directory,
    tasks: () => controlTaskView([raw]),
    add: vi.fn(async () => ({ taskId: 'new' })),
    control: vi.fn(async () => {}),
    confirmDelete: vi.fn(async () => false),
    checkAccounts: vi.fn(async () => ({
      reports: [
        {
          platform: 'baidu',
          account: 1,
          credential: secret,
          steps: [{ step: 'login', status: 'pass', details: secret }],
        },
      ],
    })),
  }
  const server = new McpServer(deps)
  cleanup.push(() => server.stop())
  return { server, deps, secret }
}
it('returns only allowlisted task/report fields and gates file deletion in the application', async () => {
  const { server, deps, secret } = await setup()
  const call = (name: string, args = {}) =>
    server.dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
  for (const name of ['list_downloads', 'check_accounts', 'get_failure']) {
    const result = JSON.stringify(
      await call(name, name === 'get_failure' ? { id: 'task' } : {})
    )
    expect(result.includes(secret)).toBe(false)
    expect(result.includes('isError')).toBe(false)
  }
  await call('remove_download', { id: 'task', deleteFiles: true })
  expect(deps.confirmDelete).toHaveBeenCalledTimes(1)
  expect(deps.control).not.toHaveBeenCalled()
  deps.confirmDelete.mockResolvedValue(true)
  await call('remove_download', { id: 'task', deleteFiles: true })
  expect(deps.control).toHaveBeenCalledWith('remove', 'task', true)
  deps.control.mockClear()
  await call('pause_download', { id: 'task' })
  await call('resume_download', { id: 'task' })
  expect(deps.control).toHaveBeenCalledWith('pause', 'task', false)
  expect(deps.control).toHaveBeenCalledWith('resume', 'task', false)
  const invalid = JSON.stringify(
    await call('add_download', { input: 'anything', credential: secret })
  )
  expect(invalid.includes(secret)).toBe(false)
  expect(invalid).toContain('isError')
  expect(deps.add).not.toHaveBeenCalled()
  deps.control.mockClear()
  await server.dispatch(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'remove_download',
        arguments: { id: 'task', deleteFiles: true },
      },
    },
    () => false
  )
  expect(deps.control).not.toHaveBeenCalled()
})
it('runs the actual PowerShell stdio client and rejects unauthenticated or browser requests', async () => {
  const { server } = await setup()
  const catalog = await server.dispatch({
    jsonrpc: '2.0',
    id: 0,
    method: 'tools/list',
  })
  expect(catalog).toHaveProperty('result.tools')
  expect(server.config()).toBeNull()
  await server.start(0)
  const config = server.config()?.mcpServers.nexusdownload
  if (!config) throw new Error('missing test config')
  expect(
    (
      await fetch(config.env.NEXUS_MCP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status
  ).toBe(401)
  expect(
    (
      await fetch(config.env.NEXUS_MCP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://example.org',
        },
        body: '{}',
      })
    ).status
  ).toBe(403)
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_downloads', arguments: {} },
    },
  ]
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.command, config.args, {
      windowsHide: true,
      env: { ...process.env, ...config.env },
      stdio: 'pipe',
    })
    let stdout = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('stdio timeout'))
    }, 15000)
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      code === 0 ? resolve(stdout) : reject(new Error('stdio failed'))
    })
    child.stdin.end(messages.map((m) => JSON.stringify(m)).join('\n') + '\n')
  })
  const frames = output
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
  expect(frames).toHaveLength(3)
  expect(frames[1]).toHaveProperty('result.tools')
  expect(frames[0].result.serverInfo.name).toBe('NexusDownload')
  expect(frames[1].result.tools).toHaveLength(7)
  expect(JSON.parse(frames[2].result.content[0].text).tasks[0].id).toBe('task')
  expect(output.includes(config.env.NEXUS_MCP_TOKEN)).toBe(false)
  await server.stop()
  await expect(fetch(config.env.NEXUS_MCP_ENDPOINT)).rejects.toThrow()
}, 20000)
