import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { CloudError } from './cloud-adapter'

export function safeCloudName(name: string): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/:<>"|?*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new CloudError('path')
  return name
}
/** Reject reparse points rather than resolving a remote filename outside the chosen root. */
export async function prepareCloudDirectory(
  root: string,
  components: string[]
) {
  if (!path.isAbsolute(root)) throw new CloudError('path')
  const absolute = path.resolve(root)
  // Check every existing ancestor, including the user-selected root.
  let current = path.parse(absolute).root
  for (const component of path
    .relative(current, absolute)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component)
    const info = await lstat(current).catch(() => null)
    if (info && (info.isSymbolicLink() || !info.isDirectory()))
      throw new CloudError('path')
    if (!info) await mkdir(current)
  }
  const canonical = await realpath(absolute)
  current = canonical
  for (const component of components) {
    current = path.join(current, safeCloudName(component))
    const info = await lstat(current).catch(() => null)
    if (info && (info.isSymbolicLink() || !info.isDirectory()))
      throw new CloudError('path')
    if (!info) await mkdir(current)
  }
  if (
    path
      .relative(canonical, await realpath(current))
      .split(path.sep)
      .includes('..')
  )
    throw new CloudError('path')
  return current
}
