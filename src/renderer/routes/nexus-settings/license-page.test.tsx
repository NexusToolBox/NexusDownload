import '@test-utils/dom-animations'
import '@testing-library/jest-dom/vitest'
import { transport } from '@renderer/lib/transport'
import { Queries } from '@shared/protocol/queries'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { LicensePage } from './license-page'

vi.mock('@renderer/lib/transport', () => ({ transport: { invoke: vi.fn() } }))
it('opens full license text and returns through the other-components list', async () => {
  vi.mocked(transport.invoke).mockResolvedValue(
    [...['Motrix', 'YunX Desktop', 'OpenList', 'aria2'], 'React 19.3.1'].map(
      (name) => ({ name, license: 'MIT', text: `Full terms for ${name}` })
    )
  )
  render(
    <MemoryRouter initialEntries={['/settings?section=about&licenses=main']}>
      <LicensePage />
    </MemoryRouter>
  )
  await screen.findByRole('button', { name: 'Motrix' })
  expect(transport.invoke).toHaveBeenCalledWith(Queries.GetNexusLicenses)
  expect(
    screen.getByText('NexusDownload is open source under AGPL-3.0')
  ).toBeVisible()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Motrix' }))
  expect(screen.getByText('Full terms for Motrix').tagName).toBe('PRE')
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await user.click(screen.getByRole('button', { name: '1 other components' }))
  await user.click(screen.getByRole('button', { name: 'React 19.3.1' }))
  expect(screen.getByText('Full terms for React 19.3.1')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('button', { name: 'React 19.3.1' })).toBeVisible()
})
