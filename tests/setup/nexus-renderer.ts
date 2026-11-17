import { i18n } from '@renderer/lib/i18n'
import { SUPPORTED_LOCALE_CODES } from '@shared/constants/locales'
import { loadI18nLocale } from '@shared/i18n-resources'
import { beforeEach } from 'vitest'

// Exercise retained upstream translations without shipping them in the desktop.
await Promise.all(
  SUPPORTED_LOCALE_CODES.map(async (locale) => {
    i18n.addResourceBundle(locale, 'translation', await loadI18nLocale(locale))
  })
)
beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

import './text-editor'
