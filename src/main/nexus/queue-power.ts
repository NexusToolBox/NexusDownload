import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NexusQueue } from '@shared/schemas/nexus-workflow'
import { app, powerSaveBlocker, shell } from 'electron'
import { createSystemShutdown } from '../platform/system-shutdown'

const wakeScript = String.raw`param([long]$Due)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NexusWake {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr CreateWaitableTimer(IntPtr attributes,bool manual,string name);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetWaitableTimer(IntPtr timer,ref long due,int period,IntPtr routine,IntPtr argument,bool resume);
 [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,uint millis);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$timer=[NexusWake]::CreateWaitableTimer([IntPtr]::Zero,$true,$null)
try {
 $time=[DateTimeOffset]::FromUnixTimeMilliseconds($Due).UtcDateTime.ToFileTimeUtc()
 if(-not [NexusWake]::SetWaitableTimer($timer,[ref]$time,0,[IntPtr]::Zero,[IntPtr]::Zero,$true)){exit 2}
 [Console]::WriteLine('ready')
 [NexusWake]::WaitForSingleObject($timer,0xFFFFFFFF) | Out-Null
} finally { [NexusWake]::CloseHandle($timer) | Out-Null }
`
const sleepScript = String.raw`param([switch]$Hibernate)
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class NexusSleep {
 [DllImport("PowrProf.dll",SetLastError=true)] public static extern bool SetSuspendState(bool hibernate,bool force,bool disableWake);
}
'@
if(-not [NexusSleep]::SetSuspendState($Hibernate,$false,$false)){exit 2}
`
export class QueuePower {
  private timers = new Map<string, { at: number; child: ChildProcess }>()
  private blocker: number | null = null
  readonly status: Record<string, string> = {}
  constructor(
    private root: string,
    private changed: () => void
  ) {}
  private powershell() {
    return path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
  }
  setActive(active: boolean) {
    if (active && this.blocker === null)
      this.blocker = powerSaveBlocker.start('prevent-app-suspension')
    if (!active && this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker)
      this.blocker = null
    }
  }
  async wake(times: { id: string; at: number | null }[]) {
    const alive = new Set(times.map((t) => t.id))
    for (const [id, timer] of this.timers)
      if (!alive.has(id) || times.find((t) => t.id === id)?.at !== timer.at) {
        timer.child.kill()
        this.timers.delete(id)
        delete this.status[id]
      }
    for (const { id, at } of times) {
      if (!at || this.timers.has(id)) continue
      if (process.platform !== 'win32') {
        this.status[id] = 'workflow.wakeUnsupported'
        continue
      }
      await mkdir(this.root, { recursive: true })
      const file = path.join(this.root, 'wake.ps1')
      await writeFile(file, wakeScript)
      const child = spawn(
        this.powershell(),
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          file,
          '-Due',
          String(at),
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      )
      this.timers.set(id, { at, child })
      this.status[id] = 'workflow.wakePending'
      child.stdout?.once('data', () => {
        this.status[id] = 'workflow.wakeSet'
        this.changed()
      })
      child.once('error', () => {
        this.status[id] = 'workflow.wakeUnsupported'
        this.changed()
      })
      child.once('exit', (code) => {
        if (this.timers.get(id)?.child !== child) return
        this.timers.delete(id)
        this.status[id] =
          code === 0 ? 'workflow.wakeFired' : 'workflow.wakeUnsupported'
        this.changed()
      })
    }
    this.changed()
  }
  async execute(queue: NexusQueue) {
    if (queue.completion === 'shutdown')
      return createSystemShutdown().requestShutdown()
    if (queue.completion === 'exit') {
      app.quit()
      return
    }
    if (queue.completion === 'open') {
      if (!path.isAbsolute(queue.openFile)) throw new Error('workflow.invalid')
      const error = await shell.openPath(queue.openFile)
      if (error) throw new Error('workflow.actionFailed')
      return
    }
    if (['sleep', 'hibernate'].includes(queue.completion)) {
      await mkdir(this.root, { recursive: true })
      const file = path.join(this.root, 'sleep.ps1')
      await writeFile(file, sleepScript)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.powershell(),
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            file,
            ...(queue.completion === 'hibernate' ? ['-Hibernate'] : []),
          ],
          { windowsHide: true, stdio: 'ignore' }
        )
        child.once('error', reject)
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error('workflow.actionFailed'))
        )
      })
    }
  }
  dispose() {
    for (const timer of this.timers.values()) timer.child.kill()
    this.timers.clear()
    this.setActive(false)
  }
}
