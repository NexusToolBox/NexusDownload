import { spawn } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// The guardian runs outside the job it owns. Every descendant of the desktop
// process inherits the job, including detached tools and Electron utilities.
// Closing its last handle kills the job even if the desktop crashes.
const guardianSource = String.raw`
$ErrorActionPreference = 'Stop'
$stage='compile'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexusJob {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
 [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr p, uint s);
 [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
 [DllImport("kernel32.dll")] public static extern bool QueryInformationJobObject(IntPtr j, int c, IntPtr p, uint s, IntPtr r);
 public static IntPtr Create() {
   var j=CreateJobObject(IntPtr.Zero,null);
   var p=Marshal.AllocHGlobal(144);
   for(int i=0;i<144;i++) Marshal.WriteByte(p,i,0);
   Marshal.WriteInt32(p,16,0x2000);
   bool ok=SetInformationJobObject(j,9,p,144);
   Marshal.FreeHGlobal(p);
   if(!ok) { CloseHandle(j); throw new Exception("job-configuration"); }
   return j;
 }
 public static int[] Members(IntPtr j) {
   const int size=131080;
   var p=Marshal.AllocHGlobal(size);
   try {
     if(!QueryInformationJobObject(j,3,p,size,IntPtr.Zero)) return new int[0];
     int count=Math.Min(Marshal.ReadInt32(p,4),16384);
     var ids=new int[count];
     for(int i=0;i<count;i++) ids[i]=(int)Marshal.ReadInt64(p,8+i*8);
     return ids;
   } finally { Marshal.FreeHGlobal(p); }
 }
}
'@
function SameProcess($entry) {
 try {
   $p=[System.Diagnostics.Process]::GetProcessById([int]$entry.id)
   if($p.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.started -and $p.MainModule.FileName -eq $entry.file) { return $p }
 } catch {}
 return $null
}
$ownerId=[int]$env:NEXUS_GUARD_OWNER
$registry=$env:NEXUS_GUARD_REGISTRY
$shutdown=$env:NEXUS_GUARD_SHUTDOWN
$updateRequest=$env:NEXUS_GUARD_UPDATE
if(Test-Path -LiteralPath $registry) {
 try {
   $old=Get-Content -LiteralPath $registry -Raw | ConvertFrom-Json
   if(-not (SameProcess $old.owner)) {
     foreach($entry in $old.children) {
       $stale=SameProcess $entry
       if($stale) { try { $stale.Kill() } catch {} }
     }
   }
 } catch {}
}
$stage='owner'
$owner=[System.Diagnostics.Process]::GetProcessById($ownerId)
$ownerEntry=@{id=$ownerId;started=$owner.StartTime.ToUniversalTime().Ticks.ToString();file=$owner.MainModule.FileName}
$stage='job'
$job=[NexusJob]::Create()
$stage='assignment'
if(-not [NexusJob]::AssignProcessToJobObject($job,$owner.Handle)) {
 [NexusJob]::CloseHandle($job) | Out-Null
 throw 'job-assignment'
}
$shutdownTimer=$null
try {
 [System.IO.File]::WriteAllText($env:NEXUS_GUARD_READY,'')
 do {
   if([System.IO.File]::Exists($shutdown)) {
     if($null -eq $shutdownTimer) { $shutdownTimer=[System.Diagnostics.Stopwatch]::StartNew() }
     if($shutdownTimer.ElapsedMilliseconds -ge 5000) { break }
   }
   $children=@(foreach($id in [NexusJob]::Members($job)) {
     if($id -eq $ownerId) { continue }
     try { $p=[System.Diagnostics.Process]::GetProcessById($id); @{id=$id;started=$p.StartTime.ToUniversalTime().Ticks.ToString();file=$p.MainModule.FileName} } catch {}
   })
   try {
     $temporary=$registry+'.tmp'
     @{owner=$ownerEntry;children=$children} | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
     Move-Item -LiteralPath $temporary -Destination $registry -Force
   } catch {}
 } while([NexusJob]::WaitForSingleObject($owner.Handle,500) -eq 258)
} finally {
 [NexusJob]::CloseHandle($job) | Out-Null
 # The updater starts after the owned job closes, so shutdown cannot kill it.
 if(Test-Path -LiteralPath $updateRequest) {
   try {
     $update=Get-Content -LiteralPath $updateRequest -Raw | ConvertFrom-Json
     $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$update.script+'"'),'-Request',('"'+$update.request+'"'),'-Mode',$update.mode)
     Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
     Remove-Item -LiteralPath $updateRequest -Force
   } catch {}
 }
 try { Remove-Item -LiteralPath $shutdown -Force -ErrorAction SilentlyContinue } catch {}
 try {
   $current=Get-Content -LiteralPath $registry -Raw | ConvertFrom-Json
   if($current.owner.id -eq $ownerId -and $current.owner.started -eq $ownerEntry.started) {
     Remove-Item -LiteralPath $registry -Force -ErrorAction SilentlyContinue
   }
 } catch {}
}
} catch {
 try { [System.IO.File]::WriteAllText($env:NEXUS_GUARD_ERROR,$stage) } catch {}
}
`

