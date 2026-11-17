import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'
import { build } from 'esbuild'

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nexus-tools-live-'))
try {
  const runtime = path.join(scratch, 'runtime.cjs')
  await build({
    stdin: {
      sourcefile: 'verify-tools.ts',
      resolveDir: process.cwd(),
      contents: `
    import { app } from 'electron'
    import { rm, writeFile } from 'node:fs/promises'
    import path from 'node:path'
    import { downloadTool } from './src/core/nexus/tools/download-tool'
    import { toolManifest } from './src/shared/schemas/nexus-tools'
    import { fetchFfmpegAsset } from './src/main/plugin/ffmpeg-fetch-electron'
    app.setPath('userData', process.env.NEXUS_TOOL_TEST_DIR)
    app.whenReady().then(async () => {
      const results = await Promise.all(['yt-dlp', 'gallery-dl', 'ffmpeg', 'deno'].map(async id => {
        const m = toolManifest[id], file = path.join(process.env.NEXUS_TOOL_TEST_DIR, id + '.part')
        let attempt = 0, receivedBytes = 0
        const started = Date.now()
        try {
          await downloadTool({ url: m.url, file, sha256: m.sha256, fetcher: fetchFfmpegAsset, timeoutMs: 30000, progress: p => { attempt = p.attempt; receivedBytes = p.downloaded } })
          return { id, version: m.version, sha256Verified: true, attempt, receivedBytes, elapsedMs: Date.now() - started }
        } catch(e) { return { id, version: m.version, sha256Verified: false, error: e.message === 'tools.hash' ? 'hash mismatch' : 'network reset, timeout or unavailable response after four attempts', attempt, receivedBytes, elapsedMs: Date.now() - started } }
        finally { await rm(file, { force: true }); await rm(file + '.json', { force: true }) }
      }))
      await writeFile(path.resolve('output/v05-tools-live.json'), JSON.stringify({ transport: 'Electron net.request, TLS verification enabled, official pinned sources', results, samplesRemoved: true }, null, 2) + '\\n')
      console.log(JSON.stringify(results))
      app.exit(0)
    }).catch(() => app.exit(1))
  `,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: runtime,
    external: ['electron', 'yauzl'],
  })
  const child = spawn(electron, [runtime], {
    windowsHide: true,
    env: { ...process.env, NEXUS_TOOL_TEST_DIR: scratch },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', () => {})
  const timeout = setTimeout(() => child.kill(), 180000)
  const [code] = await once(child, 'exit')
  clearTimeout(timeout)
  if (code !== 0) throw new Error('Tool network verification failed to run')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
