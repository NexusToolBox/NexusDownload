import '@test-utils/dom-animations'
import '@testing-library/jest-dom/vitest'
import { i18n } from '@renderer/lib/i18n'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Queries } from '@shared/protocol/queries'
import { DEFAULT_NAT_SETTINGS, DEFAULT_PROXY_SETTINGS } from '@shared/schemas'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { NetworkDialog } from './network-dialog'

vi.mock('@renderer/lib/transport', () => ({
  transport: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), platform: 'win32' },
}))
vi.mock('@renderer/components/ui/toast', () => ({
  toast: { add: vi.fn(), close: vi.fn() },
}))
const fixture = {
  proxy: DEFAULT_PROXY_SETTINGS,
  nat: DEFAULT_NAT_SETTINGS,
  engine: { dnsMode: 'auto' },
}
beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.mocked(transport.invoke).mockReset()
  vi.mocked(transport.invoke).mockImplementation(async (channel) =>
    channel === Queries.GetSettings ? fixture : { saved: true }
  )
})
function show() {
  return render(<NetworkDialog open onClose={vi.fn()} labelKey="" descKey="" />)
}
it('saves manual proxy fields and hides them in system and off modes', async () => {
  show()
  const system = await screen.findByRole('button', { name: 'Follow system' })
  expect(system).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Manual' }))
  await user.type(screen.getByRole('textbox', { name: 'Server' }), 'localhost')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(transport.invoke).toHaveBeenCalledWith(
      Commands.UpdateSettings,
      expect.objectContaining({
        proxy: expect.objectContaining({
          mode: 'manual',
          enabled: true,
          host: 'localhost',
        }),
      })
    )
  )
  await user.click(screen.getByRole('button', { name: 'Off' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(transport.invoke).not.toHaveBeenCalledWith(Queries.GetSystemProxy)
})
it('preserves legacy manual settings and credentials when changing modes', async () => {
  vi.mocked(transport.invoke).mockImplementation(async (channel) =>
    channel === Queries.GetSettings
      ? {
          ...fixture,
          proxy: {
            ...fixture.proxy,
            mode: undefined,
            enabled: true,
            host: 'localhost',
            user: 'saved-user',
          },
        }
      : { saved: true }
  )
  show()
  expect(await screen.findByDisplayValue('saved-user')).toBeVisible()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Follow system' }))
  await user.click(screen.getByRole('button', { name: 'Manual' }))
  expect(screen.getByDisplayValue('saved-user')).toBeVisible()
})
it('saves the domestic override independently from manual proxy fields', async () => {
  show()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Advanced' }))
  await user.click(
    screen.getByRole('switch', {
      name: 'Use proxy for cloud drives and domestic platforms',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(transport.invoke).toHaveBeenCalledWith(Commands.UpdateSettings, {
      proxy: { domestic: true },
    })
  )
})
it('submits a DNS change and retains the full localized value', async () => {
  show()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Advanced' }))
  await user.click(screen.getByRole('combobox', { name: 'DNS lookup' }))
  await user.click(await screen.findByRole('option', { name: 'System DNS' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(transport.invoke).toHaveBeenCalledWith(Commands.UpdateSettings, {
      engine: { dnsMode: 'system' },
    })
  )
})
it('explains invalid manual servers and bypass entries', async () => {
  show()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Manual' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText(
      'Enter a server name or IP address, without http:// or a port.'
    )
  ).toBeVisible()
  await user.type(screen.getByRole('textbox', { name: 'Server' }), 'localhost')
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Connect directly to' }),
    { target: { value: 'x'.repeat(254) } }
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Use 253 characters or fewer.')).toBeVisible()
  expect(transport.invoke).not.toHaveBeenCalledWith(
    Commands.UpdateSettings,
    expect.anything()
  )
})
it('validates saved STUN entries when detection is enabled', async () => {
  vi.mocked(transport.invoke).mockImplementation(async (channel) =>
    channel === Queries.GetSettings
      ? {
          ...fixture,
          nat: {
            ...fixture.nat,
            natTypeDetectionEnabled: true,
            stunServers: ['stun.example.com:3478'],
          },
        }
      : { saved: true }
  )
  show()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Advanced' }))
  const input = await screen.findByDisplayValue('stun.example.com:3478')
  fireEvent.change(input, { target: { value: 'stun.example.com:99999' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/Use host:port, such as/)).toBeVisible()
  fireEvent.change(input, { target: { value: 'stun.example.com:19302' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(transport.invoke).toHaveBeenCalledWith(Commands.UpdateSettings, {
      nat: { stunServers: ['stun.example.com:19302'] },
    })
  )
})
