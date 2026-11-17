import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { DownloadErrorCode } from '../src/shared/errors'
import { Commands } from '../src/shared/protocol/commands'
import { Events } from '../src/shared/protocol/events'
import { Queries } from '../src/shared/protocol/queries'
import type { TaskStatus } from '../src/shared/types/task'
import { makeDownloadTask } from '../src/test-utils/task'
import { expect, test, waitForEngineReady } from './fixtures/electron-app'
import { startHttpFixture } from './fixtures/http-server'

test.use({ trace: 'off', screenshot: 'off' })
test('v1.4 complete desktop surfaces and simplified interactions', async ({
  mainWindow: page,
  electronApp,
}) => {
  test.setTimeout(240000)
  page.setDefaultTimeout(7000)
  await waitForEngineReady(page)
  await page.evaluate(
    async ({ command }) => {
      await window.motrix?.invoke(command, {
        app: { language: 'zh-CN', theme: 'light', warnBeforeExit: false },
      })
    },
    { command: Commands.UpdateSettings }
  )
  const directory = path.resolve('design/final/compare/v14')
  await mkdir(directory, { recursive: true })
  const navigate = async (route: string) => {
    await page.evaluate((value) => {
      location.hash = value
    }, route)
    await page.waitForTimeout(200)
  }
  const update = async (state: Record<string, unknown>) => {
    await electronApp.evaluate(
      ({ ipcMain, BrowserWindow }, args) => {
        const value = {
          currentVersion: '1.4.0',
          updateAuthority: 'application',
          ...args.state,
        }
        ipcMain.removeHandler(args.query)
        ipcMain.handle(args.query, () => value)
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send(args.event, value)
      },
      { state, query: Queries.GetUpdateState, event: Events.UpdateStateChanged }
    )
  }
  const cloud = async (mode: string) => {
    const avatar = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#6c897a"/><circle cx="48" cy="36" r="17" fill="#e9dfc5"/><path d="M15 94c0-40 66-40 66 0" fill="#e9dfc5"/></svg>').toString('base64')}`
    await electronApp.evaluate(
      ({ ipcMain, BrowserWindow }, args) => {
        const account = {
          id: 'account-demo',
          platform: 'baidu',
          state: 'ready',
          governor: 'conservative',
          requests: 128,
          links: 8,
          transfers: 2,
          transferLimit: 300,
          concurrency: 2,
          note: '日常文件',
          profile: { nickname: '示例账号', readAt: Date.now() },
          ...(args.mode === 'avatar' ? { avatarData: args.avatar } : {}),
          ...(args.mode === 'expired'
            ? { reason: 'login', needsLocalLogin: true }
            : {}),
          health: {
            checkedAt: Date.now(),
            login: args.mode === 'expired' ? 'expired' : 'valid',
            member: true,
            quota: { total: 2199023255552, used: 386547056640 },
            platformUsedBytes: null,
            expiresAt: null,
          },
        }
        const value = {
          available: true,
          accounts: args.mode === 'empty' ? [] : [account],
          tasks: [],
          orphans: [],
          koulingEnabled: false,
        }
        ipcMain.removeHandler(args.query)
        ipcMain.handle(args.query, () => value)
        ipcMain.removeHandler(args.browse)
        ipcMain.handle(args.browse, () => ({
          ok: true,
          value: {
            contextId: 'demo',
            platform: 'baidu',
            accountId: 'account-demo',
            title: '我的文件',
            files: [
              ['项目资料', true],
              ['旅行记录.mp4', false],
              ['照片.jpg', false],
              ['设计稿.zip', false],
              ['阅读清单.pdf', false],
            ].map(([name, directory], i) => ({
              id: String(i),
              name,
              directory,
              bytes: directory ? 0 : 208666624,
              parent: '0',
              path: String(i),
              modified: '2026-11-16T10:20:00Z',
            })),
            capabilities: {
              own: true,
              save: true,
              withoutSave: false,
              guest: false,
              playback: false,
            },
          },
        }))
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send(args.event)
      },
      {
        mode,
        avatar,
        query: Queries.GetNexusCloud,
        browse: Commands.NexusCloudBrowse,
        event: Events.NexusWorkspaceChanged,
      }
    )
    await page.waitForTimeout(200)
  }

  await electronApp.evaluate(({ BrowserWindow, clipboard }) => {
    BrowserWindow.getAllWindows()
      .find((win) => win.isVisible())
      ?.setContentSize(1280, 800)
    clipboard.clear()
  })
  const shot = async (name: string) => {
    await page.waitForTimeout(180)
    if (!name.includes('licenses'))
      expect(await page.locator('body').innerText()).not.toMatch(
        /nexus\.[a-zA-Z0-9.]+|Headless|Bearer|OAuth|Cookie|凭据库|脱敏/
      )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot({ path: path.join(directory, `${name}.png`) })
  }
  await cloud('empty')
  for (const [route, name] of [
    ['/downloads/all', 'downloads-empty'],
    ['/cloud', 'cloud-empty'],
    ['/media', 'media'],
    ['/services', 'services'],
  ]) {
    await navigate(route)
    await shot(`light-${name}`)
  }
  await cloud('initial')
  await navigate('/downloads/all')
  await navigate('/cloud')
  await shot('light-cloud')
  await page.locator('.nx-account-head').click()
  await shot('light-cloud-account-menu')
  await page.keyboard.press('Escape')
  for (const section of [
    'general',
    'downloads',
    'network',
    'queues',
    'accounts',
    'media',
    'tools',
    'connections',
    'about',
  ]) {
    await update({ phase: 'up-to-date' })
    await navigate(`/settings?section=${section}`)
    await shot(`light-settings-${section}`)
    const advanced = page.getByRole('button', { name: '高级', exact: true })
    if (await advanced.count()) {
      for (const button of await advanced.all()) {
        if ((await button.getAttribute('aria-expanded')) === 'false')
          await button.click()
      }
      await shot(`light-settings-${section}-advanced`)
    }
    const scroll = page.locator('.sbody').first()
    if (
      (await scroll.count()) &&
      (await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 10))
    ) {
      await scroll.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await shot(`light-settings-${section}-bottom`)
    }
    if (section === 'accounts') {
      const authorize = page
        .locator('.nx-item')
        .filter({ hasText: '阿里云盘' })
        .getByRole('button', { name: '登录', exact: true })
      await authorize.click()
      await shot('light-aliyun-config')
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '高级', exact: true })
        .click()
      await shot('light-aliyun-config-advanced')
      await page.keyboard.press('Escape')
    }
    if (section === 'about') {
      await page.getByRole('button', { name: '开源许可', exact: true }).click()
      await shot('light-licenses-dialog')
      await page.keyboard.press('Escape')
    }
  }
  // Settings persist as the user edits, including after leaving the page.
  await navigate('/settings?section=general')
  const setting = page.getByRole('switch').first()
  const oldValue = await setting.getAttribute('aria-checked')
  await setting.click()
  await page.waitForTimeout(600)
  await navigate('/downloads/all')
  await navigate('/settings?section=general')
  await expect(page.getByRole('switch').first()).toHaveAttribute(
    'aria-checked',
    oldValue === 'true' ? 'false' : 'true'
  )
  await update({
    phase: 'available',
    availableVersion: '1.4.1',
    releaseNotes: '## 本次更新\n- 改进下载稳定性\n- 优化账号与设置体验',
  })
  await navigate('/settings?section=about')
  await shot('light-about-available')
  await page.getByRole('button', { name: '更新内容', exact: true }).click()
  await shot('light-about-release-notes')
  await electronApp.evaluate(
    ({ ipcMain }, args) => {
      ipcMain.removeHandler(args.command)
      ipcMain.handle(args.command, () => {
        ;(globalThis as any).__v14UpdateRequested = true
        return { ok: true }
      })
    },
    { command: Commands.DownloadUpdate }
  )
  await page.getByRole('button', { name: '更新', exact: true }).click()
  expect(
    await electronApp.evaluate(() => (globalThis as any).__v14UpdateRequested)
  ).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await update({
    phase: 'downloading',
    availableVersion: '1.4.1',
    progress: {
      percent: 42,
      transferred: 69206016,
      total: 164777984,
      bytesPerSecond: 5242880,
    },
  })
  await shot('light-about-downloading')
  await update({
    phase: 'downloaded',
    availableVersion: '1.4.1',
    activeTasks: ['旅行记录.mp4', '项目资料.zip'],
  })
  await shot('light-about-ready')
  await page.getByRole('button', { name: '重启', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('会暂停 2 个下载')
  await shot('light-update-restart-confirm')
  await page.keyboard.press('Escape')
  for (const phase of ['available', 'downloading', 'downloaded']) {
    await update({
      phase,
      availableVersion: '1.4.1',
      progress: {
        percent: 42,
        transferred: 42,
        total: 100,
        bytesPerSecond: 10,
      },
    })
    await navigate('/downloads/all')
    await shot(`light-status-update-${phase}`)
  }
  await update({ phase: 'idle' })
  const tasks = [
    ['downloading', '旅行记录.mp4'],
    ['paused', '项目资料.zip'],
    ['completed', '阅读清单.pdf'],
    ['error', '安装包.zip'],
  ].map(([status, name], i) =>
    makeDownloadTask({
      id: `demo-${status}`,
      name,
      filename: name,
      status: status as TaskStatus,
      progress: status === 'completed' ? 1 : 0.42,
      totalBytes: 208666624,
      downloadedBytes: 87639982,
      downloadSpeed: status === 'downloading' ? 5242880 : 0,
      etaSeconds: 60,
      saveDir: String.raw`D:\Downloads`,
      createdAt: Date.now() - i * 1000,
      errorCode: status === 'error' ? DownloadErrorCode.DiskFull : null,
    })
  )
  await electronApp.evaluate(
    ({ ipcMain, BrowserWindow }, args) => {
      ipcMain.removeHandler(args.query)
      ipcMain.handle(args.query, () => args.tasks)
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send(args.event, args.tasks)
    },
    { query: Queries.ListTasks, event: Events.TaskUpdated, tasks }
  )
  for (const engine of ['ready', 'starting', 'stopped', 'ready']) {
    await electronApp.evaluate(
      ({ ipcMain, BrowserWindow }, args) => {
        ipcMain.removeHandler(args.query)
        ipcMain.handle(args.query, () => ({ state: args.engine }))
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send(args.event, args.engine)
      },
      {
        engine,
        query: Queries.GetEngineStatus,
        event: Events.EngineStateChanged,
      }
    )
    await navigate('/downloads/all')
    if (engine === 'stopped') {
      await expect(page.locator('#nexus-task-demo-downloading')).toContainText(
        '等待下载服务'
      )
      await expect(
        page.locator('#nexus-task-demo-downloading')
      ).not.toContainText('5 MB')
    }
    await shot(`light-downloads-${engine}`)
  }
  await page.locator('#nexus-task-demo-error').click()
  await expect(page.locator('.inspector')).not.toContainText('处理步骤')
  await shot('light-download-failure-inspector')
  await page
    .locator('.inspector')
    .getByRole('button', { name: '换个保存位置' })
    .click()
  await shot('light-download-retry-location')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await shot('light-add-download')
  await page.keyboard.press('Escape')
  const preflight = (mode: string) => ({
    items: [
      {
        id: 'demo-preflight',
        title: '旅行记录.mp4',
        fileType: 'video',
        addedAt: Date.now(),
        available: mode !== 'unavailable',
        saveDir: String.raw`D:\Downloads`,
        source: {
          id: 'demo-source',
          platform: 'http',
          identity: '0'.repeat(64),
          host: 'example.com',
          resourceKind: 'original-file',
          expectedBytes: mode === 'unknown' ? null : 208666624,
        },
      },
    ],
    disks: [
      {
        directory: String.raw`D:\Downloads`,
        volume: 'D:',
        freeBytes: mode === 'space' ? 0 : 128849018880,
        totalBytes: 549755813888,
      },
    ],
    knownBytes: mode === 'unknown' ? 0 : 208666624,
    unknownCount: mode === 'unknown' ? 1 : 0,
    blocked: mode === 'space' || mode === 'unavailable',
  })
  for (const mode of ['ready', 'unknown', 'space', 'unavailable']) {
    await electronApp.evaluate(
      ({ ipcMain }, args) => {
        ipcMain.removeHandler(args.query)
        ipcMain.handle(args.query, () => args.value)
      },
      { query: Queries.GetNexusPreflight, value: preflight(mode) }
    )
    await navigate('/downloads/all?nexusAdd=demo-preflight')
    await shot(`light-preflight-${mode}`)
    await page.keyboard.press('Escape')
  }
  // Each conversion requires the user's consent before contacting the service.
  await page.keyboard.press('Control+k')
  await page.locator('.nexus-source-input').fill('分享口令示例')
  await expect(page.getByRole('dialog')).toContainText(
    '口令会发送给第三方服务转换'
  )
  await shot('light-add-consent')
  await page.keyboard.press('Escape')
  await electronApp.evaluate(
    ({ ipcMain }, args) => {
      let installed = false
      const ids = ['yt-dlp', 'deno', 'ffmpeg', 'gallery-dl', '7zip']
      ipcMain.removeHandler(args.tools)
      ipcMain.handle(args.tools, () => ({
        tools: ids.map((id) => ({
          id,
          installed: installed ? '1.0.0' : null,
          busy: false,
        })),
      }))
      ipcMain.removeHandler(args.install)
      ipcMain.handle(args.install, (_event, request) => {
        const state = globalThis as any
        state.__v14Installed = [...(state.__v14Installed ?? []), request.id]
        installed = true
        return { ok: true }
      })
      ipcMain.removeHandler(args.media)
      ipcMain.handle(args.media, () =>
        installed
          ? {
              ok: true,
              value: {
                id: 'media-demo',
                platform: 'external',
                title: '山野之间 · 秋日旅行记录',
                choices: [
                  {
                    id: '1080',
                    entry: 'one',
                    label: '1080p 高清',
                    kind: 'video',
                    format: 'mp4',
                    bytes: 208666624,
                  },
                ],
                subtitles: ['中文'],
              },
            }
          : { ok: false, error: 'tools.yt-dlp' }
      )
    },
    {
      tools: Queries.GetNexusTools,
      install: Commands.NexusToolsAction,
      media: Commands.NexusMediaAction,
    }
  )
  await navigate('/media')
  await page
    .locator('.nexus-media-input input')
    .fill('https://example.com/watch')
  await page.locator('.nexus-media-input button[type=submit]').click()
  await expect(
    page.getByRole('button', { name: '安装', exact: true })
  ).toBeVisible()
  await shot('light-media-needs-tools')
  await page.getByRole('button', { name: '安装', exact: true }).click()
  await expect(page.locator('.nexus-media-result')).toContainText(
    '秋日旅行记录'
  )
  expect(
    await electronApp.evaluate(() => (globalThis as any).__v14Installed)
  ).toEqual(['yt-dlp', 'deno', 'ffmpeg'])
  await shot('light-media-results')
  await navigate('/settings?section=tools')
  await expect(page.getByText('已安装', { exact: true })).toHaveCount(3)
  await shot('light-settings-tools-installed')
  await page
    .locator('.sbody')
    .getByRole('button', { name: '更多', exact: true })
    .first()
    .click()
  await shot('light-tools-menu')
  await page.keyboard.press('Escape')
  for (const [route, name] of [
    ['/downloads/all', 'downloads'],
    ['/cloud', 'cloud'],
    ['/settings?section=general', 'settings-general'],
  ]) {
    await page.evaluate(async (command) => {
      await window.motrix?.invoke(command, { app: { theme: 'dark' } })
    }, Commands.UpdateSettings)
    await navigate(route)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await shot(`dark-${name}`)
  }
})

