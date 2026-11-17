import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { relocateJobRecord } from './portable-jobs'

it('moves registered local paths without changing request secrets or external destinations', () => {
  const opaque = randomBytes(32).toString('hex')
  const moved = JSON.parse(
    relocateJobRecord(
      'media-recovery',
      JSON.stringify([
        {
          job: {
            saveDir: 'D:\\Old\\Downloads',
            headers: { Cookie: opaque },
            video: { url: 'https://example.org/video' },
          },
          paths: {
            tmpDir: 'D:\\Old\\data\\pieces',
            mediaMetaPath: 'D:\\Old\\data\\meta.json',
          },
        },
      ]),
      ['D:\\Old'],
      'E:\\New'
    )
  )[0]
  expect(moved.job.saveDir).toBe('E:\\New\\Downloads')
  expect(moved.paths.tmpDir).toBe('E:\\New\\data\\pieces')
  expect(moved.job.headers.Cookie === opaque).toBe(true)
  expect(moved.job.video.url).toBe('https://example.org/video')
  expect(
    JSON.parse(
      relocateJobRecord(
        'remote-jobs',
        '[{"adapter":"node","source":"https://example.org/file","directory":"F:\\\\Outside","key":"old"}]',
        ['D:\\Old'],
        'E:\\New'
      )
    )[0].directory
  ).toBe('F:\\Outside')
})
it('is idempotent across an interrupted migration and another move', () => {
  const original = JSON.stringify([
    {
      directory: 'D:\\Old\\Downloads',
      files: ['D:\\Old\\Downloads\\a'],
      source: 'D:\\Old\\opaque',
    },
  ])
  const once = relocateJobRecord(
    'external-jobs',
    original,
    ['D:\\Old'],
    'E:\\New'
  )
  expect(
    relocateJobRecord('external-jobs', once, ['D:\\Old', 'E:\\New'], 'E:\\New')
  ).toBe(once)
  const next = JSON.parse(
    relocateJobRecord('external-jobs', once, ['E:\\New'], 'F:\\Last')
  )[0]
  expect(next.files).toEqual(['F:\\Last\\Downloads\\a'])
  expect(next.source).toBe('D:\\Old\\opaque')
})
