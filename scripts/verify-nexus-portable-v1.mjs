// Runs only against a disposable copy of the current Windows package.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import electron from 'electron'
import { chromium } from 'playwright'
import { startHttpFixture } from '../e2e/fixtures/http-server.ts'
import { getFreePort } from '../e2e/helpers/free-port.ts'
import { MenuItemIds } from '../src/main/menu/menu-ids.ts'
import { Commands } from '../src/shared/protocol/commands.ts'
import { Queries } from '../src/shared/protocol/queries.ts'

const root = path.resolve('../.nexus-v1-fixtures/portable')
const original = path.join(root, 'original')
const moved = path.join(root, 'moved')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, message, ms = 45000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(200)
  }
  throw new Error(message)
}
await mkdir(root, { recursive: true })
await cp(path.resolve('release/win-unpacked'), original, {
  recursive: true,
  errorOnExist: true,
  force: false,
})
await mkdir(path.join(original, 'data/user-data'), { recursive: true })
await writeFile(
  path.join(original, 'data/user-data/settings.json'),
  JSON.stringify({
    version: 13,
    app: {
      theme: 'light',
      language: 'zh-CN',
      browserBridgeEnabled: false,
      autofillClipboardLinks: false,
      warnBeforeQuit: false,
      checkForUpdatesOnLaunch: false,
    },
    tracker: { autoSync: false },
    onboarding: { disclaimerAccepted: true },
  })
)
const fixture = await startHttpFixture({
  size: 4 * 1024 * 1024,
  throttleBytesPerSecond: 512 * 1024,
})
let child, browser, page
const invoke = (channel, request) =>
  page.evaluate(
    ({ channel, request }) => window.motrix.invoke(channel, request),
    { channel, request }
  )
