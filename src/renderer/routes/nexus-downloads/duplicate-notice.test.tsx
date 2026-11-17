import '@test-utils/dom-animations'
import '@testing-library/jest-dom/vitest'
import { i18n } from '@renderer/lib/i18n'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { DuplicateNotice } from './duplicate-notice'

vi.mock('@renderer/lib/transport', () => ({
  transport: { invoke: vi.fn(async () => undefined) },
}))
it('Enter opens an existing completed file without creating another download', async () => {
  await i18n.changeLanguage('en-US')
  const download = vi.fn()
  render(
    <MemoryRouter>
      <DuplicateNotice
        duplicates={[{ taskId: 'existing', status: 'completed' }]}
        total={1}
        skip={false}
        onSkip={vi.fn()}
        onDownload={download}
        onClose={vi.fn()}
      />
    </MemoryRouter>
  )
  expect(screen.getByRole('button', { name: 'Open file' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(transport.invoke).toHaveBeenCalledWith(Commands.OpenTaskFile, {
    taskId: 'existing',
  })
  expect(download).not.toHaveBeenCalled()
})
