// Local-only benchmark. The upstream and 16 readers run outside Electron.
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = process.cwd()
const out = path.join(root, 'output/playwright/manual/v03-relay')
await mkdir(out, { recursive: true })
await mkdir(path.join(out, 'profile'), { recursive: true })
await writeFile(
  path.join(out, 'profile/settings.json'),
  JSON.stringify({
    version: 13,
    onboarding: { disclaimerAccepted: true },
    app: {
      language: 'zh-CN',
      autofillClipboardLinks: false,
      checkForUpdatesOnLaunch: false,
      warnBeforeQuit: false,
    },
    tracker: { autoSync: false },
  })
)
await build({
  entryPoints: ['src/core/nexus/cloud/download-relay.ts'],
  outfile: path.join(out, 'relay.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
})
const block = Buffer.alloc(1024 * 1024)
const bytes = 512 * 1024 * 1024
const upstream = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Length': bytes })
  let remaining = bytes
  const pump = () => {
    while (remaining > 0) {
      remaining -= block.length
      if (!res.write(block)) {
        res.once('drain', pump)
        return
      }
    }
    res.end()
  }
  pump()
})
upstream.listen(0, '127.0.0.1')
await once(upstream, 'listening')
let app
try {
  app = await electron.launch({
    args: [root, `--user-data-dir=${path.join(out, 'profile')}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MOTRIX_USER_DATA: path.join(out, 'profile'),
      MOTRIX_RPC_PORT: '16998',
      MOTRIX_DEFAULT_SAVE_DIR: path.join(out, 'downloads'),
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('a[href$="/cloud"]').waitFor()
  await page.locator('a[href$="/cloud"]').click()
  await page.getByRole('heading', { name: '网盘', exact: true }).waitFor()
  await page.evaluate(() => {
    window.__relayFrames = []
    let previous = performance.now()
    const frame = (time) => {
      window.__relayFrames.push(time - previous)
      previous = time
      window.__relayFrame = requestAnimationFrame(frame)
    }
    window.__relayFrame = requestAnimationFrame(frame)
  })
  const uri = await app.evaluate(
    async (_electron, config) => {
      const { createRequire } = process.mainModule.require('node:module')
      const { DownloadRelay } = createRequire(config.module)(config.module)
      globalThis.__benchRelay = new DownloadRelay()
      await globalThis.__benchRelay.start()
      globalThis.__benchCpu = process.cpuUsage()
      globalThis.__benchStart = performance.now()
      return globalThis.__benchRelay.issue(
        {
          fileId: 'bench',
          bytes: config.bytes,
          kind: 'original-file',
          headers: {},
          url: config.url,
        },
        config.bytes,
        () => {}
      )
    },
    {
      module: path.join(out, 'relay.cjs'),
      bytes,
      url: `http://127.0.0.1:${upstream.address().port}/`,
    }
  )
  const started = performance.now()
  let measuring = true
  const roundTrips = []
  const probe = (async () => {
    while (measuring) {
      const sent = performance.now()
      await app.evaluate(() => process.pid)
      roundTrips.push(performance.now() - sent)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()
  const received = await Promise.all(
    Array.from(
      { length: 16 },
      () =>
        new Promise((resolve, reject) => {
          get(uri, (res) => {
            let count = 0
            res.on('data', (chunk) => {
              count += chunk.length
            })
            res.on('end', () => resolve(count))
            res.on('error', reject)
          }).on('error', reject)
        })
    )
  )
  const duration = performance.now() - started
  measuring = false
  await probe
  roundTrips.sort((a, b) => a - b)
  const cpu = await app.evaluate(async () => {
    const usage = process.cpuUsage(globalThis.__benchCpu)
    const elapsed = performance.now() - globalThis.__benchStart
    await globalThis.__benchRelay.stop()
    return {
      pid: process.pid,
      oneCorePercent: (usage.user + usage.system) / (elapsed * 10),
    }
  })
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__relayFrame)
    return window.__relayFrames
  })
  frames.sort((a, b) => a - b)
  const result = {
    at: new Date().toISOString(),
    connections: 16,
    bytes: received.reduce((a, b) => a + b, 0),
    durationMs: duration,
    throughputMBps: received.reduce((a, b) => a + b, 0) / duration / 1000,
    process: 'Electron main',
    clientPageLoaded: true,
    ...cpu,
    rendererFrames: frames.length,
    rendererFrameP99Ms: frames[Math.floor(frames.length * 0.99)],
    rendererFrameMaxMs: Math.max(...frames),
    mainResponseP99Ms: roundTrips[Math.floor(roundTrips.length * 0.99)],
    mainResponseMaxMs: Math.max(...roundTrips),
    complete: received.every((n) => n === bytes),
  }
  await writeFile(
    path.join(out, `result-${Date.now()}.json`),
    JSON.stringify(result, null, 2)
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await app?.close()
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
}
