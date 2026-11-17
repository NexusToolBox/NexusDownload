import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'win32')(
  'launches the scheduled updater after the owned job has closed',
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'nexus-guardian-update-')
    )
    try {
      const script = path.join(directory, 'updater.ps1')
      const result = path.join(directory, 'survived.json')
      const request = path.join(directory, 'request.json')
      await writeFile(request, JSON.stringify({ result }))
      await writeFile(
        script,
        `param([string]$Request,[string]$Mode)\nStart-Sleep -Milliseconds 1200\n$job=Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json\n[IO.File]::WriteAllText($job.result,'true')`
      )
      const source = `import {startProcessGuardian} from ${JSON.stringify(new URL('./process-guardian.ts', import.meta.url).href)}; const guardian=await startProcessGuardian(${JSON.stringify(directory)}); guardian.scheduleUpdate(${JSON.stringify(script)},${JSON.stringify(request)}); guardian.beginShutdown();`
      const owner = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', source],
        {
          cwd: fileURLToPath(new URL('../../..', import.meta.url)),
          windowsHide: true,
          stdio: 'ignore',
        }
      )
      await new Promise<void>((resolve, reject) => {
        owner.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error('owner failed'))
        )
        owner.once('error', reject)
      })
      await expect
        .poll(async () => await readFile(result, 'utf8').catch(() => ''), {
          timeout: 15000,
        })
        .toBe('true')
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      })
    }
  },
  20000
)

it.skipIf(process.platform !== 'win32').each([
  {
    name: 'kills descendants after an abrupt owner exit',
    finish: 'setTimeout(()=>process.exit(42),600)',
    expectedCode: 42,
  },
  {
    name: 'allows the owner to exit naturally without retained guardian pipes',
    finish: '',
    expectedCode: 0,
  },
  {
    name: 'ends a blocked owner and its descendants within the external shutdown deadline',
    finish:
      'guardian.beginShutdown();guardian.beginShutdown();Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)',
  },
])(
  '$name',
  async ({ finish, expectedCode }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-owned-test-'))
    const moduleUrl = new URL('./process-guardian.ts', import.meta.url).href
    const source = `import {startProcessGuardian} from ${JSON.stringify(moduleUrl)}; import {spawn} from 'node:child_process'; const guardian=await startProcessGuardian(${JSON.stringify(directory)}); const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120'],{windowsHide:true,stdio:'ignore'}); console.log(child.pid);child.unref();${finish}`
    let ownedPid = 0
    let owner: ChildProcess | undefined
    try {
      owner = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', source],
        {
          cwd: fileURLToPath(new URL('../../..', import.meta.url)),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )
      owner.stdout?.on('data', (chunk) => {
        ownedPid = Number(String(chunk).trim())
      })
      const started = Date.now()
      const code = await new Promise<number | null>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error('owner did not exit within 12 seconds')),
          12000
        )
        owner?.once('error', (error) => {
          clearTimeout(deadline)
          reject(error)
        })
        owner?.once('exit', (exitCode) => {
          clearTimeout(deadline)
          resolve(exitCode)
        })
      })
      if (expectedCode !== undefined) expect(code).toBe(expectedCode)
      expect(Date.now() - started).toBeLessThan(10000)
      expect(ownedPid).toBeGreaterThan(0)
      await expect
        .poll(
          () => {
            try {
              process.kill(ownedPid, 0)
              return true
            } catch {
              return false
            }
          },
          { timeout: 8000 }
        )
        .toBe(false)
    } finally {
      if (owner?.exitCode === null) owner.kill()
      if (ownedPid) {
        try {
          process.kill(ownedPid)
        } catch {}
      }
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      })
    }
  },
  20000
)
