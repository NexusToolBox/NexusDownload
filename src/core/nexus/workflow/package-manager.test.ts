import { expect, it } from 'vitest'
import { volumeKey } from './package-manager'

it('groups recognized volume names without merging unrelated files', () => {
  expect(volumeKey('movie.part01.rar')).toEqual({ key: 'movie.rar', index: 1 })
  expect(volumeKey('movie.7z.003')).toEqual({ key: 'movie.7z', index: 3 })
  expect(volumeKey('notes.001.txt')).toBe(null)
  expect(volumeKey('movie.r00')?.index).toBe(2)
})
