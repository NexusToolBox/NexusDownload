import '@test-utils/dom-animations'
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
import { ReleaseNotes } from './release-notes'
import {
  NexusUpdateDialog,
  NexusUpdatePill,
  openUpdateDialog,
} from './update-ui'

vi.mock('@renderer/lib/transport', () => ({
  transport: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), platform: 'win32' },
}))
const available: AppUpdateState = {
  currentVersion: '1.5.2',
  phase: 'available',
  availableVersion: '1.5.3',
  releaseUrl:
    'https://github.com/NexusToolBox/NexusDownload/releases/tag/v1.5.3',
  releaseNotes:
    '## 改进\n- 更快的更新\n\n---\n\n## Improvements\n- **Faster** updates\n## Fixes\n- Safer restart',
}
beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  localStorage.clear()
  vi.mocked(transport.invoke).mockReset()
  vi.mocked(transport.on).mockReset()
  vi.mocked(transport.invoke).mockImplementation(async (channel) =>
    channel === Queries.GetUpdateState
      ? available
      : { disclaimerAccepted: true }
  )
})
function emit(state: AppUpdateState) {
  act(() => {
    for (const [channel, listener] of vi.mocked(transport.on).mock.calls)
      if (channel === Events.UpdateStateChanged) listener(state)
  })
}
it('renders the selected language as semantic Markdown without executing HTML', async () => {
  const text = `${available.releaseNotes}\n<script>alert(1)</script>`
  const view = render(<ReleaseNotes text={text} />)
  expect(screen.getByRole('heading', { name: 'Improvements' })).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('Faster').closest('strong')).not.toBeNull()
  expect(view.container.querySelector('script')).toBeNull()
  await act(async () => i18n.changeLanguage('zh-TW'))
  expect(screen.getByRole('heading', { name: '改进' })).toBeVisible()
  expect(screen.queryByText('Improvements')).not.toBeInTheDocument()
})
it('keeps one dialog through connection, progress, background and ready states', async () => {
  render(
    <>
      <NexusUpdateDialog />
      <NexusUpdatePill />
    </>
  )
  await waitFor(() => expect(transport.on).toHaveBeenCalled())
  act(() => openUpdateDialog())
  const user = userEvent.setup()
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Update' })
  )
  expect(transport.invoke).toHaveBeenCalledWith(Commands.DownloadUpdate)
  emit({
    ...available,
    phase: 'downloading',
    progress: { transferred: 0, percent: 0, total: 100, bytesPerSecond: 0 },
  })
  expect(
    within(screen.getByRole('dialog')).getByRole('status')
  ).toHaveTextContent('Connecting')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  emit({
    ...available,
    phase: 'downloading',
    browserFallback: true,
    progress: { transferred: 10, percent: 10, total: 100, bytesPerSecond: 10 },
  })
  await user.click(screen.getByRole('button', { name: 'Download in browser' }))
  expect(transport.invoke).toHaveBeenCalledWith(
    Commands.OpenExternal,
    available.releaseUrl
  )
  await user.click(
    screen.getByRole('button', { name: 'Continue in background' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await user.click(screen.getByRole('button', { name: /10%/ }))
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10')
  emit({ ...available, phase: 'downloaded' })
  expect(screen.getByRole('dialog')).toHaveTextContent('Download complete')
})
it('waits for consent and a visible unoccupied window, then prompts only once per version', async () => {
  let consent = false
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.mocked(transport.invoke).mockImplementation(async (channel) =>
    channel === Queries.GetUpdateState
      ? { ...available, automatic: true }
      : { disclaimerAccepted: consent }
  )
  const view = render(
    <>
      <div role="dialog" aria-label="Busy" />
      <NexusUpdateDialog />
    </>
  )
  await waitFor(() => expect(transport.on).toHaveBeenCalled())
  expect(
    screen.queryByRole('heading', { name: 'NexusDownload 1.5.3' })
  ).not.toBeInTheDocument()
  view.rerender(<NexusUpdateDialog />)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  consent = true
  await screen.findByRole('dialog', {}, { timeout: 2500 })
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(transport.invoke).toHaveBeenCalledWith(Commands.NexusUpdateAction, {
    action: 'mark-prompted',
  })
  view.unmount()
  render(<NexusUpdateDialog />)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  vi.restoreAllMocks()
})
it('shows completion only on request and retains the installed release notes', async () => {
  vi.mocked(transport.invoke).mockResolvedValue({
    ...available,
    phase: 'up-to-date',
    completedVersion: '1.5.2',
    completedReleaseNotes: '## Installed\n- Installed notes',
  })
  render(
    <>
      <NexusUpdateDialog />
      <NexusUpdatePill />
    </>
  )
  const pill = await screen.findByRole('button', { name: 'Updated to 1.5.2' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(pill)
  expect(screen.getByRole('dialog')).toHaveTextContent('Installed notes')
  expect(
    within(screen.getByRole('dialog')).getAllByRole('button')
  ).toHaveLength(2)
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'OK' })
  ).toBeVisible()
})
