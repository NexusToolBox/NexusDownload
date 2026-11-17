import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Aria2Adapter } from '../../src/core/engine/aria2/aria2-adapter.ts'
import { Aria2RpcClient } from '../../src/core/engine/aria2/aria2-rpc-client.ts'
import { JsonRpcProtocol } from '../../src/core/engine/aria2/json-rpc-protocol.ts'
import { WebSocketTransport } from '../../src/core/engine/aria2/web-socket-transport.ts'
import { DownloadRelay } from '../../src/core/nexus/cloud/download-relay.ts'
import { renewDownload } from '../../src/core/nexus/cloud/renewal.ts'
import { startRangeServer } from '../p0/range-server.mjs'

const binary = path.resolve('extra/win32/x64/aria2c.exe')
const root = path.resolve('output/ci/v02/renewal', String(Date.now()))
const size = 4 * 1024 ** 3 + 128 * 1024 ** 2
function check(condition, message) {
  if (!condition) throw new Error(message)
}
async function sha256(filename) {
  const hash = createHash('sha256')
  for await (const data of createReadStream(filename)) hash.update(data)
  return hash.digest('hex')
}
async function port() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}

async function until(read, seconds = 30) {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    const value = await read()
    if (value) return value
    await delay(100)
  }
  throw new Error('Fixture condition timed out')
}

async function engine(baseDir) {
  await mkdir(baseDir, { recursive: true })
  const rpcPort = await port()
  const secret = randomBytes(24).toString('hex')
  const dbPath = path.join(baseDir, 'engine.db')
  const proc = spawn(
    binary,
    [
      '--no-conf=true',
      '--no-netrc=true',
      '--enable-rpc=true',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${rpcPort}`,
      `--rpc-secret=${secret}`,
      '--enable-dht=false',
      '--enable-dht6=false',
      '--enable-peer-exchange=false',
      '--enable-sqlite3-persistence=true',
      `--sqlite3-db-path=${dbPath}`,
      '--sqlite3-history-limit=-1',
      '--force-save=true',
      '--continue=false',
      '--file-allocation=none',
      '--auto-file-renaming=false',
      '--allow-overwrite=false',
      '--auto-save-interval=1',
      '--max-tries=0',
      '--retry-wait=1',
      '--split=8',
      '--max-connection-per-server=8',
      '--min-split-size=1M',
      '--console-log-level=error',
      '--quiet=true',
      `--dir=${baseDir}`,
    ],
    { stdio: 'ignore', windowsHide: true }
  )
  let spawnFailed = false
  proc.once('error', () => {
    spawnFailed = true
  })
  let client
  try {
    await until(async () => {
      check(
        !spawnFailed && proc.exitCode === null,
        'Fixture engine did not start'
      )
      try {
        const result = await fetch(`http://127.0.0.1:${rpcPort}/jsonrpc`, {
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'aria2.getVersion',
            params: [`token:${secret}`],
          }),
        })
        return result.ok
      } catch {
        return false
      }
    }, 10)
    const transport = new WebSocketTransport()
    client = new Aria2RpcClient(
      transport,
      new JsonRpcProtocol(transport),
      secret
    )
    await client.connect(rpcPort)
    const adapter = new Aria2Adapter(client)
    await adapter.connect()
    return {
      adapter,
      rpc: client,
      dbPath,
      exitStatus: () => ({ code: proc.exitCode, signal: proc.signalCode }),
      async stop() {
        if (proc.exitCode !== null) {
          client.disconnect()
          return
        }
        const exited = once(proc, 'exit')
        try {
          await client.shutdown()
        } catch {
          /* closed with the engine */
        }
        client.disconnect()
        await Promise.race([exited, delay(8000)])
        if (proc.exitCode === null) {
          proc.kill()
          await exited
        }
      },
    }
  } catch (error) {
    client?.disconnect()
    if (proc.pid && proc.exitCode === null) {
      const exited = once(proc, 'exit')
      proc.kill()
      await exited.catch(() => {})
    }
    throw error
  }
}

