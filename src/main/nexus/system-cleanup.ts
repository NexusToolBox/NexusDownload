import { execFile } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { APP_ID } from '@shared/constants'
import { app, shell } from 'electron'

const execute = promisify(execFile)

/** Remove only this product’s registrations; never clear another default handler. */
export async function clearSystemRemnants(): Promise<void> {
  if (process.platform !== 'win32') return
  const shortcut = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'NexusDownload.lnk'
  )
  try {
    if (shell.readShortcutLink(shortcut).target === process.execPath)
      await unlink(shortcut)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Electron reports an absent shortcut without an errno.
      const { existsSync } = await import('node:fs')
      if (existsSync(shortcut)) throw error
    }
  }
  app.setLoginItemSettings({ openAtLogin: false })
  for (const protocol of ['nexusdl', 'magnet']) {
    if (app.isDefaultProtocolClient(protocol))
      app.removeAsDefaultProtocolClient(protocol)
  }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
function Remove-OwnedChoice([string]$base) {
  if (!(Test-Path -LiteralPath $base)) { return }
  foreach ($suffix in @('UserChoice','UserChoiceLatest','UserChoiceLatest\ProgId')) {
    $key = Join-Path $base $suffix
    if (!(Test-Path -LiteralPath $key)) { continue }
    $value = Get-ItemProperty -LiteralPath $key
    if ($value.ProgId -like 'NexusDownload.*') { Remove-Item -LiteralPath $key -Recurse -Force }
  }
}
Remove-OwnedChoice 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.torrent'
Remove-OwnedChoice 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\magnet'
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    foreach ($key in @('Software\NexusDownload', 'Software\Classes\NexusDownload.File.Torrent', 'Software\Classes\NexusDownload.Url.Magnet', 'Software\Classes\AppUserModelId\__APP_ID__')) { $base.DeleteSubKeyTree($key, $false) }
    foreach ($pair in @(@('Software\RegisteredApplications','NexusDownload'), @('Software\Microsoft\Windows\CurrentVersion\Run','NexusDownload'))) {
      $key = $base.OpenSubKey($pair[0], $true)
      if ($key) { try { $key.DeleteValue($pair[1], $false) } finally { $key.Dispose() } }
    }
  } finally { $base.Dispose() }
}`.replace('__APP_ID__', APP_ID)
  await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, timeout: 15000 }
  )
}
