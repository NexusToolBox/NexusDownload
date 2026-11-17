import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileSha256 } from '@core/nexus/tools/file-sha256'
import { expect, it } from 'vitest'
import type { PortableProfile } from '../platform/portable-profile'
import {
  acknowledgePortableUpdate,
  isPortableUpdateDirectory,
} from './portable-updater'

const run = promisify(execFile)
const shell = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe'
)
const csc = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
)
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

it('recognizes the exact update directory across Windows path aliases', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-update-path-'))
  const directory = path.join(root, 'data/updates')
  try {
    await mkdir(directory, { recursive: true })
    const profile = {
      root,
      dataDir: path.join(root, 'data'),
    } as PortableProfile
    expect(isPortableUpdateDirectory(profile, directory)).toBe(true)
    expect(
      isPortableUpdateDirectory(profile, path.join(directory, '..', 'updates'))
    ).toBe(true)
    expect(
      isPortableUpdateDirectory(profile, path.join(root, 'data/updates-other'))
    ).toBe(false)
    expect(
      isPortableUpdateDirectory(profile, path.join(root, 'Downloads'))
    ).toBe(false)
    expect(isPortableUpdateDirectory(null, directory)).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function poll<T>(
  fn: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 20000
) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await fn()
    if (accept(value)) return value
    await delay(10)
  }
  throw new Error('Updater did not reach the expected state')
}

it
  .skipIf(process.platform !== 'win32')
  .each(['success', 'startup-failure', 'killed-worker'])(
  'transactional helper preserves task and account data: %s',
  async (scenario) => {
    const base = await mkdtemp(path.join(tmpdir(), 'nexus-transaction-'))
    const root = path.join(base, 'portable'),
      source = path.join(base, 'new')
    const updates = path.join(root, 'data/updates'),
      zip = path.join(updates, 'release.zip')
    let supervisor: ChildProcess | undefined
    try {
      await mkdir(updates, { recursive: true })
      await mkdir(path.join(root, 'resources'))
      await mkdir(path.join(source, 'resources'), { recursive: true })
      await mkdir(path.join(source, 'data'))
      await writeFile(path.join(root, 'data/tasks.db'), 'retained-tasks')
      await writeFile(path.join(root, 'data/accounts.bin'), 'retained-accounts')
      await writeFile(
        path.join(source, 'data/tasks.db'),
        'must-never-replace-data'
      )
      await writeFile(path.join(root, 'resources/app.asar'), 'old-program')
      await writeFile(path.join(source, 'resources/app.asar'), 'new-program')
      const cs = path.join(base, 'fixture.cs')
      const program = (behavior: string) =>
        `using System; using System.IO; using System.Reflection; using System.Text.RegularExpressions; class App { static void Main() { string root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location); ${behavior} } }`
      await writeFile(
        cs,
        program('File.WriteAllText(Path.Combine(root,"old-started.txt"),"ok");')
      )
      await run(
        csc,
        [
          '/nologo',
          '/target:winexe',
          `/out:${path.join(root, 'NexusDownload.exe')}`,
          cs,
        ],
        { windowsHide: true }
      )
      // The fixture copies only the readiness token; the production app checks its own version.
      const body =
        scenario === 'startup-failure'
          ? 'Environment.Exit(1);'
          : String.raw`string dir=Path.Combine(root,"data","updates"); string state=File.ReadAllText(Path.Combine(dir,"transaction.json")); string token=Regex.Match(state,@"""token""\s*:\s*""([^""]+)").Groups[1].Value; File.WriteAllText(Path.Combine(dir,"boot-ok.json"),"{\"token\":\""+token+"\",\"version\":\"1.3.1\"}");`
      await writeFile(cs, program(body))
      await run(
        csc,
        [
          '/nologo',
          '/target:winexe',
          `/out:${path.join(source, 'NexusDownload.exe')}`,
          cs,
        ],
        { windowsHide: true }
      )
      if (scenario === 'killed-worker') {
        for (let i = 0; i < 1200; i++)
          await writeFile(
            path.join(source, 'resources', `fixture-${i}.txt`),
            'new'
          )
      }
      await run(
        shell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(source)},${quote(zip)})`,
        ],
        { windowsHide: true }
      )
      const token = randomUUID()
      const request = path.join(updates, 'request.json')
      await writeFile(
        request,
        JSON.stringify({
          root,
          exe: path.join(root, 'NexusDownload.exe'),
          zip,
          sha256: await fileSha256(zip),
          version: '1.3.1',
          previousVersion: '1.3.0',
          token,
          parentPid: 2147483647,
          releaseNotes: 'Changes',
        })
      )
      supervisor = spawn(
        shell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('extra/nexus-updater.ps1'),
          '-Request',
          request,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const exited = once(supervisor, 'exit')
      let stderr = ''
      supervisor.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      if (scenario === 'killed-worker') {
        const childPid = await poll(
          async () =>
            Number(
              await readFile(path.join(updates, 'worker.pid'), 'utf8').catch(
                () => '0'
              )
            ),
          (value) => value > 0
        )
        await poll(
          async () =>
            JSON.parse(
              await readFile(
                path.join(updates, 'transaction.json'),
                'utf8'
              ).catch(() => '{}')
            ).phase,
          (value) => value === 'replacing'
        )
        process.kill(childPid)
      }
      await Promise.race([
        exited,
        delay(30000).then(() => {
          throw new Error(`Updater timeout: ${stderr}`)
        }),
      ])
      const state = JSON.parse(
        await readFile(path.join(updates, 'transaction.json'), 'utf8')
      )
      expect(state.phase, stderr).toBe(
        scenario === 'success' ? 'completed' : 'restored'
      )
      expect(await readFile(path.join(root, 'data/tasks.db'), 'utf8')).toBe(
        'retained-tasks'
      )
      expect(await readFile(path.join(root, 'data/accounts.bin'), 'utf8')).toBe(
        'retained-accounts'
      )
      expect(
        await readFile(path.join(root, 'resources/app.asar'), 'utf8')
      ).toBe(scenario === 'success' ? 'new-program' : 'old-program')
      await expect(
        readFile(path.join(root, '.update-backup/resources/app.asar'))
      ).rejects.toThrow()
      if (scenario !== 'success')
        await poll(
          () =>
            readFile(path.join(root, 'old-started.txt'), 'utf8').catch(
              () => ''
            ),
          (value) => value === 'ok'
        )
      const profile = {
        root,
        dataDir: path.join(root, 'data'),
      } as PortableProfile
      expect(
        await acknowledgePortableUpdate(
          profile,
          scenario === 'success' ? '1.3.1' : '1.3.0'
        )
      ).toBeDefined()
      expect(
        await acknowledgePortableUpdate(
          profile,
          scenario === 'success' ? '1.3.1' : '1.3.0'
        )
      ).toBeUndefined()
    } finally {
      if (supervisor?.exitCode === null) supervisor.kill()
      await delay(300)
      await rm(base, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      })
    }
  },
  60000
)
