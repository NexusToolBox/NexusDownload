import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { Commands } from '../src/shared/protocol/commands'
import { Queries } from '../src/shared/protocol/queries'
import type { ControlSnapshot } from '../src/shared/schemas/nexus-control'
import { expect, test, waitForEngineReady } from './fixtures/electron-app'
import { startHttpFixture } from './fixtures/http-server'

// Interface configuration contains a private local token. Never record traces/screenshots.
test.use({ trace: 'off', screenshot: 'off' })
test('local phone browser and AI actions share the real task lifecycle', async ({
  mainWindow: page,
  electronApp,
  userDataDir,
}) => {
  test.setTimeout(120000)
  await waitForEngineReady(page)
  const invoke = (channel: string, request?: unknown) =>
    page.evaluate(
      ({ channel, request }) =>
        (
          window as unknown as {
            motrix: { invoke(c: string, p?: unknown): Promise<unknown> }
          }
        ).motrix.invoke(channel, request),
      { channel, request }
    )
  const control = async (request: unknown) =>
    invoke(Commands.NexusControlAction, request)
  const snapshot = async () =>
    (await invoke(Queries.GetNexusControl)) as ControlSnapshot
  await expect
    .poll(async () => await page.locator('.empty').textContent())
    .not.toContain('Loading tasks')
  const initial = await snapshot()
  expect(initial.phone.enabled || initial.mcp.enabled).toBe(false)
  await control({ action: 'phone-enable', enabled: true })
  const phoneSnapshot = await snapshot()
  expect(
    Boolean(phoneSnapshot.phone.qr) || phoneSnapshot.phone.urls.length === 0
  ).toBe(true)
  const browser = await chromium.launch({ headless: true })
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const fixture = await startHttpFixture({
    size: 8 * 1024 * 1024,
    throttleBytesPerSecond: 512 * 1024,
  })
  try {
    await phone.goto('http://127.0.0.1:16811/')
    await phone.getByRole('button').click()
    const code = await phone.locator('p.text-3xl').textContent()
    await control({ action: 'phone-pair', code })
    await expect(phone.getByRole('textbox')).toBeVisible({ timeout: 15000 })
    await phone.getByRole('textbox').fill(fixture.fileUrl)
    await phone.getByRole('button', { name: '发送到电脑' }).click()
    await expect(phone.getByRole('status')).toContainText('已发送')
    await expect
      .poll(async () => JSON.stringify(await invoke(Queries.GetNexusWorkspace)))
      .toContain('127.0.0.1')
    await control({ action: 'mcp-enable', enabled: true })
    const config = (await snapshot()).mcp.config as {
      mcpServers: {
        nexusdownload: {
          env: { NEXUS_MCP_ENDPOINT: string; NEXUS_MCP_TOKEN: string }
        }
      }
    }
    const env = config.mcpServers.nexusdownload.env
    let sequence = 0
    const call = async (name: string, args: unknown = {}) => {
      const response = await fetch(env.NEXUS_MCP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.NEXUS_MCP_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++sequence,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
      const message = await response.json()
      if (message.result?.isError) throw new Error(`MCP action failed: ${name}`)
      return JSON.parse(message.result.content[0].text)
    }
    const check = await call('check_accounts')
    expect(check.reports).toEqual([])
    const added = await call('add_download', { input: fixture.fileUrl })
    const id = added.taskId
    expect(typeof id).toBe('string')
    await expect
      .poll(async () => JSON.stringify((await call('list_downloads')).tasks))
      .toContain(id)
    await expect
      .poll(async () => {
        const t = (await call('list_downloads')).tasks.find(
          (t: { id: string }) => t.id === id
        )
        return t?.completed > 0
      })
      .toBe(true)
    await phone.reload()
    await phone
      .getByRole('button', { name: '暂停', exact: true })
      .first()
      .click()
    await expect
      .poll(
        async () =>
          (await call('list_downloads')).tasks.find(
            (t: { id: string }) => t.id === id
          )?.status
      )
      .toBe('paused')
    await call('resume_download', { id })
    await expect
      .poll(
        async () =>
          (await call('list_downloads')).tasks.find(
            (t: { id: string }) => t.id === id
          )?.status
      )
      .toBe('downloading')
    await call('pause_download', { id })
    await call('get_failure', { id })
    await call('resume_download', { id })
    await expect
      .poll(
        async () =>
          (await call('list_downloads')).tasks.find(
            (t: { id: string }) => t.id === id
          )?.status,
        { timeout: 45000 }
      )
      .toBe('completed')
    const task = (
      (await invoke(Queries.ListTasks)) as {
        id: string
        saveDir: string
        filename: string
        finalPath: string | null
      }[]
    ).find((t) => t.id === id)
    if (!task) throw new Error('Completed task missing')
    const file = task.finalPath || path.join(task.saveDir, task.filename)
    expect(await fixture.verifyFile(file)).toBe(true)
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    })
    expect(
      (await call('remove_download', { id, deleteFiles: true })).cancelled
    ).toBe(true)
    await access(file)
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      })
    })
    await call('remove_download', { id, deleteFiles: true })
    await expect
      .poll(async () =>
        access(file).then(
          () => false,
          () => true
        )
      )
      .toBe(true)
    const device = (await snapshot()).phone.devices[0]
    await control({ action: 'phone-remove', id: device.id })
    await phone.reload()
    await expect(phone.getByRole('button', { name: '配对设备' })).toBeVisible({
      timeout: 15000,
    })
    await writeFile(
      path.join(userDataDir, 'verified.json'),
      JSON.stringify(
        {
          phonePairAndRevoke: true,
          phoneSubmitAndPause: true,
          mcpAddListPauseResumeFailureCheck: true,
          emptyAccountReport: true,
          deleteCancelledThenConfirmed: true,
          downloadHash: true,
        },
        null,
        2
      ) + '\n'
    )
    await writeFile(
      path.resolve('output/v1-control-live.json'),
      await readFile(path.join(userDataDir, 'verified.json'))
    )
  } finally {
    await control({ action: 'phone-enable', enabled: false })
    await control({ action: 'mcp-enable', enabled: false })
    await browser.close()
    await fixture.close()
  }
})
