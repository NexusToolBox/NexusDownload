import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import {
  cloudErrorSchema,
  cloudPlatformSchema,
} from '@shared/schemas/nexus-cloud'
import type { ControlTask } from '@shared/schemas/nexus-control'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import { equalSecret, jsonBody, reply, sameOrigin } from './http-guard'

const empty = z.object({}).strict()
const task = z.object({ id: z.string().min(1).max(128) }).strict()
const schemas = {
  list_downloads: z
    .object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  add_download: z.object({ input: z.string().min(1).max(32768) }).strict(),
  pause_download: task,
  resume_download: task,
  remove_download: task
    .extend({ deleteFiles: z.boolean().default(false) })
    .strict(),
  get_failure: task,
  check_accounts: empty,
}
const descriptions: Record<keyof typeof schemas, string> = {
  list_downloads:
    'List task IDs, types, progress and states. Names, paths and addresses are private.',
  add_download:
    'Add a direct download, or send a share, media link, magnet or share text to the app for review.',
  pause_download: 'Pause one task by ID.',
  resume_download: 'Resume one task by ID.',
  remove_download:
    'Remove a task. Deleting local files always requires confirmation in the app.',
  get_failure: 'Read the sanitized failure category for a task.',
  check_accounts:
    'Run account checks and return only a sanitized report. May take several minutes.',
}
const reportSchema = z.object({
  reports: z.array(
    z.object({
      platform: cloudPlatformSchema,
      account: z.number().int().positive(),
      steps: z.array(
        z.object({
          step: z.enum(['login', 'list', 'link', 'range']),
          status: z.enum([
            'pass',
            'fail',
            'skipped',
            'skipped-needs-share-link',
            'skipped-no-small-root-file',
            'skipped-no-direct-share-route',
          ]),
          error: cloudErrorSchema.optional(),
        })
      ),
    })
  ),
})

