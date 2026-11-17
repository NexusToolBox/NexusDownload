import '@testing-library/jest-dom/vitest'
import {
  getLocaleDirection,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
} from '@shared/constants/locales'
import { describe, expect, it } from 'vitest'
import { applyRendererLocale, i18n } from './i18n'

describe('NexusDownload language', () => {
  it('keeps intentionally removed descriptions empty', async () => {
    await applyRendererLocale('zh-CN')
    expect(i18n.t('nexus.v11.localDefault')).toBe('')
    expect(i18n.t('nexus.remote.nodeHelp')).toBe('')
  })
  it.each([...SUPPORTED_LOCALES.map(({ code }) => code), 'not-a-locale', null])(
    'loads the selected bundled language %s',
    async (code) => {
      const expected = resolveSupportedLocale(code, navigator.language)
      await expect(applyRendererLocale(code)).resolves.toBe(expected)
      expect(i18n.resolvedLanguage).toBe(expected)
      expect(document.documentElement).toHaveAttribute('lang', expected)
      expect(document.documentElement).toHaveAttribute(
        'dir',
        getLocaleDirection(expected)
      )
    }
  )
})
