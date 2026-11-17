import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { Queries } from '@shared/protocol/queries'
import { CURRENT_SETTINGS_VERSION } from '../src/core/settings/migrations'
import { Events } from '../src/shared/protocol/events'
import {
  expect,
  launchMotrix,
  test,
  waitForQueryHandlers,
} from './fixtures/electron-app'

async function openCard(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByText(name, { exact: true }).first().click()
}

test.beforeEach(async ({ userDataDir }) => {
  // These tests exercise settings presentation, without registering a host
  // browser launcher or importing clipboard content on the test machine.
  await writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({
      version: CURRENT_SETTINGS_VERSION,
      app: {
        language: 'en-US',
        browserBridgeEnabled: false,
        autofillClipboardLinks: false,
      },
      tracker: { autoSync: false },
      onboarding: { disclaimerAccepted: true },
    })
  )
})

test('ordinary desktop runtime retains its existing settings controls', async ({
  userDataDir,
  rpcPort,
}) => {
  const app = await launchMotrix({
    userDataDir,
    rpcPort,
    extraEnv: { MOTRIX_DEV_DISABLE_NATIVE_MESSAGING: '1' },
  })
  try {
    const page = await app.firstWindow()
    await waitForQueryHandlers(page)
    expect(
      await page.evaluate(
        (channel) => window.motrix.invoke(channel),
        Queries.GetPortableMode
      )
    ).toEqual({ enabled: false })
    await openCard(page, 'General')
    if (process.platform !== 'linux')
      await expect(
        page.getByRole('switch', { name: 'Open at login', exact: true })
      ).toBeEnabled()
  } finally {
    await app.close()
  }
})

test('portable settings disable system integration and open the application ZIP updater', async ({
  userDataDir,
  rpcPort,
}) => {
  const app = await launchMotrix({
    userDataDir,
    rpcPort,
    extraEnv: { MOTRIX_DEV_DISABLE_NATIVE_MESSAGING: '1' },
  })
  try {
    const page = await app.firstWindow()
    await waitForQueryHandlers(page)
    // Portable selection and main-process enforcement are covered by platform
    // tests. Inject the capability snapshot to exercise its real renderer UI
    // on every desktop CI host without pretending to run a Windows package.
    await app.evaluate(
      ({ ipcMain, BrowserWindow }, channels) => {
        ipcMain.removeHandler(channels.mode)
        ipcMain.handle(channels.mode, () => ({
          enabled: true,
          dataDirectory: 'E:\\Motrix\\data',
        }))
        ipcMain.removeHandler(channels.update)
        const state = {
          phase: 'available',
          currentVersion: '1.3.0',
          availableVersion: '1.3.1',
          updateAuthority: 'application',
        }
        ipcMain.handle(channels.update, () => state)
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send(channels.event, state)
      },
      {
        mode: Queries.GetPortableMode,
        update: Queries.GetUpdateState,
        event: Events.UpdateStateChanged,
      }
    )
    await openCard(page, 'General')
    if (process.platform !== 'linux')
      await expect(
        page.getByText(/Portable mode keeps system settings unchanged/)
      ).toBeVisible()
    if (process.platform !== 'linux')
      await expect(
        page.getByRole('switch', { name: 'Open at login', exact: true })
      ).toBeDisabled()
    await page.evaluate(() => {
      location.hash = '/settings?section=diagnostics'
    })
    await expect(
      page.getByRole('textbox', { name: 'Recovery data file', exact: true })
    ).toBeDisabled()
    await page.evaluate(() => {
      location.hash = '/settings?section=about'
    })
    await expect(page.getByText('Version 1.3.0 · Portable')).toBeVisible()
    await page.getByRole('button', { name: 'Update', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('1.3.1')
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Update now' })
    ).toBeVisible()
  } finally {
    await app.close()
  }
})