export interface ProcessGuardian {
  scheduleUpdate(
    script: string,
    request: string,
    mode?: 'Supervise' | 'Recover'
  ): void
  beginShutdown(): void
}

export function startProcessGuardian(
  directory: string
): Promise<ProcessGuardian | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  const root = process.env.SystemRoot || 'C:\\Windows'
  const shutdownSignal = path.join(directory, `shutdown-${process.pid}.signal`)
  const updateSignal = path.join(directory, `update-${process.pid}.json`)
  const readySignal = path.join(directory, `ready-${process.pid}.signal`)
  const errorSignal = path.join(directory, `guard-error-${process.pid}.signal`)
  rmSync(updateSignal, { force: true })
  rmSync(shutdownSignal, { force: true })
  rmSync(readySignal, { force: true })
  rmSync(errorSignal, { force: true })
  return new Promise((resolve, reject) => {
    // CreateNoWindow gives the guardian its own console lifetime. A direct
    // PowerShell child can disappear with its owner before reaching finally;
    // Node's detached flag also makes Windows PowerShell exit before execution.
    // A readiness file avoids retaining or closing its standard-output pipe.
    const guardian = spawn(
      path.join(
        root,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(
          String.raw`
$start=New-Object System.Diagnostics.ProcessStartInfo
$start.FileName=Join-Path $PSHOME 'powershell.exe'
$start.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+$env:NEXUS_GUARD_SOURCE
$start.UseShellExecute=$false
$start.CreateNoWindow=$true
[System.Diagnostics.Process]::Start($start) | Out-Null
`,
          'utf16le'
        ).toString('base64'),
      ],
      {
        cwd: root,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          NEXUS_GUARD_OWNER: String(process.pid),
          NEXUS_GUARD_REGISTRY: path.join(directory, 'owned-processes.json'),
          NEXUS_GUARD_SHUTDOWN: shutdownSignal,
          NEXUS_GUARD_UPDATE: updateSignal,
          NEXUS_GUARD_READY: readySignal,
          NEXUS_GUARD_ERROR: errorSignal,
          NEXUS_GUARD_SOURCE: Buffer.from(guardianSource, 'utf16le').toString(
            'base64'
          ),
        },
      }
    )
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(readiness)
      rmSync(readySignal, { force: true })
      rmSync(errorSignal, { force: true })
      guardian.unref()
      if (error) reject(error)
      else {
        let shuttingDown = false
        resolve({
          scheduleUpdate(script, request, mode = 'Supervise') {
            writeFileSync(
              `${updateSignal}.tmp`,
              JSON.stringify({ script, request, mode })
            )
            renameSync(`${updateSignal}.tmp`, updateSignal)
          },
          beginShutdown() {
            if (shuttingDown) return
            // A file keeps no pipe alive and remains observable when the
            // owner's event loop is blocked during native Electron teardown.
            writeFileSync(shutdownSignal, '')
            shuttingDown = true
          },
        })
      }
    }
    const timer = setTimeout(() => {
      guardian.kill()
      finish(new Error('process guardian startup timed out'))
    }, 15000)
    const readiness = setInterval(() => {
      if (existsSync(readySignal)) finish()
      else if (existsSync(errorSignal)) {
        const stage = readFileSync(errorSignal, 'utf8')
        finish(
          new Error(
            `process guardian failed at ${/^(compile|owner|job|assignment)$/.test(stage) ? stage : 'startup'}`
          )
        )
      }
    }, 25)
    guardian.once('error', () =>
      finish(new Error('process guardian could not start'))
    )
    guardian.once('exit', (code) => {
      if (code !== 0)
        finish(new Error('process guardian could not own the process tree'))
    })
  })
}
