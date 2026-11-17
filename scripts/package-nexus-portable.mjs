import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const metadata = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8')
)
if (process.platform !== 'win32')
  throw new Error('Build the portable ZIP on Windows')
for (const args of [
  ['run', 'build'],
  ['run', 'stage:electron', '--', '--platform', 'win32', '--arch', 'x64'],
  [
    'exec',
    'electron-builder',
    '--win',
    '--x64',
    '--publish',
    'never',
    '--config.electronDist=node_modules/electron/dist',
  ],
]) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const directory = path.join(root, 'release')
const filename = `NexusDownload-v${metadata.version}-win-x64.zip`
const archive = path.join(directory, filename)
const hash = createHash('sha256')
for await (const bytes of createReadStream(archive)) hash.update(bytes)
await writeFile(`${archive}.sha256`, `${hash.digest('hex')}  ${filename}\n`)
for (const entry of await readdir(directory)) {
  if (entry === filename || entry === `${filename}.sha256`) continue
  const target = path.resolve(directory, entry)
  if (path.dirname(target) !== directory)
    throw new Error('Unexpected release path')
  await rm(target, { recursive: true, force: true })
}
console.log(`Created ${filename} and its .sha256 attachment`)