test('v1.4 empty data starts directly and downloads from the clipboard', async () => {
  const filename = `nexus-v14-${Date.now()}.bin`
  const httpFixture = await startHttpFixture({ pathname: `/${filename}` })
  test.setTimeout(60000)
  const fresh = await mkdtemp(path.join(tmpdir(), 'nexus-v14-fresh-'))
  const app = await electron.launch({
    timeout: 20000,
    args: [path.resolve('.')],
    cwd: fresh,
    env: { ...process.env, MOTRIX_USER_DATA: fresh, NODE_ENV: 'test' },
  })
  let saved = ''
  try {
    const page = await app.firstWindow({ timeout: 20000 })
    await waitForEngineReady(page)
    await expect(
      page.getByRole('heading', { name: '下载', exact: true })
    ).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('Motrix')
    await expect(page.locator('body')).toContainText('粘贴一个链接开始下载')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
    )
    await page.screenshot({
      path: path.resolve('design/final/compare/v14/light-first-launch.png'),
    })
    const expected = await app.evaluate(({ app }) => app.getPath('downloads'))
    const settings = (await page.evaluate(
      (query) => window.motrix?.invoke(query),
      Queries.GetSettings
    )) as any
    expect(settings.app.defaultSaveDir).toBe(expected)
    await app.evaluate(
      ({ clipboard }, url) => clipboard.writeText(url),
      httpFixture.fileUrl
    )
    await page.getByRole('button', { name: '添加下载', exact: true }).click()
    await expect(page.locator('.nexus-source-input')).toHaveValue(
      httpFixture.fileUrl
    )
    await expect(page.getByRole('dialog')).toContainText(filename)
    await page.screenshot({
      path: path.resolve(
        'design/final/compare/v14/light-clipboard-preflight.png'
      ),
    })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^下载 \d+ 个文件$/ })
      .click()
    await expect
      .poll(
        async () => {
          const tasks = (await page.evaluate(
            (query) => window.motrix?.invoke(query),
            Queries.ListTasks
          )) as any[]
          const task = tasks.find((t) => t.name === filename)
          if (task)
            saved = task.finalPath || path.join(task.saveDir, task.filename)
          return task?.status
        },
        { timeout: 30000 }
      )
      .toBe('completed')
    expect(await httpFixture.verifyFile(saved)).toBe(true)
  } finally {
    await app.close().catch(() => {})
    await httpFixture.close()
    if (saved) await unlink(saved).catch(() => {})
    await rm(fresh, { recursive: true, force: true, maxRetries: 5 })
  }
})
