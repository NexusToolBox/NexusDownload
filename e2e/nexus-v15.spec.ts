import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CURRENT_SETTINGS_VERSION } from '../src/core/settings/migrations'
import { NEXUS_VERSION } from '../src/shared/nexus-version'
import { Commands } from '../src/shared/protocol/commands'
import { Queries } from '../src/shared/protocol/queries'
import {
  expect,
  launchMotrix,
  test,
  waitForEngineReady,
} from './fixtures/electron-app'

test.use({ trace: 'off', screenshot: 'off' })
const screenshots = path.resolve('design/final/compare/v15')

test('version consent exits cleanly and persists before opening the main window', async ({
  userDataDir,
  rpcPort,
}) => {
  test.setTimeout(120000)
  let application = await launchMotrix({
    userDataDir,
    rpcPort,
    disclaimerAccepted: false,
  })
  let page = await application.firstWindow()
  await expect(page.getByTestId('disclaimer-panel')).toBeVisible()
  expect((await application.windows()).length).toBe(1)
  const exited = application.waitForEvent('close')
  await page.getByTestId('disclaimer-quit').click()
  await exited
  application = await launchMotrix({
    userDataDir,
    rpcPort,
    disclaimerAccepted: false,
  })
  page = await application.firstWindow()
  await expect(page.getByTestId('disclaimer-panel')).toBeVisible()
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, 'notice-en-US.png') })
  await page.getByTestId('disclaimer-agree').click()
  await expect
    .poll(() =>
      application.windows().some((win) => !win.url().includes('w=onboarding'))
    )
    .toBe(true)
  const settings = JSON.parse(
    await readFile(path.join(userDataDir, 'settings.json'), 'utf8')
  )
  expect(settings.onboarding.acceptedVersion).toBe(NEXUS_VERSION)
  expect(settings.onboarding.acceptedAt).toBeGreaterThan(0)
  await application.close()
  application = await launchMotrix({ userDataDir, rpcPort })
  page = await application.firstWindow()
  await waitForEngineReady(page)
  await expect(page.getByTestId('disclaimer-panel')).toHaveCount(0)
  await application.close()
})

for (const language of ['zh-CN', 'en-US', 'ja', 'ar'])
  test(`main surfaces follow ${language} with bounded layout`, async ({
    userDataDir,
    rpcPort,
  }) => {
    test.setTimeout(240000)
    await mkdir(screenshots, { recursive: true })
    {
      await writeFile(
        path.join(userDataDir, 'settings.json'),
        JSON.stringify({
          version: CURRENT_SETTINGS_VERSION,
          app: {
            language,
            theme: 'light',
            warnBeforeExit: false,
            autofillClipboardLinks: false,
          },
          tracker: { autoSync: false },
          onboarding: { disclaimerAccepted: false },
        })
      )
      const application = await launchMotrix({
        userDataDir,
        rpcPort,
        disclaimerAccepted: false,
      })
      try {
        const notice = await application.firstWindow()
        await expect(notice.getByTestId('disclaimer-panel')).toBeVisible()
        await expect(notice.locator('html')).toHaveAttribute(
          'dir',
          language === 'ar' ? 'rtl' : 'ltr'
        )
        await notice.screenshot({
          path: path.join(screenshots, `notice-${language}.png`),
        })
        await notice.getByTestId('disclaimer-agree').click()
        await expect
          .poll(() =>
            application
              .windows()
              .find((win) => !win.url().includes('w=onboarding'))
          )
          .toBeTruthy()
        const page = application
          .windows()
          .find((win) => !win.url().includes('w=onboarding'))!
        await waitForEngineReady(page)
        await application.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()
            .find((win) => win.isVisible())
            ?.setContentSize(1280, 800)
        })
        for (const [route, name] of [
          ['/downloads/all', 'downloads'],
          ['/cloud', 'cloud'],
          ['/settings?section=general', 'settings-general'],
        ]) {
          await page.evaluate((value) => {
            location.hash = value
          }, route)
          await page.waitForTimeout(400)
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            language === 'ar' ? 'rtl' : 'ltr'
          )
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            )
          ).toBe(true)
          await page.screenshot({
            path: path.join(screenshots, `${name}-${language}.png`),
          })
        }
        if (language === 'zh-CN') {
          await page.evaluate(() => {
            location.hash = '/settings?section=about'
          })
          await expect(
            page.getByText('反馈问题', { exact: true }).first()
          ).toBeVisible()
          await page.screenshot({
            path: path.join(screenshots, 'feedback.png'),
          })
          await application.evaluate(({ shell }) => {
            shell.openExternal = async (url) => {
              ;(globalThis as unknown as { feedbackUrl: string }).feedbackUrl =
                url
            }
          })
          await page.evaluate(
            (command) => window.motrix?.invoke(command),
            Commands.NexusFeedback
          )
          const feedback = await application.evaluate(
            () => (globalThis as unknown as { feedbackUrl: string }).feedbackUrl
          )
          expect(feedback).toContain('/issues/new?')
          expect(feedback).toContain(NEXUS_VERSION)
          for (const advanced of await page
            .getByRole('button', { name: '高级', exact: true })
            .all())
            if ((await advanced.getAttribute('aria-expanded')) === 'false')
              await advanced.click()
          await page.getByRole('button', { name: '清除', exact: true }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await page.screenshot({
            path: path.join(screenshots, 'system-cleanup-confirm.png'),
          })
          await page.keyboard.press('Escape')
        }
        // A host setting change updates mounted UI without a restart.
        await page.evaluate(
          async ({ command, query }) => {
            await window.motrix?.invoke(command, { app: { language: 'en-US' } })
            return window.motrix?.invoke(query)
          },
          { command: Commands.UpdateSettings, query: Queries.GetSettings }
        )
        await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
      } finally {
        await application.close()
      }
    }
  })
