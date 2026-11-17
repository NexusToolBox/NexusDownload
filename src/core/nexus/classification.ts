import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { AppError, ErrorCode } from '@shared/errors'
import type {
  NexusInboxEntry,
  NexusPreferences,
} from '@shared/schemas/nexus-workspace'

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}
async function existingParent(target: string): Promise<string> {
  let current = target
  for (;;) {
    try {
      if (!(await stat(current)).isDirectory())
        throw new Error('Not a directory')
      return await realpath(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const next = path.dirname(current)
      if (next === current) throw error
      current = next
    }
  }
}
export async function classifiedDirectory(
  root: string,
  entry: NexusInboxEntry,
  preferences: NexusPreferences
): Promise<string> {
  if (!path.isAbsolute(root) || root.includes('\0'))
    throw new AppError(ErrorCode.IpcInvalidPayload, 'nexus.invalidDirectory')
  if (!preferences.classificationEnabled) return path.resolve(root)
  const rule = preferences.rules.find(
    (rule) =>
      rule.enabled &&
      (rule.kind === 'type'
        ? rule.value === entry.fileType
        : rule.kind === 'platform'
          ? rule.value === entry.source.platform
          : rule.value.toLowerCase() === entry.source.host.toLowerCase())
  )
  if (!rule) return path.resolve(root)
  const target = path.resolve(root, rule.directory)
  if (!contained(path.resolve(root), target))
    throw new AppError(
      ErrorCode.IpcInvalidPayload,
      'nexus.invalidRuleDirectory'
    )
  // Resolve existing ancestors too: an in-root junction must not redirect a rule outside the root.
  const [realRoot, realTarget] = await Promise.all([
    existingParent(root),
    existingParent(target),
  ])
  if (!contained(realRoot, realTarget))
    throw new AppError(
      ErrorCode.IpcInvalidPayload,
      'nexus.invalidRuleDirectory'
    )
  return target
}
