import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { ProcessingRecord } from '@shared/schemas/nexus-processing'
import type {
  NexusInboxEntry,
  NexusPreferences,
} from '@shared/schemas/nexus-workspace'
import { classifiedDirectory } from '../classification'
import { classifyFilename } from '../source-recognizer'
export async function organizeFiles(
  files: string[],
  root: string,
  preferences: NexusPreferences,
  source?: NexusInboxEntry['source'],
  moves: ProcessingRecord['moves'] = [],
  checkpoint: () => Promise<void> = async () => undefined
): Promise<string[]> {
  const outputs: string[] = []
  for (const file of files) {
    let move = moves.find((m) => m.source === file)
    if (!move) {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('processing.verify')
      const entry = {
        fileType: classifyFilename(file),
        source: source ?? { platform: 'other', host: '' },
      } as NexusInboxEntry
      const targetDir = await classifiedDirectory(root, entry, preferences)
      if (path.resolve(targetDir) === path.resolve(path.dirname(file))) {
        outputs.push(file)
        continue
      }
      await mkdir(targetDir, { recursive: true })
      let target = path.join(targetDir, path.basename(file))
      if (await lstat(target).catch(() => null))
        target = path.join(
          targetDir,
          `${path.parse(file).name}-${randomUUID()}${path.extname(file)}`
        )
      move = { source: file, target, linked: false }
      moves.push(move)
      await checkpoint()
    }
    const [original, target] = await Promise.all([
      lstat(file).catch(() => null),
      lstat(move.target).catch(() => null),
    ])
    if (!move.linked) {
      if (!original?.isFile() || original.isSymbolicLink())
        throw new Error('processing.verify')
      if (target) {
        if (
          !target.isFile() ||
          target.isSymbolicLink() ||
          target.ino !== original.ino ||
          target.dev !== original.dev
        )
          throw new Error('processing.verify')
      } else await link(file, move.target)
      move.linked = true
      await checkpoint()
    } else if (!target?.isFile() || target.isSymbolicLink())
      throw new Error('processing.verify')
    if (original) await unlink(file)
    outputs.push(move.target)
  }
  return outputs
}
