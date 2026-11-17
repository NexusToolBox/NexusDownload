import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RendererInvokeChannel } from '../src/preload/api'
import { Commands } from '../src/shared/protocol/commands'
import { Queries } from '../src/shared/protocol/queries'
import { expect, test, waitForEngineReady } from './fixtures/electron-app'
import { startHttpFixture } from './fixtures/http-server'

test.use({ trace: 'off', screenshot: 'off' })
test('duplicate download actions and shortcut editing work with real tasks and OS conflicts', async ({
  electronApp,
  mainWindow: page,
  httpFixture,
  userDataDir,
}) => {
  test.setTimeout(120000)
  await waitForEngineReady(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'readText', {
      value: async () => '',
    })
  })
  const screenshots = path.resolve('design/final/compare/v15')
  await mkdir(screenshots, { recursive: true })
  const invoke = (channel: RendererInvokeChannel, request?: unknown) =>
    page.evaluate(
      ({ channel, request }) => window.motrix!.invoke(channel, request),
      { channel, request }
    )
  await invoke(Commands.UpdateSettings, {
    app: { language: 'zh-CN', warnBeforeExit: false },
  })
  await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.isVisible())
      ?.setContentSize(1280, 800)
  )
  const add = async (input: string) => {
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.locator('.nexus-source-input').fill(input)
  }
  await add(httpFixture.fileUrl)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^下载 1 个文件$/ })
    .click()
  await expect
    .poll(
      async () =>
        ((await invoke(Queries.ListTasks)) as { status: string }[]).filter(
          (task) => task.status === 'completed'
        ).length
    )
    .toBe(1)
  const tasks = (await invoke(Queries.ListTasks)) as {
    id: string
    finalPath: string
    diskPath: string
  }[]
  await add(httpFixture.fileUrl)
  await expect(page.getByTestId('duplicate-warning')).toContainText(
    '已经下载过'
  )
  await page.screenshot({
    path: path.join(screenshots, 'duplicate-single.png'),
  })
  await page.getByRole('button', { name: '仍然下载', exact: true }).click()
  await expect
    .poll(async () => ((await invoke(Queries.ListTasks)) as unknown[]).length)
    .toBe(2)
  await expect
    .poll(async () =>
      ((await invoke(Queries.ListTasks)) as { status: string }[]).every(
        (task) => task.status === 'completed'
      )
    )
    .toBe(true)
  const extraFixture = await startHttpFixture({ pathname: '/fresh.bin' })
  try {
    await add(`${httpFixture.fileUrl} ${extraFixture.fileUrl}`)
    await expect(page.getByTestId('duplicate-warning')).toContainText(
      '其中 1 个已经下载过'
    )
    await expect(
      page.getByRole('button', { name: '跳过这些', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({
      path: path.join(screenshots, 'duplicate-batch.png'),
    })
    await page.getByRole('button', { name: '全部下载', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '全部下载', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '跳过这些', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^下载 1 个文件$/ })
      .click()
    await expect
      .poll(async () => ((await invoke(Queries.ListTasks)) as unknown[]).length)
      .toBe(3)
    await expect
      .poll(async () =>
        ((await invoke(Queries.ListTasks)) as { status: string }[]).every(
          (task) => task.status === 'completed'
        )
      )
      .toBe(true)
    for (const task of (await invoke(Queries.ListTasks)) as typeof tasks)
      await rm(task.finalPath || task.diskPath, { force: true })
    await add(httpFixture.fileUrl)
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /^下载 1 个文件$/ })
    ).toBeVisible()
    await expect(page.getByTestId('duplicate-warning')).toHaveCount(0)
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await page.evaluate(() => {
      location.hash = '/settings?section=general'
    })
    const capture = page.getByTestId('shortcut-capture')
    await expect(capture).toHaveText('Alt+D')
    await capture.click()
    await expect(capture).toHaveText('按下新组合')
    await capture.press('Control+k')
    await expect(capture).toHaveText('Ctrl+K')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.screenshot({
      path: path.join(screenshots, 'shortcut-normal.png'),
    })
    const helper = path.join(userDataDir, 'shortcut-owner.cjs')
    const ready = path.join(userDataDir, 'shortcut-owner-ready')
    await writeFile(
      helper,
      `const {app,globalShortcut}=require('electron'); app.whenReady().then(()=>{ if(!globalShortcut.register('Alt+F9',()=>{}))process.exit(2); require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready'); });`
    )
    const executable = await electronApp.evaluate(() => process.execPath)
    const holder = spawn(executable, [helper], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let helperError = ''
    holder.stderr?.on('data', (chunk) => {
      helperError += String(chunk)
    })
    try {
      await expect
        .poll(async () => {
          if (holder.exitCode !== null)
            throw new Error(
              `Shortcut owner exited ${holder.exitCode}: ${helperError}`
            )
          return readFile(ready, 'utf8').catch(() => '')
        })
        .toBe('ready')
      await capture.click()
      await expect(capture).toHaveText('按下新组合')
      await capture.press('Alt+F9')
      await expect(capture).toHaveText('Alt+F9')
      await expect(
        page.getByText('已被其他软件占用，请换一个', { exact: true })
      ).toBeVisible()
      await page.screenshot({
        path: path.join(screenshots, 'shortcut-conflict.png'),
      })
      await capture.click()
      await expect(capture).toHaveText('按下新组合')
      await capture.press('Alt+d')
      await expect(capture).toHaveText('Alt+D')
      await expect(
        page.getByText('已被其他软件占用，请换一个', { exact: true })
      ).toHaveCount(0)
      await page.getByRole('button', { name: '清除', exact: true }).click()
      await expect(capture).toHaveText('已关闭')
    } finally {
      if (holder.exitCode === null) {
        const exited = once(holder, 'exit')
        holder.kill()
        await exited
      }
    }
  } finally {
    await extraFixture.close()
  }
})