await mkdir(root, { recursive: true })
const filename = path.join(root, 'source.bin')
const file = await open(filename, 'w')
await file.truncate(size)
// Distinct markers across the 32-bit boundary; holes keep fixture creation inexpensive.
for (const offset of [0, 128 * 1024 ** 2, 4 * 1024 ** 3, size - 1024 ** 2])
  await file.write(randomBytes(1024 ** 2), 0, 1024 ** 2, offset)
await file.close()
const expected = await sha256(filename)
const lock = JSON.parse(await readFile('scripts/engine.lock.json', 'utf8'))
// The documented P0 binary hash is checked before executing local engine code.
check(
  (await sha256(binary)) ===
    '8138d93127fb5885a8100480a260d8383559b598e7e3e6ceedbc1d9f5959c849',
  'Engine hash mismatch'
)
void lock
const server = await startRangeServer(filename, {
  bytesPerSecond: 128 * 1024 ** 2,
})
const relay = new DownloadRelay()
let wired
const evidence = {
  size,
  continue: false,
  phases: [],
  checkpoints: [],
  success: false,
}
try {
  await relay.start()
  wired = await engine(root)
  const resource = (lease) => ({
    fileId: 'same-file',
    version: 'v1',
    bytes: size,
    kind: 'original-file',
    url: lease.uri,
    headers: lease.headers,
    expiresAt: lease.expiresAt,
  })
  let current = server.issue(2)
  let uri = relay.issue(resource(current), size, () => undefined)
  const gid = await wired.adapter.createDownload({
    uris: [uri],
    headers: {},
    saveDir: root,
    filename: 'download.bin',
    connections: 1,
    fileAllocation: 'none',
    extraEngineOptions: {
      'max-tries': '1',
      'auto-file-renaming': 'false',
      'allow-overwrite': 'false',
    },
  })
  const binding = {
    gid,
    output: path.join(root, 'download.bin'),
    phase: 'ready',
  }
  await delay(Math.max(0, current.expiresAt - Date.now() + 200))
  const expired = await fetch(uri, { headers: { Range: 'bytes=0-0' } })
  await expired.body?.cancel()
  check(expired.status === 502, 'Expired resource was not blocked')
  evidence.expiredBeforeRenewal = true
  async function renew() {
    const oldUri = uri
    const before = await wired.adapter.getTaskStatus(gid)
    evidence.checkpoints.push({
      downloaded: before?.downloadedBytes ?? 0,
      status: await wired.adapter.getCheckpointStatus(binding.output),
    })
    await renewDownload({
      engine: wired.adapter,
      binding,
      persist: async (phase) => {
        evidence.phases.push(phase)
      },
      resolve: async () => {
        current = server.issue(600)
        uri = relay.issue(resource(current), size, () => undefined)
        relay.revoke(oldUri)
        return { resource: resource(current), uri }
      },
    })
  }
  await renew()
  await until(
    async () =>
      (await wired.adapter.getTaskStatus(gid))?.downloadedBytes >
      4 * 1024 ** 3 + 8 * 1024 ** 2,
    240
  )
  await renew()
  await until(
    async () =>
      (await wired.adapter.getTaskStatus(gid))?.status === 'completed',
    60
  )
  evidence.hashMatched = (await sha256(binding.output)) === expected
  const remote = server.evidence()
  evidence.headersMatched = remote.records
    .filter((r) => r.status === 200 || r.status === 206)
    .every((r) => r.authorizationMatched)
  evidence.resumedBeyond4GiB = remote.records.some(
    (r) => r.leaseNumber >= 3 && r.start > 4 * 1024 ** 3
  )
  evidence.records = remote.records
  evidence.success =
    evidence.hashMatched &&
    evidence.headersMatched &&
    evidence.resumedBeyond4GiB
  check(evidence.success, 'Integrity assertion failed')
} catch {
  process.exitCode = 1
  console.error('v0.2 renewal experiment failed; request data omitted')
} finally {
  await wired?.stop()
  await relay.stop()
  await server.close()
  await writeFile(
    path.join(root, 'evidence.json'),
    JSON.stringify(evidence, null, 2)
  )
}
console.log(
  JSON.stringify({
    success: evidence.success,
    hashMatched: evidence.hashMatched,
    resumedBeyond4GiB: evidence.resumedBeyond4GiB,
    evidence: path.join(root, 'evidence.json'),
  })
)
