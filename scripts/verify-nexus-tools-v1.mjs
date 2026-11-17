import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import electron from 'electron'
import { build } from 'esbuild'

// Local fixtures only; retained executables are removed after release verification.
const root = path.resolve('../.nexus-v1-fixtures/tools')
await mkdir(root, { recursive: true })
const runtime = path.join(root, 'runtime.cjs')
await build({
  stdin: {
    sourcefile: 'verify-tools.ts',
    resolveDir: process.cwd(),
    contents: String.raw`
import { app, safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CredentialBroker } from './src/core/nexus/cloud/credential-broker'
import { ToolManager } from './src/core/nexus/tools/tool-manager'
import { fetchFfmpegAsset } from './src/main/plugin/ffmpeg-fetch-electron'
const root = process.env.NEXUS_TOOL_TEST_DIR
app.setPath('userData', path.join(root, 'data'))
app.whenReady().then(async () => {
 const broker = new CredentialBroker(path.join(root, 'receipts.bin'), { available: async()=>safeStorage.isEncryptionAvailable(), encrypt: async v=>safeStorage.encryptString(v), decrypt: async v=>safeStorage.decryptString(v) })
 await broker.load()
 const manager = new ToolManager(path.join(root, 'bin'), broker, ()=>{}, fetchFfmpegAsset)
 const run = promisify(execFile)
 const results = await Promise.all(['yt-dlp','gallery-dl','7zip','ffmpeg','deno'].map(async id=>{
  try { await manager.action({action:'install',id}); const exe=await manager.executable(id); await run(exe, id==='7zip'?['i']:id==='ffmpeg'?['-version']:['--version'], {windowsHide:true,timeout:60000}); return {id,installed:true,ran:true} }
  catch { return {id,installed:false,ran:false} }
 }))
 await writeFile(path.resolve('output/v1-tools-live.json'), JSON.stringify({officialPinnedSources:true, results},null,2)+'\n')
 console.log(JSON.stringify(results)); app.exit(results.every(r=>r.ran)?0:1)
}).catch(()=>app.exit(1))`,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: runtime,
  external: ['electron'],
})
const child = spawn(electron, [runtime], {
  windowsHide: true,
  env: { ...process.env, NEXUS_TOOL_TEST_DIR: root },
  stdio: ['ignore', 'pipe', 'ignore'],
})
child.stdout.pipe(process.stdout)
const timeout = setTimeout(() => child.kill(), 600000)
const [code] = await once(child, 'exit')
clearTimeout(timeout)
if (code !== 0) process.exitCode = 1