/** A standard newline-delimited stdio client; the private HTTP hop stays on loopback. */
export const mcpStdioScript = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$client = New-Object Net.WebClient
$client.Encoding = New-Object Text.UTF8Encoding($false)
$client.Headers['Content-Type'] = 'application/json'
$client.Headers['Authorization'] = 'Bearer ' + $env:NEXUS_MCP_TOKEN
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $message = $null
    try {
      $message = $line | ConvertFrom-Json
      $client.Headers['Content-Type'] = 'application/json'
      $client.Headers['Authorization'] = 'Bearer ' + $env:NEXUS_MCP_TOKEN
      $response = $client.UploadString($env:NEXUS_MCP_ENDPOINT, 'POST', $line)
      if ($response) { [Console]::WriteLine($response) }
    } catch {
      if ($null -ne $message -and $message.PSObject.Properties.Name -contains 'id') {
        $failure = @{jsonrpc='2.0';id=$message.id;error=@{code=-32603;message='NexusDownload unavailable. Enable the AI interface in the running app.'}}
        [Console]::WriteLine(($failure | ConvertTo-Json -Compress -Depth 8))
      }
    }
  }
} finally { $client.Dispose() }
`

export class McpServer {
  private server?: Server
  private token = ''
  private port = 16812
  private epoch = 0
  private active = 0
  constructor(
    private deps: {
      broker: CredentialBroker
      directory: string
      tasks(): ControlTask[]
      add(input: string): Promise<{ taskId?: string; pending?: boolean }>
      control(
        action: 'pause' | 'resume' | 'remove',
        id: string,
        deleteFiles?: boolean
      ): Promise<void>
      confirmDelete(id: string): Promise<boolean>
      checkAccounts(): Promise<unknown>
    }
  ) {}
  config() {
    if (!this.server) return null
    return {
      mcpServers: {
        nexusdownload: {
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(this.deps.directory, 'nexus-mcp.ps1'),
          ],
          env: {
            NEXUS_MCP_ENDPOINT: `http://127.0.0.1:${this.port}/mcp`,
            NEXUS_MCP_TOKEN: this.token,
          },
        },
      },
    }
  }
  async start(port = 16812) {
    if (this.server) return
    this.token =
      this.deps.broker.get('mcp-token') || randomBytes(32).toString('base64url')
    await this.deps.broker.update('mcp-token', () => this.token)
    await mkdir(this.deps.directory, { recursive: true })
    await writeFile(
      path.join(this.deps.directory, 'nexus-mcp.ps1'),
      mcpStdioScript,
      { mode: 0o600 }
    )
    const server = createServer((req, res) => {
      const epoch = this.epoch
      void (async () => {
        if (
          !sameOrigin(req, [`127.0.0.1:${this.port}`]) ||
          req.headers.origin ||
          req.method !== 'POST' ||
          req.url !== '/mcp'
        )
          return reply(res, 403, {})
        if (
          !equalSecret(req.headers.authorization || '', `Bearer ${this.token}`)
        )
          return reply(res, 401, {})
        if (this.active >= 8) return reply(res, 429, {})
        this.active++
        try {
          const output = await this.dispatch(
            await jsonBody(req),
            () => this.epoch === epoch && !!this.server
          )
          if (output === null) {
            res.writeHead(204)
            res.end()
          } else reply(res, 200, output)
        } finally {
          this.active--
        }
      })().catch(() => {
        if (!res.headersSent) reply(res, 400, { error: 'Invalid request' })
        else res.end()
      })
    })
    server.requestTimeout = 15000
    server.headersTimeout = 10000
    server.maxConnections = 16
    this.port = port
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address && typeof address !== 'string') this.port = address.port
    this.server = server
  }
  async dispatch(raw: unknown, current = () => true): Promise<unknown> {
    const parsed = z
      .object({
        jsonrpc: z.literal('2.0'),
        id: z.union([z.string(), z.number()]).optional(),
        method: z.string(),
        params: z.unknown().optional(),
      })
      .safeParse(raw)
    if (!parsed.success)
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request' },
      }
    const message = parsed.data
    if (message.id === undefined) return null
    const done = (result: unknown) => ({
      jsonrpc: '2.0',
      id: message.id,
      result,
    })
    if (message.method === 'initialize') {
      const params = z
        .object({ protocolVersion: z.string() })
        .safeParse(message.params)
      const versions = [
        '2024-11-05',
        '2025-03-26',
        '2025-06-18',
        '2025-11-25',
        '2026-07-28',
      ]
      return done({
        protocolVersion:
          params.success && versions.includes(params.data.protocolVersion)
            ? params.data.protocolVersion
            : '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'NexusDownload', version: '1.0.0' },
      })
    }
    if (message.method === 'ping') return done({})
    if (message.method === 'tools/list')
      return done({
        tools: Object.entries(schemas).map(([name, schema]) => ({
          name,
          description: descriptions[name as keyof typeof schemas],
          inputSchema: z.toJSONSchema(schema),
          annotations: {
            readOnlyHint: ['list_downloads', 'get_failure'].includes(name),
            destructiveHint: name === 'remove_download',
            openWorldHint: ['add_download', 'check_accounts'].includes(name),
          },
        })),
      })
    if (message.method !== 'tools/call')
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' },
      }
    try {
      if (!current()) throw new Error('disabled')
      const params = z
        .object({
          name: z.enum(
            Object.keys(schemas) as [
              keyof typeof schemas,
              ...(keyof typeof schemas)[],
            ]
          ),
          arguments: z.unknown().optional(),
        })
        .parse(message.params)
      const args = schemas[params.name].parse(params.arguments ?? {})
      let value: unknown = { ok: true }
      if (params.name === 'list_downloads' && 'offset' in args) {
        const tasks = this.deps.tasks()
        value = {
          tasks: tasks.slice(args.offset, args.offset + args.limit),
          nextOffset:
            args.offset + args.limit < tasks.length
              ? args.offset + args.limit
              : null,
        }
      } else if (params.name === 'add_download' && 'input' in args)
        value = await this.deps.add(args.input)
      else if (params.name === 'check_accounts')
        value = reportSchema.parse(await this.deps.checkAccounts())
      else if ('id' in args) {
        const found = this.deps.tasks().find((t) => t.id === args.id)
        if (!found) throw new Error('missing')
        if (params.name === 'get_failure')
          value = { id: found.id, status: found.status, failure: found.failure }
        else {
          const deleteFiles = 'deleteFiles' in args && args.deleteFiles
          if (deleteFiles && !(await this.deps.confirmDelete(args.id)))
            value = { cancelled: true }
          else {
            if (!current()) throw new Error('disabled')
            await this.deps.control(
              params.name === 'pause_download'
                ? 'pause'
                : params.name === 'resume_download'
                  ? 'resume'
                  : 'remove',
              args.id,
              deleteFiles
            )
          }
        }
      }
      return done({ content: [{ type: 'text', text: JSON.stringify(value) }] })
    } catch {
      return done({
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Action failed or interface disabled. Check the app for details.',
          },
        ],
      })
    }
  }
  async stop() {
    this.epoch++
    const server = this.server
    this.server = undefined
    if (server)
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
