import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ArchiveService } from '../src/core/nexus/workflow/archive-service.ts'

const root = path.resolve('../.nexus-v1-fixtures/rar-fixture')
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const run = promisify(execFile),
  password = randomBytes(18).toString('hex'),
  content = randomBytes(150000)
await writeFile(path.join(root, 'local.bin'), content)
await run(
  path.resolve('../.nexus-v1-fixtures/rar/Rar.exe'),
  ['a', '-idq', `-hp${password}`, '-v64k', 'sample.rar', 'local.bin'],
  { cwd: root, windowsHide: true }
)
const files = (await readdir(root))
  .filter((n) => n.endsWith('.rar'))
  .map((n) => path.join(root, n))
assert.ok(files.length > 1)
const service = new ArchiveService({
  tools: {
    using: async (_ids, fn) => fn(),
    executable: async () =>
      path.resolve('../.nexus-v1-fixtures/tools/bin/7zip/26.06/7z.exe'),
  },
  reserve: () => 0,
  trash: async () => {
    throw new Error('Original archives must remain')
  },
})
await assert.rejects(service.extract(files, root, []))
const last = files.at(-1)
await rename(last, `${last}.missing`)
try {
  await assert.rejects(service.extract(files.slice(0, -1), root, [password]))
} finally {
  await rename(`${last}.missing`, last)
}
const extracted = await service.extract(files, root, [password])
assert.equal(extracted.files.length, 1)
assert.deepEqual(await readFile(extracted.files[0]), content)
for (const f of files) assert.ok((await readFile(f)).length > 0)
await writeFile(
  'output/v1-rar-live.json',
  JSON.stringify(
    {
      selfCreatedRar5: true,
      encryptedMultipart: true,
      missingVolumeBlocked: true,
      missingPasswordBlocked: true,
      contentIdentical: true,
      originalsRetained: true,
    },
    null,
    2
  ) + '\n'
)
await rm(root, { recursive: true, force: true })
console.log(
  'Self-created encrypted multipart RAR: password, missing volume, content and retention passed.'
)
