import { readFile, writeFile } from 'node:fs/promises'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? ''))
  throw new Error('Use a stable x.y.z version')
const metadata = JSON.parse(await readFile('package.json', 'utf8'))
metadata.version = metadata.nexusVersion = version
await writeFile('package.json', `${JSON.stringify(metadata, null, 2)}\n`)
const versionFile = 'src/shared/nexus-version.ts'
await writeFile(
  versionFile,
  (await readFile(versionFile, 'utf8')).replace(
    /NEXUS_VERSION = '[^']*'/,
    `NEXUS_VERSION = '${version}'`
  )
)
for (const file of ['electron-builder.json', 'electron-builder.signing.json']) {
  const builder = await readFile(file, 'utf8')
  await writeFile(
    file,
    builder.replace(
      /("bundle(?:ShortVersion|Version)":\s*)"[^"]*"/g,
      `$1"${version}"`
    )
  )
}
const portableReadme = 'extra/nexus-portable/README.txt'
await writeFile(
  portableReadme,
  (await readFile(portableReadme, 'utf8')).replace(
    /NexusDownload \d+\.\d+\.\d+/g,
    `NexusDownload ${version}`
  )
)
await import('./sync-nexus-release.mjs')
