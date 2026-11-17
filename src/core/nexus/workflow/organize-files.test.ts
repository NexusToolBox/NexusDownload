import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProcessingRecord } from '@shared/schemas/nexus-processing'
import { nexusPreferencesSchema } from '@shared/schemas/nexus-workspace'
import { expect, it } from 'vitest'
import { organizeFiles } from './organize-files'

it('recovers partial classification without duplicating, losing, or replacing files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-organize-'))
  try {
    const files = ['one.txt', 'two.txt'].map((name) => path.join(root, name))
    await Promise.all(files.map((file, i) => writeFile(file, `payload ${i}`)))
    const moves: ProcessingRecord['moves'] = []
    const preferences = nexusPreferencesSchema.parse({})
    let checkpoints = 0
    await expect(
      organizeFiles(files, root, preferences, undefined, moves, async () => {
        if (++checkpoints === 3) throw new Error('interrupted persistence')
      })
    ).rejects.toThrow('interrupted persistence')
    const outputs = await organizeFiles(
      files,
      root,
      preferences,
      undefined,
      moves
    )
    expect(
      await Promise.all(outputs.map((file) => readFile(file, 'utf8')))
    ).toEqual(['payload 0', 'payload 1'])
    for (const source of files)
      await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      await organizeFiles(files, root, preferences, undefined, moves)
    ).toEqual(outputs)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
