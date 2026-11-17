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

describe('Nexus translations', () => {
  it.each(SUPPORTED_LOCALES.map((item) => item.code))(
    '%s has current keys and translated product copy',
    (locale) => {
      const values = catalog(locale)
      expect(Object.keys(values).sort()).toEqual(Object.keys(chinese).sort())
      if (locale === 'en-US') return
      const copied = Object.keys(values).filter(
        (key) =>
          values[key] && !invariant.test(key) && values[key] === english[key]
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
