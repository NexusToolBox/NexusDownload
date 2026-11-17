import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import {
  cacheAvatar,
  parseProfile,
  readAvatar,
  removeAvatar,
} from './account-profile'

it('tries candidate fields, prefers the largest 115 image, and records names without values', () => {
  const profile = parseProfile(
    [
      {
        data: {
          nickname: '',
          avatarUri: '',
          avatar_url: 'https://avatar.example/image.png',
          privateField: 'never-retained',
        },
      },
      { data: { nickname: 'Test User' } },
    ],
    ['data.nickname'],
    ['data.avatarUri', 'data.avatar_url']
  )
  expect(profile.nickname).toBe('Test User')
  expect(profile.avatar).toBe('https://avatar.example/image.png')
  expect(profile.fields).toContain('data.privateField')
  expect(JSON.stringify(profile.fields)).not.toContain('never-retained')
  expect(
    parseProfile(
      [
        {
          data: {
            face: {
              '32': 'https://avatar.example/32',
              '128': 'https://avatar.example/128',
            },
          },
        },
      ],
      [],
      ['data.face']
    ).avatar
  ).toBe('https://avatar.example/128')
  expect(
    parseProfile([{ avatar: 'javascript:alert(1)' }], [], ['avatar']).avatar
  ).toBe('')
})

it('caches validated bytes, supports offline reads and confines logout deletion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-avatar-'))
  try {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const request = async () => new Response(bytes)
    const file = await cacheAvatar(
      root,
      'account-test',
      'https://avatar.example/image',
      request as typeof fetch
    )
    expect(await readAvatar(root, file)).toMatch(/^data:image\/png;base64,/)
    expect(await readAvatar(path.join(root, 'elsewhere'), file)).toBeUndefined()
    await removeAvatar(path.join(root, 'elsewhere'), file)
    expect(await readFile(file as string)).toEqual(bytes)
    await removeAvatar(root, file)
    expect(await readAvatar(root, file)).toBeUndefined()
    expect(
      await cacheAvatar(
        root,
        'account-test',
        'https://avatar.example/image',
        (async () => new Response('<svg/>')) as typeof fetch
      )
    ).toBeUndefined()
    await expect(
      cacheAvatar(
        root,
        '../escape',
        'https://avatar.example/image',
        request as typeof fetch
      )
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
