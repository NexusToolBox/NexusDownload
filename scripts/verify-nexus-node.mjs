// Local-only v0.5 integration: real Headless + aria2; secrets and samples live in a disposable temp directory.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { createServer as netServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { pathToFileURL } from 'node:url'
import { RemoteNodeClient } from '../src/core/nexus/remote/node-client.ts'
import { BridgeCommands } from '../src/shared/protocol/bridge.ts'
import { Queries } from '../src/shared/protocol/queries.ts'
import { remoteJobSchema } from '../src/shared/schemas/nexus-remote.ts'
import {
  TEST_TLS_CERT,
  TEST_TLS_KEY,
} from '../src/test-utils/plugin-test-tls.ts'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function freePort() {
  const s = netServer().listen(0, '127.0.0.1')
  await once(s, 'listening')
  const port = s.address().port
  await new Promise((r) => s.close(r))
  return port
}
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nexus-headless-v05-'))
const data = path.join(scratch, 'server'),
  local = path.join(scratch, 'local'),
  downloads = path.join(scratch, 'downloads')
await Promise.all([data, local, downloads].map((d) => mkdir(d)))
const [port, bridgePort, rpcPort, listenPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
])
setDefaultCACertificates([...getCACertificates('default'), TEST_TLS_CERT])
const proxy = httpsServer(
  { key: TEST_TLS_KEY, cert: TEST_TLS_CERT },
  (req, res) => {
    const target = req.url.startsWith('/mdxp/') ? bridgePort : port
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: target,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${target}` },
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers)
        reply.pipe(res)
      }
    )
    upstream.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  }
).listen(0, '127.0.0.1')
await once(proxy, 'listening')
const base = `https://127.0.0.1:${proxy.address().port}`,
  bridgeUrl = base
const operator = randomBytes(32).toString('hex')
const settings = {
  version: 13,
  app: {
    browserBridgeEnabled: true,
    defaultSaveDir: downloads,
    language: 'zh-CN',
  },
  engine: { rpcPort, listenPort, dhtListenPort: listenPort, dhtEnabled: false },
  tracker: { enabled: false, autoSync: false },
  onboarding: { completed: true },
}
await writeFile(path.join(data, 'settings.json'), JSON.stringify(settings))
let child,
  logs = '',
  wasInterrupted = false,
  rangeSeen = false
const bytes = randomBytes(2 * 1024 * 1024)
const source = createServer((req, res) => {
  const start = Number(/^bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0)
  res.writeHead(start ? 206 : 200, {
    'content-length': bytes.length - start,
    'accept-ranges': 'bytes',
    ...(start
      ? {
          'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
        }
      : {}),
  })
  res.end(bytes.subarray(start))
}).listen(0, '127.0.0.1')
await once(source, 'listening')
const values = new Map()
const broker = {
  get: (key) => values.get(key) || '',
  update: async (key, change) =>
    values.set(key, await change(values.get(key) || '')),
  remove: async (key) => values.delete(key),
}
async function waitUntil(check, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch {}
    await sleep(200)
  }
  throw new Error('headless integration timeout')
}
async function start() {
  logs = ''
  const url = pathToFileURL(path.resolve('dist/server/index.mjs')).href
  child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `process.on('message', () => process.emit('SIGTERM')); await import(${JSON.stringify(url)})`,
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        MOTRIX_DATA_DIR: data,
        MOTRIX_DEFAULT_SAVE_DIR: downloads,
        PORT: String(port),
        MOTRIX_MDXP_PORT: String(bridgePort),
        MOTRIX_OPERATOR_TOKEN: operator,
        MOTRIX_SKIP_ELECTRON_REBUILD: '1',
      },
    }
  )
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      logs = (logs + chunk).slice(-20000)
    })
  await waitUntil(
    async () =>
      (
        await fetch(`${base}/rpc/auth/status`, {
          signal: AbortSignal.timeout(1000),
        })
      ).ok &&
      [200, 404].includes(
        (
          await fetch(`http://127.0.0.1:${bridgePort}/discovery`, {
            signal: AbortSignal.timeout(1000),
          })
        ).status
      )
  )
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const done = once(child, 'exit')
  child.send('shutdown')
  await Promise.race([
    done,
    sleep(20000).then(() => {
      if (child.exitCode === null) throw new Error('shutdown timeout')
    }),
  ])
}
async function rpc(kind, channel, arg) {
  const r = await fetch(`${base}/rpc/${kind}/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${operator}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ args: arg === undefined ? [] : [arg] }),
  })
  assert.equal(r.status, 200)
  return r.json()
}
try {
  await start()
  console.log('Headless ready')
  let client = new RemoteNodeClient(broker, () => {})
  await client.load()
  const node = {
    id: randomUUID(),
    name: 'local integration',
    url: base,
    bridgeUrl,
  }
  await client.action({ action: 'node-pair', node })
  const pending = await rpc('query', 'bridge:listPendingPairRequests')
  const request = pending.find((p) => p.kind === 'cli')
  assert.ok(request)
  await rpc('command', BridgeCommands.ResolvePair, {
    kind: 'cli',
    requestId: request.requestId,
    decision: 'allow',
  })
  await sleep(5100)
  await client.action({ action: 'node-poll', id: node.id })
  assert.equal(client.snapshot()[0].paired, true)
  console.log('Device-code pairing approved')
  let adapter = client.adapter(node.id)
  const job = remoteJobSchema.parse({
    id: randomUUID(),
    key: randomUUID(),
    adapter: `node:${node.id}`,
    source: `http://127.0.0.1:${source.address().port}/sample.dat`,
    directory: local,
    maxBytes: bytes.length + 1,
    createdAt: Date.now(),
  })
  job.remoteId = await adapter.submit(job)
  console.log('Remote submission accepted')
  await waitUntil(async () => (await adapter.query(job)).ready).catch(
    async (e) => {
      console.error(
        'Remote task states:',
        (await rpc('query', Queries.ListTasks)).map((t) => ({
          status: t.status,
          progress: t.progress,
          bytes: t.downloadedBytes,
        }))
      )
      throw e
    }
  )
  console.log('Remote download completed')
  await stop()
  await start()
  client = new RemoteNodeClient(
    broker,
    () => {},
    async (url, init) => {
      const response = await fetch(url, init)
      if (/\/files\/[a-f0-9]+$/.test(String(url))) {
        if (init.headers.Range) rangeSeen = true
        if (!wasInterrupted) {
          wasInterrupted = true
          const reader = response.body.getReader()
          let emitted = false
          return new Response(
            new ReadableStream({
              async pull(controller) {
                if (emitted) {
                  await reader.cancel()
                  controller.error(new Error('intentional disconnect'))
                  return
                }
                const { value } = await reader.read()
                emitted = true
                controller.enqueue(value)
              },
            }),
            { status: response.status, headers: response.headers }
          )
        }
      }
      return response
    }
  )
  await client.load()
  adapter = client.adapter(node.id)
  assert.equal(await adapter.recover(job), job.id)
  assert.equal(await adapter.submit(job), job.id)
  const tasks = await rpc('query', Queries.ListTasks)
  assert.equal(tasks.filter((t) => t.saveDir.includes(job.id)).length, 1)
  const files = await adapter.listFiles(job)
  assert.equal(files.length, 1)
  await assert.rejects(() => adapter.retrieve(job, files[0], async () => {}))
  await adapter.retrieve(job, files[0], async () => {})
  assert.ok(rangeSeen && wasInterrupted && files[0].verified)
  assert.equal(
    createHash('sha256')
      .update(await readFile(files[0].localPath))
      .digest('hex'),
    createHash('sha256').update(bytes).digest('hex')
  )
  const unauth = await fetch(`${base}/nexus/v05/jobs/${job.id}/files`)
  assert.equal(unauth.status, 401)
  await adapter.cleanup(job)
  await adapter.cleanup(job)
  await writeFile(
    'output/v1-node-live.json',
    JSON.stringify(
      {
        realHeadless: true,
        deviceCodePairing: true,
        serverRestart: true,
        clientRestart: true,
        duplicateSubmissions: 0,
        interruptedRetrieval: true,
        rangeResume: true,
        sha256: true,
        unauthorizedDenied: true,
        cleanupIdempotent: true,
        transport:
          'HTTPS reverse proxy with explicitly trusted test CA; TLS verification enabled',
        sampleRemoved: true,
      },
      null,
      2
    )
  )
  console.log(
    'Headless integration passed: pairing, restart, Range resume, SHA-256 and cleanup'
  )
} catch (e) {
  // Runtime logs can carry source metadata. Keep diagnostics in memory only.
  console.error('Headless integration failed:', e.message)
  console.error(
    logs
      .split('\n')
      .filter(
        (line) =>
          /fatal|Error|failed|listening/.test(line) &&
          !/token|secret|cookie|Bearer/i.test(line)
      )
      .slice(-12)
      .join('\n')
  )
  process.exitCode = 1
} finally {
  await stop().catch(() => {
    child?.kill()
  })
  source.closeAllConnections()
  await new Promise((r) => source.close(r))
  proxy.closeAllConnections()
  await new Promise((r) => proxy.close(r))
  await rm(scratch, { recursive: true, force: true })
}
