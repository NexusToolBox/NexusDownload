import '@test-utils/dom-animations'
import '@renderer/lib/i18n'
import '@testing-library/jest-dom/vitest'
import { i18n } from '@renderer/lib/i18n'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DisclaimerStep } from './disclaimer-step'

vi.mock('@renderer/lib/transport', () => ({
  transport: {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    platform: 'darwin',
  },
}))

describe('DisclaimerStep', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(transport.invoke).mockResolvedValue(undefined)
    await i18n.changeLanguage('en-US')
  })

  it('persists acceptance and blocks duplicate actions while saving', async () => {
    let resolveAcceptance!: () => void
    vi.mocked(transport.invoke).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveAcceptance = resolve
      })
    )
    render(<DisclaimerStep />)

    const agree = screen.getByTestId('disclaimer-agree')
    const quit = screen.getByTestId('disclaimer-quit')
    fireEvent.click(agree)
    await waitFor(() => {
      expect(agree).toBeDisabled()
      expect(quit).toBeDisabled()
    })

    fireEvent.click(agree)
    fireEvent.click(quit)
    expect(transport.invoke).toHaveBeenCalledTimes(1)
    expect(transport.invoke).toHaveBeenCalledWith(Commands.AcceptDisclaimer)

    resolveAcceptance()
    await waitFor(() => expect(agree).not.toBeDisabled())
  })

  it('declines the disclaimer through its dedicated command', () => {
    render(<DisclaimerStep />)
    fireEvent.click(screen.getByTestId('disclaimer-quit'))
    expect(transport.invoke).toHaveBeenCalledWith(Commands.DeclineDisclaimer)
  })

  it('shows an inline persistence error and supports retry', async () => {
    const invoke = vi.mocked(transport.invoke)
    invoke.mockRejectedValueOnce(new Error('disk full'))
    render(<DisclaimerStep />)

    fireEvent.click(screen.getByTestId('disclaimer-agree'))
    expect(await screen.findByTestId('disclaimer-error')).toBeVisible()
    expect(screen.getByTestId('disclaimer-agree')).toHaveTextContent(
      'Agree and continue'
    )

    invoke.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByTestId('disclaimer-agree'))
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  })

  it('opens the issue tracker before consent without starting downloads', () => {
    render(<DisclaimerStep />)
    fireEvent.click(screen.getByRole('button', { name: 'GitHub Issues' }))
    expect(transport.invoke).toHaveBeenCalledWith(Commands.OpenDisclaimerIssues)
  })
})
