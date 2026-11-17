import '@testing-library/jest-dom/vitest'
import { useDirection } from '@renderer/components/ui/direction'
import { applyDocumentLocaleMetadata, i18n } from '@renderer/lib/i18n'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocaleDirectionProvider } from './locale-direction-provider'

function DirectionProbe() {
  const direction = useDirection()
  return <output data-testid="direction">{direction}</output>
}

describe('LocaleDirectionProvider', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it.each(['ar', 'fa'])(
    'synchronizes Base UI and document direction for %s and back to English',
    async (locale) => {
      render(
        <LocaleDirectionProvider>
          <DirectionProbe />
        </LocaleDirectionProvider>
      )
      expect(screen.getByTestId('direction')).toHaveTextContent('ltr')

      await act(async () => {
        await i18n.changeLanguage(locale)
        applyDocumentLocaleMetadata({ code: locale, dir: 'rtl' })
      })

      await waitFor(() =>
        expect(screen.getByTestId('direction')).toHaveTextContent('rtl')
      )
      expect(document.documentElement).toHaveAttribute('dir', 'rtl')
      await act(async () => {
        await i18n.changeLanguage('en-US')
        applyDocumentLocaleMetadata({ code: 'en-US', dir: 'ltr' })
      })
      await waitFor(() =>
        expect(screen.getByTestId('direction')).toHaveTextContent('ltr')
      )
      expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    }
  )
})