const tasks = () => invoke(Queries.ListTasks)
async function launch(directory) {
  const port = await getFreePort()
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    MOTRIX_RPC_PORT: String(await getFreePort()),
  }
  delete env.MOTRIX_USER_DATA
  delete env.MOTRIX_BRIDGE_DATA_DIR
  delete env.MOTRIX_DEFAULT_SAVE_DIR
  child = spawn(
    path.join(directory, 'NexusDownload.exe'),
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { cwd: directory, env, windowsHide: true, stdio: 'ignore' }
  )
  await until(async () => {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 1000,
      })
      return true
    } catch {
      assert.equal(child.exitCode, null)
      return false
    }
  }, 'packaged debugging endpoint unavailable')
  await until(async () => {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('w=main'))
    return Boolean(page)
  }, 'packaged main window unavailable')
  await until(async () => {
    try {
      return (await invoke(Queries.GetEngineStatus)).state === 'ready'
    } catch {
      return false
    }
  }, 'packaged engine unavailable')
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  const menu = await invoke(Queries.GetApplicationMenu)
  await invoke(Commands.ExecuteApplicationMenuItem, {
    itemId: MenuItemIds.AppQuit,
    revision: menu.revision,
    trigger: 'menu',
    selectedTaskId: null,
  }).catch(() => {})
  const result = await Promise.race([
    exited,
    sleep(15000).then(() => {
      throw new Error('packaged quit timed out')
    }),
  ])
  assert.equal(result[0], 0)
  await browser.close().catch(() => {})
  child = undefined
}
async function records(directory) {
  const helper = path.join(root, 'read-records.cjs')
  await writeFile(
    helper,
    `const {app,safeStorage}=require('electron');const fs=require('node:fs');app.setName('NexusDownload');app.setPath('userData',process.argv[2]);app.whenReady().then(async()=>{try{const values=JSON.parse((await safeStorage.decryptStringAsync(fs.readFileSync(process.argv[3]))).result);const records=JSON.parse(values['processing-records']||'[]');process.stdout.write(JSON.stringify(records));app.exit(0)}catch(e){process.stderr.write(e.code||e.name);app.exit(1)}})`
  )
  const process = spawn(
    electron,
    [
      helper,
      path.join(directory, 'data/user-data'),
      path.join(directory, 'data/user-data/nexus-media.bin'),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let text = ''
  let diagnostic = ''
  process.stdout.on('data', (bytes) => {
    text += bytes
  })
  process.stderr.on('data', (bytes) => {
    diagnostic += bytes
  })
  assert.equal((await once(process, 'exit'))[0], 0, diagnostic)
  return JSON.parse(text)
}
try {
  await launch(original)
  assert.equal((await invoke(Queries.GetPortableMode)).enabled, true)
  await invoke(Commands.CreateTask, {
    type: 'http',
    uris: [fixture.fileUrl],
    saveDir: path.join(original, 'Downloads'),
    filename: '完整校验.bin',
  })
  await until(
    async () => (await tasks())[0]?.status === 'completed',
    'first file not completed'
  )
  assert.equal(await fixture.verifyFile((await tasks())[0].finalPath), true)
  await until(
    async () =>
      Boolean((await invoke(Queries.GetNexusWorkflow)).processing?.length),
    'processing record missing'
  )
  await invoke(Commands.CreateTask, {
    type: 'http',
    uris: [fixture.fileUrl],
    saveDir: path.join(original, 'Downloads'),
    filename: '恢复测试.bin',
    duplicatePolicy: 'create-copy',
  })
  const firstId = (await tasks()).find((t) => t.status === 'completed').id
  await until(
    async () =>
      (await tasks()).some(
        (t) => t.id !== firstId && t.downloadedBytes > 512 * 1024
      ),
    'partial download missing'
  )
  const partial = (await tasks()).find((t) => t.id !== firstId)
  assert.deepEqual(
    partial.instances[0]?.payload.directReplay?.requestModifiers,
    []
  )
  await invoke(Commands.PauseTask, partial.id)
  await until(
    async () =>
      (await tasks()).find((t) => t.id === partial.id)?.status === 'paused',
    'pause failed'
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.evaluate(() => {
    location.hash = '#/downloads/all'
  })
  await page.getByRole('option').first().waitFor()
  await page.getByRole('option').last().click()
  await sleep(6000)
  await page.screenshot({
    path: path.join(root, 'client-light.png'),
    animations: 'disabled',
  })
  // Use the actual settings switches; never capture the MCP configuration.
  await page.evaluate(() => {
    location.hash = '#/settings?section=phone'
  })
  const phone = page.getByRole('switch', { name: '手机投递', exact: true })
  await phone.click()
  await until(
    async () => (await invoke(Queries.GetNexusControl)).phone.enabled,
    'phone setting failed'
  )
  assert.equal((await fetch('http://127.0.0.1:16811/')).status, 200)
  await phone.click()
  await page.evaluate(() => {
    location.hash = '#/settings?section=mcp'
  })
  const mcp = page.getByRole('switch', { name: 'AI 助手接口', exact: true })
  await mcp.click()
  await until(
    async () => Boolean((await invoke(Queries.GetNexusControl)).mcp.config),
    'MCP setting failed'
  )
  await mcp.click()
  await stop()
  const before = await records(original)
  assert.ok(before.length)
  assert.ok(JSON.stringify(before).includes(original.replaceAll('\\', '\\\\')))
  fixture.resetRequests()
  await rename(original, moved)
  await launch(moved)
  await until(
    async () => (await tasks()).some((t) => t.id === partial.id),
    'moved task missing'
  )
  const recovered = (await tasks()).find((t) => t.id === partial.id)
  assert.equal(recovered.status, 'paused', recovered.errorDetailKey)
  assert.ok(recovered.saveDir.startsWith(moved))
  await invoke(Commands.ResumeTask, partial.id)
  await until(
    async () =>
      (await tasks()).find((t) => t.id === partial.id)?.status === 'completed',
    'moved task not completed'
  )
  assert.equal(
    await fixture.verifyFile(
      (await tasks()).find((t) => t.id === partial.id).finalPath
    ),
    true
  )
  assert.ok(
    fixture
      .requests()
      .some(
        (request) =>
          request.status === 206 &&
          Number(/^bytes=(\d+)-/.exec(request.range ?? '')?.[1]) > 0
      )
  )
  await stop()
  const after = await records(moved)
  assert.ok(!JSON.stringify(after).includes(original.replaceAll('\\', '\\\\')))
  assert.ok(after.some((r) => r.directory.startsWith(moved)))
  await writeFile(
    'output/v1-portable-live.json',
    `${JSON.stringify({ packagedPortable: true, settingsSwitches: true, packagedPhonePage: true, ordinarySha256: true, encryptedProcessingPresent: true, wholeDirectoryMoved: true, pausedStatePreserved: true, encryptedPathsRelocated: true, resumedSha256: true, resumedNonzeroRange: true, samplesRemoved: true }, null, 2)}\n`
  )
  console.log(
    'Packaged portable verification passed: settings, phone page, encrypted relocation, restart and SHA-256'
  )
} finally {
  await stop().catch(() => child?.kill())
  await fixture.close()
  // This exact temporary root is owned by this verification only.
  assert.equal(root, path.resolve('../.nexus-v1-fixtures/portable'))
  await rm(root, { recursive: true, force: true })
}
