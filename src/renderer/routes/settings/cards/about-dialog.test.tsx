import '@test-utils/dom-animations'
import '@renderer/lib/i18n'
import '@testing-library/jest-dom/vitest'
import { i18n } from '@renderer/lib/i18n'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import type { AppUpdateState } from '@shared/types/app-update'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { NexusAbout } from '../../nexus-settings/about-page'

vi.mock('@renderer/lib/transport', () => ({
  transport: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), platform: 'win32' },
}))
const idle: AppUpdateState = {
  phase: 'idle',
  currentVersion: '1.3.0',
  updateAuthority: 'application',
}
beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.mocked(transport.invoke).mockReset()
  vi.mocked(transport.on).mockReset()
  vi.mocked(transport.off).mockReset()
  vi.mocked(transport.invoke).mockImplementation(async (channel) =>
    channel === Queries.GetUpdateState ? idle : undefined
  )
})
function emit(state: AppUpdateState) {
  for (const [channel, listener] of vi.mocked(transport.on).mock.calls)
    if (channel === Events.UpdateStateChanged) listener(state)
}
it('checks in the about page and opens release notes without a browser', async () => {
  render(<NexusAbout />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '检查' }))
  expect(transport.invoke).toHaveBeenCalledWith(Commands.CheckForUpdates)
  act(() =>
    emit({
      ...idle,
      phase: 'available',
      availableVersion: '1.3.1',
      releaseNotes: '## Changes\n- Better updates',
    })
  )
  await user.click(screen.getByRole('button', { name: '更新' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '更新内容' }))
  expect(screen.getByText(/Better updates/)).toBeVisible()
  expect(transport.invoke).toHaveBeenCalledWith(Commands.DownloadUpdate)
  expect(transport.invoke).not.toHaveBeenCalledWith(
    Commands.OpenExternal,
    expect.anything()
  )
})
it('explains active tasks before handing off a restart', async () => {
  vi.mocked(transport.invoke).mockResolvedValue({
    ...idle,
    phase: 'downloaded',
    availableVersion: '1.3.1',
    activeTasks: ['movie.mp4'],
  })
  render(<NexusAbout />)
  const user = userEvent.setup()
  await user.click((await screen.findAllByRole('button', { name: '重启' }))[0])
  expect(screen.getByRole('dialog')).toHaveTextContent('会暂停 1 个下载')
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '重启',
    })
  )
  expect(transport.invoke).toHaveBeenCalledWith(Commands.InstallUpdate)
})
it('does not overwrite a newer event with a late initial snapshot and unsubscribes', async () => {
  let resolve: (state: AppUpdateState) => void = () => {}
  vi.mocked(transport.invoke).mockImplementation(
    () =>
      new Promise<AppUpdateState>((done) => {
        resolve = done
      })
  )
  const view = render(<NexusAbout />)
  act(() => emit({ ...idle, phase: 'available', availableVersion: '1.3.1' }))
  await act(async () => resolve({ ...idle, phase: 'up-to-date' }))
  expect(screen.getByRole('button', { name: '更新' })).toBeVisible()
  view.unmount()
  expect(transport.off).toHaveBeenCalledWith(
    Events.UpdateStateChanged,
    expect.any(Function)
  )
})
it('renders a manual connection failure inline', async () => {
  render(<NexusAbout />)
  await waitFor(() => expect(transport.on).toHaveBeenCalled())
  act(() =>
    emit({ ...idle, phase: 'error', error: { message: 'update.github' } })
  )
  expect(screen.getByText('无法检查更新')).toBeVisible()
})
