// Real packaged Windows smoke test; all fixture applications are removed on exit.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as asar from '@electron/asar'
import { chromium } from 'playwright'
import { startHttpFixture } from '../e2e/fixtures/http-server.ts'
import { getFreePort } from '../e2e/helpers/free-port.ts'
import { fileSha256 } from '../src/core/nexus/tools/file-sha256.ts'
import { MenuItemIds } from '../src/main/menu/menu-ids.ts'
import { Commands } from '../src/shared/protocol/commands.ts'
import { Queries } from '../src/shared/protocol/queries.ts'

const run = promisify(execFile)
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const nextVersion = version.replace(/\d+$/, (patch) =>
  String(Number(patch) + 1)
)
const fresh = process.env.NEXUS_FRESH_DATA === '1'
const startupOnly = fresh || process.env.NEXUS_STARTUP_ONLY === '1'
const freshFilename = `nexus-portable-${Date.now()}.bin`
const base = await mkdtemp(path.join(tmpdir(), 'nexus-packaged-update-'))
assert.equal(path.dirname(base), path.resolve(tmpdir()))
const running = path.join(base, 'portable')
const next = path.join(base, 'next')
const shell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe'
)
const cache = path.join(
  process.env.LOCALAPPDATA,
  'electron-builder/Cache/7zip@1.0.0'
)
const sevenZip = path.join(
  cache,
  (await readdir(cache)).find((name) => name.startsWith('7zip-win-x64-')),
  'bin/7za.exe'
)
const archive = path.resolve(
  process.argv[2] || `release/NexusDownload-v${version}-win-x64.zip`
)
const filename = `NexusDownload-v${nextVersion}-win-x64.zip`
const zip = path.join(base, filename)
const port = await getFreePort()
let digest = '',
  zipBytes = 0,
  app,
  browser,
  page,
  downloadFixture
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, message, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await delay(200)
  }
  throw new Error(message)
}
const server = createServer((req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`
  if (req.url.endsWith('/releases/latest')) {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        tag_name: `v${nextVersion}`,
        body: '## Local update\n- Retain tasks and accounts',
        draft: false,
        prerelease: false,
        html_url: `${origin}/release`,
        assets: [
          {
            name: filename,
            browser_download_url: `${origin}/${filename}`,
            size: zipBytes,
          },
          {
            name: `${filename}.sha256`,
            browser_download_url: `${origin}/${filename}.sha256`,
            size: 99,
          },
        ],
      })
    )
  } else if (req.url.endsWith('.sha256')) res.end(`${digest}  ${filename}`)
  else if (req.url === `/${filename}`) {
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0)
    const end = Number(
      /bytes=\d+-(\d+)/.exec(req.headers.range || '')?.[1] || zipBytes - 1
    )
    res.writeHead(req.headers.range ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(req.headers.range
        ? { 'Content-Range': `bytes ${start}-${end}/${zipBytes}` }
        : {}),
    })
    createReadStream(zip, { start, end }).pipe(res)
  } else res.writeHead(404).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${String(server.address().port).padStart(5, '0')}`
function replaceBytes(buffer, before, after) {
  const original = Buffer.from(before),
    replacement = Buffer.from(after)
  assert.equal(
    original.length,
    replacement.length,
    'Fixture patch must preserve ASAR offsets'
  )
  let offset = buffer.indexOf(original),
    count = 0
  while (offset !== -1) {
    replacement.copy(buffer, offset)
    count++
    offset = buffer.indexOf(original, offset + replacement.length)
  }
  assert.ok(count > 0, 'Expected fixture patch target')
}
async function connect() {
  await until(async () => {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 500,
      })
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((value) => value.url().includes('w=main'))
      return !!page
    } catch {
      return false
    }
  }, 'Packaged renderer unavailable')
  let engineState = 'unavailable'
  await until(async () => {
    try {
      const nextState = (await invoke(Queries.GetEngineStatus)).state
      if (engineState !== nextState) {
        engineState = nextState
        console.log('Packaged engine state:', engineState)
      }
      return engineState === 'ready'
    } catch {
      return false
    }
  }, 'Packaged engine unavailable')
}
function invoke(channel, request) {
  return page.evaluate(
    ({ channel, request }) => window.motrix.invoke(channel, request),
    { channel, request }
  )
}
try {
  await mkdir(running)
  await run(sevenZip, ['x', archive, `-o${running}`, '-y'], {
    windowsHide: true,
  })
  const application = path.join(running, 'resources/app.asar')
  const bytes = await readFile(application)
  // Only the disposable fixture permits localhost; the release retains HTTPS.
  replaceBytes(bytes, 'https://api.github.com', origin)
  const check = 'this.options.allowLocalhost'
  replaceBytes(bytes, check, 'true'.padEnd(check.length, ' '))
  if (!startupOnly) await writeFile(application, bytes)
  const helper = path.join(running, 'resources/nexus-updater.ps1')
  await writeFile(
    helper,
    (await readFile(helper, 'utf8')).replaceAll(
      'Start-Process -FilePath $job.exe -WorkingDirectory',
      `Start-Process -FilePath $job.exe -ArgumentList '--remote-debugging-port=${port}' -WorkingDirectory`
    )
  )
  if (!startupOnly) {
    await cp(running, next, { recursive: true })
    const newApplication = path.join(next, 'resources/app.asar')
    const oldMetadata = asar.extractFile(application, 'package.json').toString()
    const newMetadata = oldMetadata.replace(
      /("version"\s*:\s*")[^"]+("|$)/,
      (_match, before, after) => `${before}${nextVersion}${after}`
    )
    assert.notEqual(oldMetadata, newMetadata)
    const newBytes = await readFile(newApplication)
    replaceBytes(newBytes, oldMetadata, newMetadata)
    await writeFile(newApplication, newBytes)
    await run(sevenZip, ['a', '-tzip', '-mx=1', '-mmt=4', zip, '.\\*'], {
      cwd: next,
      windowsHide: true,
    })
    digest = await fileSha256(zip)
    zipBytes = (await stat(zip)).size
    // Drop the expanded next-version copy before running the update.
    assert.equal(path.dirname(next), base)
    await rm(next, { recursive: true, force: true })
  }
  const userData = path.join(running, 'data/user-data')
  if (!fresh) {
    await mkdir(userData, { recursive: true })
    await writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        version: 13,
        app: {
          language: 'zh-CN',
          warnBeforeExit: false,
          browserBridgeEnabled: false,
          autofillClipboardLinks: false,
          checkForUpdatesOnLaunch: false,
        },
        tracker: { autoSync: false },
        onboarding: { disclaimerAccepted: true },
      })
    )
    await writeFile(
      path.join(userData, 'nexus-credentials.bin'),
      'locked-fixture'
    )
    await writeFile(
      path.join(userData, 'cloud-accounts.json'),
      JSON.stringify([
        {
          id: 'account-update-fixture',
          platform: 'baidu',
          governor: { day: '2026-11-17', requests: 0, links: 0, transfers: 0 },
          note: '',
          profile: { nickname: '更新验证', readAt: Date.now() },
        },
      ])
    )
  }
  downloadFixture = await startHttpFixture({
    pathname: `/${freshFilename}`,
    size: fresh ? 1024 * 1024 : 8 * 1024 * 1024,
    throttleBytesPerSecond: fresh ? 0 : 256 * 1024,
  })
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    MOTRIX_RPC_PORT: String(await getFreePort()),
  }
  delete env.MOTRIX_USER_DATA
  delete env.MOTRIX_BRIDGE_DATA_DIR
  delete env.MOTRIX_DEFAULT_SAVE_DIR
  delete env.ELECTRON_RUN_AS_NODE
  app = spawn(
    path.join(running, 'NexusDownload.exe'),
    [`--remote-debugging-port=${port}`],
    { cwd: running, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  // Drain output without retaining account or transport data.
  app.stdout.resume()
  app.stderr.resume()
  await connect()
  assert.equal((await invoke(Queries.GetPortableMode)).enabled, true)
  if (!fresh)
    assert.equal(
      (await invoke(Queries.GetNexusCloud)).accounts[0].profile.nickname,
      '更新验证'
    )
  if (fresh) {
    assert.equal((await invoke(Queries.ListTasks)).length, 0)
    assert.equal((await invoke(Queries.GetNexusCloud)).accounts.length, 0)
    assert.ok(!(await page.locator('body').innerText()).includes('Motrix'))
    await page.getByRole('heading', { name: '下载', exact: true }).waitFor()
    const saveDir = (await invoke(Queries.GetSettings)).app.defaultSaveDir
    const { stdout } = await run(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$p = (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'; [Environment]::ExpandEnvironmentVariables($p)",
      ],
      { windowsHide: true }
    )
    assert.equal(path.resolve(saveDir), path.resolve(stdout.trim()))
    const downloaded = path.join(saveDir, freshFilename)
    try {
      await page.getByRole('button', { name: '添加下载', exact: true }).click()
      await page.locator('.nexus-source-input').fill(downloadFixture.fileUrl)
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^下载 \d+ 个文件$/ })
        .click()
      await until(
        async () =>
          (await invoke(Queries.ListTasks)).some(
            (task) => task.status === 'completed'
          ),
        'Fresh portable download did not finish'
      )
      assert.equal(await downloadFixture.verifyFile(downloaded), true)
    } finally {
      await rm(downloaded, { force: true })
    }
  }
  if (!startupOnly) {
    await invoke(Commands.CreateTask, {
      type: 'http',
      uris: [downloadFixture.fileUrl],
      saveDir: path.join(running, 'Downloads'),
      filename: 'retained.bin',
    })
    await until(
      async () => (await invoke(Queries.ListTasks))[0]?.downloadedBytes > 0,
      'Task did not transfer'
    )
    const task = (await invoke(Queries.ListTasks))[0]
    await invoke(Commands.PauseTask, task.id)
    await invoke(Commands.CheckForUpdates)
    assert.equal(
      (await invoke(Queries.GetUpdateState)).availableVersion,
      nextVersion
    )
    await invoke(Commands.DownloadUpdate)
    await until(
      async () => {
        const state = await invoke(Queries.GetUpdateState)
        assert.notEqual(state.phase, 'error', state.error?.message)
        return state.phase === 'downloaded'
      },
      'Release ZIP did not download',
      120000
    )
    assert.equal(
      (await invoke(Queries.ListTasks)).length,
      1,
      'Update ZIP must stay outside the user task list'
    )
    console.log('Release ZIP downloaded and verified')
    await invoke(Commands.InstallUpdate).catch(() => {})
    await until(
      async () => app.exitCode !== null,
      'Original application did not exit'
    )
    await browser.close().catch(() => {})
    await until(
      async () =>
        JSON.parse(
          await readFile(
            path.join(running, 'data/updates/transaction.json'),
            'utf8'
          ).catch(() => '{}')
        ).phase === 'completed',
      'Packaged update did not complete',
      120000
    )
    await connect()
    assert.equal(
      (await invoke(Queries.GetUpdateState)).currentVersion,
      nextVersion
    )
    assert.ok(
      (await invoke(Queries.ListTasks)).some((value) => value.id === task.id)
    )
    assert.equal(
      (await invoke(Queries.GetNexusCloud)).accounts[0].profile.nickname,
      '更新验证'
    )
    await until(
      async () =>
        !(await stat(path.join(running, '.update-backup')).then(
          () => true,
          () => false
        )),
      'Successful update did not clean its backup',
      30000
    )
    await until(
      async () =>
        !(await stat(path.join(running, 'data/updates', filename)).then(
          () => true,
          () => false
        )),
      'Successful update did not clean its archive',
      30000
    )
    assert.equal((await invoke(Queries.ListTasks)).length, 1)
  }
  const menu = await invoke(Queries.GetApplicationMenu)
  await invoke(Commands.ExecuteApplicationMenuItem, {
    itemId: MenuItemIds.AppQuit,
    revision: menu.revision,
    trigger: 'menu',
    selectedTaskId: null,
  }).catch(() => {})
  console.log(
    fresh
      ? `Packaged ${version} fresh start and download passed`
      : startupOnly
        ? `Packaged ${version} startup passed; engine ready`
        : `Packaged ${version} -> local Release -> ${nextVersion} passed; task and account retained`
  )
} catch (error) {
  throw error
} finally {
  await browser?.close().catch(() => {})
  if (app && app.exitCode === null) app.kill()
  // Only terminate applications whose exact executable belongs to this fixture.
  const quoted = path.join(running, 'NexusDownload.exe').replaceAll("'", "''")
  await run(
    shell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${quoted}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    { windowsHide: true }
  ).catch(() => {})
  await downloadFixture?.close().catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await delay(1000)
  assert.equal(path.dirname(base), path.resolve(tmpdir()))
  await rm(base, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 500,
  })
}
