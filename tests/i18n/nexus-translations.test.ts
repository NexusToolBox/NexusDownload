import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../../src/shared/constants/locales'

function flatten(
  value: Record<string, unknown>,
  prefix = ''
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      typeof child === 'string'
        ? [[prefix + key, child]]
        : Object.entries(
            flatten(child as Record<string, unknown>, `${prefix}${key}.`)
          )
    )
  )
}

function catalog(locale: string) {
  return flatten(
    JSON.parse(
      readFileSync(
        new URL(`../../src/shared/locales/${locale}.json`, import.meta.url),
        'utf8'
      )
    ).nexus
  )
}

const chinese = catalog('zh-CN')
const english = catalog('en-US')
// Invariant brand names, format identifiers, punctuation and pure substitutions.
const invariant =
  /^(?:platform\.(?:115|123|baidu|quark|uc|aliyun)|services\.debrid|settings\.sections\.bittorrent|settings\.typeDescription\.|v11\.quality\.(?:16|32|64|80|120|125|126|127)$|v12\.connector\.id$|v12\.completedBody$|v13\.update\.title$|v15\.notice\.feedbackSuffix$)/

// These words are also idiomatic native UI labels; spelling equality is not fallback.
const sharedSpellings: Record<string, string[]> = {
  ca: ['settings.sections.general', 'v152.proxy.manual'],
  de: [
    'nav.downloads',
    'stage.download',
    'settings.sections.downloads',
    'v152.ok',
  ],
  es: ['settings.sections.general', 'v152.proxy.manual'],
  fr: ['nav.services', 'v152.ok'],
  id: ['v152.proxy.manual', 'v152.ok'],
  it: ['stage.download', 'v152.ok'],
  ja: ['v152.ok'],
  nb: ['v152.ok'],
  nl: [
    'nav.downloads',
    'stage.download',
    'settings.sections.downloads',
    'v152.later',
    'v152.ok',
  ],
  pl: ['v152.ok'],
  'pt-BR': [
    'nav.downloads',
    'stage.download',
    'settings.sections.downloads',
    'v152.proxy.manual',
    'v152.ok',
  ],
  ro: ['settings.sections.general', 'v152.proxy.manual', 'v152.ok'],
  vi: ['v152.ok'],
}

describe('Nexus translations', () => {
  it.each(SUPPORTED_LOCALES.map((item) => item.code))(
    '%s has current keys and translated product copy',
    (locale) => {
      const values = catalog(locale)
      expect(Object.keys(values).sort()).toEqual(Object.keys(chinese).sort())
      if (locale === 'en-US') return
      const copied = Object.keys(values).filter(
        (key) =>
          values[key] &&
          !invariant.test(key) &&
          !sharedSpellings[locale]?.includes(key) &&
          values[key] === english[key]
      )
      expect(copied).toEqual([])
    }
  )

  it('uses Traditional Chinese characters', () => {
    expect(Object.values(catalog('zh-TW')).join('')).not.toMatch(
      /[软盘账号载设删动开关闭显时这为与从网页传输夹认协议频风险权仅个学获数据问馈应续]/
    )
  })
})
