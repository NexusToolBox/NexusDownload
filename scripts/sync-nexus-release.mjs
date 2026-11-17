import { readFile, writeFile } from 'node:fs/promises'
import { NEXUS_RELEASE_CONFIG } from '../src/shared/nexus-release-config.ts'

const repository = `https://github.com/${NEXUS_RELEASE_CONFIG.repository}`
for (const filename of [
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'SECURITY.zh-CN.md',
  'CONTRIBUTING.md',
  'CONTRIBUTING.zh-CN.md',
  'CODE_OF_CONDUCT.md',
  'CODE_OF_CONDUCT.zh-CN.md',
]) {
  const text = await readFile(filename, 'utf8')
  await writeFile(
    filename,
    text.replace(
      /<!-- repository-links:start -->[\s\S]*?<!-- repository-links:end -->/g,
      `<!-- repository-links:start -->\n[releases]: ${repository}/releases\n[issues]: ${repository}/issues\n<!-- repository-links:end -->`
    )
  )
}
const metadata = JSON.parse(await readFile('package.json', 'utf8'))
metadata.homepage = NEXUS_RELEASE_CONFIG.website
await writeFile('package.json', `${JSON.stringify(metadata, null, 2)}\n`)
