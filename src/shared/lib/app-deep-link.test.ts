import { describe, expect, it } from 'vitest'
import { MAX_APP_DEEP_LINK_BYTES } from '../schemas/app-deep-link'
import { parseAppDeepLink } from './app-deep-link'

describe('parseAppDeepLink', () => {
  it.each([
    ['task-list', '/downloads/active'],
    ['task-list?status=all', '/downloads/all'],
    ['task-list?status=completed', '/downloads/completed'],
    ['task-list?status=error', '/downloads/error'],
    ['downloads', '/downloads/all'],
    ['downloads/', '/downloads/all'],
    ['downloads/active/', '/downloads/active'],
    ['downloads/completed', '/downloads/completed'],
    ['downloads/error', '/downloads/error'],
    ['preferences', '/settings'],
    ['settings', '/settings'],
    ['about', '/settings/about'],
    ['TASK-LIST/', '/downloads/active'],
  ])('maps %s to an allowed destination', (command, route) => {
    expect(parseAppDeepLink(`NEXUSDL://${command}`)).toEqual({
      kind: 'navigate',
      route,
    })
  })

  it.each([
    ['waiting', '/downloads/active', 'waitingMerged'],
    ['stopped', '/downloads/all', 'stoppedSplit'],
    ['unknown', '/downloads/all', 'invalidStatus'],
  ])('explains the legacy %s classification', (status, route, notice) => {
    expect(parseAppDeepLink(`nexusdl://task-list?status=${status}`)).toEqual({
      kind: 'navigate',
      route,
      notice,
    })
  })

  it('supports empty drafts and bare activation', () => {
    expect(parseAppDeepLink('nexusdl://')).toEqual({ kind: 'show' })
    expect(parseAppDeepLink('nexusdl://new-task')).toEqual({
      kind: 'draft',
      mode: 'links',
    })
    expect(parseAppDeepLink('nexusdl://new-bt-task/')).toEqual({
      kind: 'draft',
      mode: 'torrent',
    })
  })

  it.each([
    'https://example.com/file%20name.zip?token=a%2Bb&part=1#fragment',
    'ftp://example.com/file.zip',
    `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=hello%20world`,
  ])('decodes the wrapper exactly once: %s', (url) => {
    expect(
      parseAppDeepLink(`nexusdl://new-task?uri=${encodeURIComponent(url)}`)
    ).toEqual({ kind: 'draft', mode: 'links', url })
  })

  it.each([
    '',
    'file:///tmp/a',
    'https://user:password@example.com/a',
    'https://a/\nhttps://b/',
    'magnet:?xt=urn:btih:bad',
    'curl https://example.com/a',
  ])('rejects invalid draft sources', (uri) => {
    expect(
      parseAppDeepLink(`nexusdl://new-task?uri=${encodeURIComponent(uri)}`)
    ).toEqual({ kind: 'rejected', notice: 'invalidSource' })
  })

  it.each([
    'silent',
    'dir',
    'out',
    'allProxy',
    'split',
    'cookie',
    'authorization',
    'userAgent',
    'referer',
    'torrent',
    'selectFile',
    'path',
    'gid',
    'type',
    'unknown',
  ])('rejects the whole request with unsupported parameter %s', (key) => {
    expect(
      parseAppDeepLink(
        `nexusdl://new-task?uri=https%3A%2F%2Fexample.com%2Fa&${key}=1`
      )
    ).toEqual({ kind: 'rejected', notice: 'unsupportedParameters' })
  })

  it.each([
    'pause-all-task',
    'resume-all-task',
    'reveal-in-folder?path=%2Ftmp%2Fa',
  ])('retires mutating command %s', (command) => {
    expect(parseAppDeepLink(`nexusdl://${command}`)).toEqual({
      kind: 'rejected',
      notice: 'deprecatedCommand',
    })
  })

  it.each(['mo://task-list', 'MO://new-task?silent=1', 'mo:'])(
    'never executes the retired scheme %s',
    (url) => {
      expect(parseAppDeepLink(url)).toEqual({
        kind: 'rejected',
        notice: 'deprecatedScheme',
      })
    }
  )

  it('preserves encoded task IDs and plugin navigation', () => {
    const id = '任务/一?#&%'
    expect(
      parseAppDeepLink(`nexusdl://tasks/${encodeURIComponent(id)}`)
    ).toEqual({ kind: 'task', id })
    expect(parseAppDeepLink('nexusdl://plugins/example.plugin')).toEqual({
      kind: 'plugin',
      id: 'example.plugin',
    })
    expect(
      parseAppDeepLink('nexusdl://plugins/example.plugin?install=true')
    ).toEqual({ kind: 'rejected', notice: 'unsupportedParameters' })
  })

  it.each([
    'nexusdl://user@task-list',
    'nexusdl://task-list:80',
    'nexusdl://task-list#',
    'nexusdl://task-list?status=all&status=active',
    'nexusdl://task-list?status=%E0%A4%A',
    'nexusdl://task-list?status=%',
    'nexusdl://downloads/../settings',
    'nexusdl://downloads/%2e%2e/settings',
    'nexusdl://downloads//active',
    'nexusdl://downloads!active',
    'nexusdl://downloads:active',
    'nexusdl://new-task/extra',
    'nexusdl://tasks/',
    'nexusdl://tasks/..',
    'nexusdl://tasks/a/b',
    'nexusdl://tasks/%00',
    'nexusdl://plugins/Upper.Case',
    'nexusdl://plugins/../example.plugin',
    'nexusdl://task-list\n',
    'nexusdl:task-list',
    `nexusdl://tasks/${'a'.repeat(1025)}`,
    `nexusdl://new-task?uri=${'a'.repeat(MAX_APP_DEEP_LINK_BYTES)}`,
  ])('rejects malformed links without normalization: %s', (url) => {
    expect(parseAppDeepLink(url)).toEqual({
      kind: 'rejected',
      notice: 'invalidLink',
    })
  })

  it('reports unknown commands', () => {
    expect(parseAppDeepLink('nexusdl://arbitrary')).toEqual({
      kind: 'rejected',
      notice: 'unsupportedCommand',
    })
  })
})
