import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DownloadErrorCode } from '../src/shared/errors'
import { Commands } from '../src/shared/protocol/commands'
import { Events } from '../src/shared/protocol/events'
import { Queries } from '../src/shared/protocol/queries'
import type { TaskStatus } from '../src/shared/types/task'
import { makeDownloadTask } from '../src/test-utils/task'
import { expect, test, waitForEngineReady } from './fixtures/electron-app'

test.use({ trace: 'off', screenshot: 'off' })
test('v1.3 settings and state surfaces at both desktop sizes and themes', async ({
  mainWindow: page,
  electronApp,
}) => {
  test.setTimeout(240000)
  await waitForEngineReady(page)
  await page.evaluate(
    async ({ command }) => {
      await window.motrix?.invoke(command, {
        app: { language: 'zh-CN', theme: 'light', warnBeforeExit: false },
      })
    },
    { command: Commands.UpdateSettings }
  )
  const directory = path.resolve('design/final/compare/v13')
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
          currentVersion: '1.3.0',
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
          profile: { nickname: '林间', readAt: Date.now() },
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
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1024, height: 700 },
  ]) {
    await electronApp.evaluate(({ BrowserWindow }, dimensions) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
      win?.setContentSize(dimensions.width, dimensions.height)
    }, size)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        async ({ command, theme }) => {
          await window.motrix?.invoke(command, { app: { theme } })
        },
        { command: Commands.UpdateSettings, theme }
      )
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page.locator('html')).toHaveClass(new RegExp(theme))
      const shot = async (name: string) => {
        await page.waitForTimeout(150)
        await page.screenshot({
          path: path.join(
            directory,
            `${size.width}x${size.height}-${theme}-${name}.png`
          ),
        })
      }
      await cloud('empty')
      await navigate('/cloud')
      await shot('cloud-empty')
      await cloud('avatar')
      await navigate('/downloads/all')
      await navigate('/cloud')
      await shot('cloud-avatar')
      await page.locator('.nx-account-head').click()
      await shot('cloud-account-menu')
      await page.keyboard.press('Escape')
      await cloud('initial')
      await navigate('/downloads/all')
      await navigate('/cloud')
      await shot('cloud-initial')
      await cloud('expired')
      await navigate('/downloads/all')
      await navigate('/cloud')
      await shot('cloud-expired')
      await cloud('avatar')
      for (const section of [
        'general',
        'downloads',
        'network',
        'bittorrent',
        'queues',
        'accounts',
        'media',
        'browser',
        'phone',
        'mcp',
        'appearance',
        'tools',
        'diagnostics',
        'about',
      ]) {
        await update({
          phase: 'up-to-date',
          checkedAt: new Date().toISOString(),
        })
        await navigate(`/settings?section=${section}`)
        expect(await page.locator('.page.on').count()).toBeGreaterThan(0)
        await shot(`settings-${section}`)
        if (section === 'about') {
          await page
            .getByRole('button', { name: '开源许可与第三方声明', exact: true })
            .click()
          await shot('licenses-dialog')
          await page.keyboard.press('Escape')
        }
        if (
          [
            'general',
            'downloads',
            'network',
            'bittorrent',
            'appearance',
            'browser',
            'diagnostics',
          ].includes(section)
        ) {
          const scroll = page.locator('.sbody').first()
          if (await scroll.count()) {
            await scroll.evaluate((el) => {
              el.scrollTop = el.scrollHeight
            })
            await shot(`settings-${section}-bottom`)
          }
        }
      }
      await update({
        phase: 'available',
        availableVersion: '1.3.1',
        releaseNotes: '## 本次更新\n- 改进下载稳定性\n- 优化网盘账号与设置体验',
      })
      await navigate('/settings?section=about')
      await shot('about-available')
      await page.evaluate(() =>
        window.dispatchEvent(new Event('nexus-open-update'))
      )
      await shot('update-available')
      await update({
        phase: 'downloading',
        availableVersion: '1.3.1',
        progress: {
          percent: 42,
          transferred: 69206016,
          total: 164777984,
          bytesPerSecond: 5242880,
        },
      })
      await shot('update-downloading')
      await update({
        phase: 'downloaded',
        availableVersion: '1.3.1',
        activeTasks: ['旅行记录.mp4', '项目资料.zip'],
      })
      await shot('update-ready')
      await update({ phase: 'idle', restoredVersion: '1.3.0' })
      await shot('update-restored')
      await page.keyboard.press('Escape')
      await navigate('/downloads/all')
      await shot('update-restored-banner')
      await update({ phase: 'idle', completedVersion: '1.3.1' })
      await shot('update-completed-banner')
      await update({ phase: 'idle' })
      for (const engine of ['ready', 'starting', 'stopped']) {
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
        await shot(`downloads-${engine}`)
      }
      const tasks = [
        ['downloading', '旅行记录.mp4'],
        ['paused', '项目资料.zip'],
        ['completed', '阅读清单.pdf'],
        ['error', '安装包.zip'],
      ].map(([status, name], index) =>
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
          saveDir: 'D:\\Downloads',
          createdAt: Date.now() - index * 1000,
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
      await navigate('/downloads/all')
      await expect(page.locator('#nexus-task-demo-downloading')).toBeVisible()
      await shot('downloads-task-states')
      for (const status of ['paused', 'completed', 'error']) {
        await expect(
          page.locator(`#nexus-task-demo-${status}`)
        ).not.toContainText('剩余')
      }
      await page.locator('#nexus-task-demo-error').click()
      await shot('downloads-failure-inspector')
      await expect(page.locator('.inspector')).not.toContainText('0 B/s')
      await page
        .locator('.inspector')
        .getByRole('button', { name: '换个保存位置' })
        .click()
      await shot('retry-location-dialog')
      await page.keyboard.press('Escape')
      await electronApp.evaluate(
        ({ BrowserWindow }, args) => {
          for (const win of BrowserWindow.getAllWindows())
            win.webContents.send(args.event, [])
        },
        { event: Events.TaskUpdated }
      )
      await page.keyboard.press('Control+k')
      await shot('add-download-dialog')
      await page.keyboard.press('Escape')
      await electronApp.evaluate(
        ({ ipcMain }, args) => {
          ipcMain.removeHandler(args.query)
          ipcMain.handle(args.query, () => ({
            items: [
              {
                id: 'demo-preflight',
                title: '旅行记录.mp4',
                fileType: 'video',
                addedAt: Date.now(),
                available: true,
                saveDir: 'D:\\Downloads',
                source: {
                  id: 'demo-source',
                  platform: 'http',
                  identity: '0'.repeat(64),
                  host: 'example.com',
                  resourceKind: 'original-file',
                  expectedBytes: 208666624,
                },
              },
            ],
            disks: [
              {
                directory: 'D:\\Downloads',
                volume: 'D:',
                freeBytes: 128849018880,
                totalBytes: 549755813888,
              },
            ],
            knownBytes: 208666624,
            unknownCount: 0,
            blocked: false,
          }))
        },
        { query: Queries.GetNexusPreflight }
      )
      await navigate('/downloads/all?nexusAdd=demo-preflight')
      await shot('preflight-dialog')
      await page.keyboard.press('Escape')
      await navigate('/services')
      await shot('services')
      await page.getByRole('button', { name: '添加节点', exact: true }).click()
      await shot('remote-node-dialog')
      await page.keyboard.press('Escape')
      await page.locator('.nx-flush-title').click()
      await shot('offline-download-dialog')
      await page.keyboard.press('Escape')
      await navigate('/media')
      await electronApp.evaluate(
        ({ ipcMain }, args) => {
          ipcMain.removeHandler(args.command)
          ipcMain.handle(args.command, () => ({
            ok: true,
            value: {
              id: 'demo',
              platform: 'bilibili',
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
                {
                  id: '720',
                  entry: 'one',
                  label: '720p',
                  kind: 'video',
                  format: 'mp4',
                  bytes: 104333312,
                },
              ],
              subtitles: ['中文'],
            },
          }))
        },
        { command: Commands.NexusMediaAction }
      )
      await page
        .locator('.nexus-media-input input')
        .fill('https://www.bilibili.com/video/BV1Demo')
      await page.locator('.nexus-media-input button[type=submit]').click()
      await shot('media-results')
      expect(await page.locator('body').textContent()).not.toContain('one ·')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
    }
  }
})
