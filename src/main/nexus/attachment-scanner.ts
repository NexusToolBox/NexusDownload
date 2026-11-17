import { spawn } from 'node:child_process'
import path from 'node:path'

// The helper is isolated from renderer input; file paths are JSON on stdin, never script text.
const script = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("73db1241-1e85-4581-8e4f-a81e1d0f8c57"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAttachmentExecute {
 [PreserveSig] int SetClientTitle([MarshalAs(UnmanagedType.LPWStr)] string s);
 [PreserveSig] int SetClientGuid(ref Guid g);
 [PreserveSig] int SetLocalPath([MarshalAs(UnmanagedType.LPWStr)] string s);
 [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string s);
 [PreserveSig] int SetSource([MarshalAs(UnmanagedType.LPWStr)] string s);
 [PreserveSig] int SetReferrer([MarshalAs(UnmanagedType.LPWStr)] string s);
 [PreserveSig] int CheckPolicy();
 [PreserveSig] int Prompt(IntPtr h, int p, out int a);
 [PreserveSig] int Save();
 [PreserveSig] int Execute(IntPtr h, [MarshalAs(UnmanagedType.LPWStr)] string v, out IntPtr p);
 [PreserveSig] int SaveWithUI(IntPtr h);
 [PreserveSig] int ClearClientState();
}
public static class AttachmentScan {
 public static int Save(string path) {
  object obj = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("4125dd96-e03a-4103-8f70-e0597d803b9c")));
  try { var a=(IAttachmentExecute)obj;
   int hr=a.SetLocalPath(path); if(hr<0) return hr;
   hr=a.SetSource("https://github.com/NexusToolBox/NexusDownload/"); if(hr<0) return hr;
   return a.Save();
  } finally { Marshal.FinalReleaseComObject(obj); }
 }
}
"@
$files = [Console]::In.ReadToEnd() | ConvertFrom-Json
$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue)
if ($av.Count -eq 0) { [Console]::Out.Write('unavailable'); exit 0 }
foreach ($file in $files) {
 try { $hr=[AttachmentScan]::Save($file) }
 catch { $hr = -2147221164 }
 if ($hr -eq -2147221164 -or $hr -eq -2147467263 -or $hr -eq -2147467262) {
  $defender = Get-ChildItem -LiteralPath "$env:ProgramData\Microsoft\Windows Defender\Platform" -Filter MpCmdRun.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if (!$defender) { [Console]::Out.Write('unavailable'); exit 0 }
  & $defender.FullName -Scan -ScanType 3 -File $file -DisableRemediation *> $null
  if ($LASTEXITCODE -ne 0) { [Console]::Out.Write('blocked'); exit 0 }
  continue
 }
 if ($hr -lt 0) { [Console]::Out.Write('blocked'); exit 0 }
}
[Console]::Out.Write('scanned')
`
export async function scanAttachments(files: string[]): Promise<string> {
  if (process.platform !== 'win32') return 'processing.scannerUnavailable'
  const result = await new Promise<string>((resolve) => {
    const child = spawn(
      path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      if (output.length < 1024) output += String(chunk)
    })
    const timer = setTimeout(() => {
      child.kill()
      resolve('failed')
    }, 3600000)
    child.once('error', () => {
      clearTimeout(timer)
      resolve('failed')
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? output : 'failed')
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(JSON.stringify(files))
  })
  if (result === 'unavailable') return 'processing.scannerUnavailable'
  if (result !== 'scanned')
    throw new Error(
      result === 'blocked' ? 'processing.scanBlocked' : 'processing.scanFailed'
    )
  return ''
}
