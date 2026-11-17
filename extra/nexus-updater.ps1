param([Parameter(Mandatory=$true)][string]$Request, [ValidateSet('Supervise','Apply','Recover')][string]$Mode='Supervise')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$job = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($job.root).TrimEnd('\')
$data = Join-Path $root 'data'
$backup = Join-Path $root '.update-backup'
$stage = Join-Path ([IO.Path]::GetDirectoryName($Request)) 'stage'
$journal = Join-Path ([IO.Path]::GetDirectoryName($Request)) 'transaction.json'
$ack = Join-Path ([IO.Path]::GetDirectoryName($Request)) 'boot-ok.json'
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($job.exe)) -ne $root -or !(Test-Path -LiteralPath $data -PathType Container)) { throw 'Invalid portable root' }
function Assert-Child([string]$target,[string]$parent) {
  $absolute=[IO.Path]::GetFullPath($target)
  $prefix=[IO.Path]::GetFullPath($parent).TrimEnd('\')+'\'
  if (!$absolute.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes update directory' }
}
function Save-State($value) {
  $temporary=$journal+'.tmp'
  [IO.File]::WriteAllText($temporary,($value | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $journal -Force
}
function Program-Items([string]$directory) {
  @(Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -notin @('data','Downloads','.update-backup') })
}
function Clear-Program {
  foreach ($item in (Program-Items $root)) { Assert-Child $item.FullName $root; Remove-Item -LiteralPath $item.FullName -Recurse -Force }
}
function Restore-Old {
  $state=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
  if ($state.phase -eq 'backing-up') {
    Assert-Child $backup $root
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
  } elseif ($state.phase -in @('replacing','booting','rolling-back')) {
    $state.phase='rolling-back'; Save-State $state
    if (!(Test-Path -LiteralPath (Join-Path $backup ([IO.Path]::GetFileName($job.exe))))) { throw 'Backup incomplete' }
    Clear-Program
    foreach ($item in (Get-ChildItem -LiteralPath $backup -Force)) { Copy-Item -LiteralPath $item.FullName -Destination $root -Recurse -Force }
  }
  $state.phase='restored'; Save-State $state
  if (Test-Path -LiteralPath $backup) { Assert-Child $backup $root; Remove-Item -LiteralPath $backup -Recurse -Force }
  if (Test-Path -LiteralPath $stage) { Assert-Child $stage ([IO.Path]::GetDirectoryName($Request)); Remove-Item -LiteralPath $stage -Recurse -Force }
  $null=Start-Process -FilePath $job.exe -WorkingDirectory $root -WindowStyle Hidden -PassThru
}
function Wait-Parent {
  $parent=Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ($parent) { if (!$parent.WaitForExit(30000)) { throw 'Application did not exit' } }
}
if ($Mode -eq 'Apply') {
  Wait-Parent
  $stream=[IO.File]::OpenRead($job.zip)
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try { $digest=([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
  if ($digest -ne $job.sha256) { throw 'Checksum failed' }
  if (Test-Path -LiteralPath $stage) { Assert-Child $stage ([IO.Path]::GetDirectoryName($Request)); Remove-Item -LiteralPath $stage -Recurse -Force }
  $null=New-Item -ItemType Directory -Path $stage -Force
  $zip=[IO.Compression.ZipFile]::OpenRead($job.zip)
  try {
    $total=0L
    foreach ($entry in $zip.Entries) {
      $name=$entry.FullName.Replace('/','\')
      if ($name -match '(^[\\/]|:|(^|[\\/])\.\.([\\/]|$)|[. ]([\\/]|$)|(^|[\\/])(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|[\\/]|$))' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe archive entry' }
      if ($name -match '^(data|Downloads|\.update-backup)([\\/]|$)') { continue }
      $destination=Join-Path $stage $name
      Assert-Child $destination $stage
      $total += $entry.Length
      if ($total -gt 8GB) { throw 'Archive too large' }
      if ($name.EndsWith('\')) { $null=New-Item -ItemType Directory -Path $destination -Force; continue }
      $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$true)
    }
  } finally { $zip.Dispose() }
  if (!(Test-Path -LiteralPath (Join-Path $stage ([IO.Path]::GetFileName($job.exe)))) -or !(Test-Path -LiteralPath (Join-Path $stage 'resources\app.asar'))) { throw 'Incomplete release' }
  if (Test-Path -LiteralPath $backup) { throw 'Unresolved backup exists' }
  $state=[ordered]@{ phase='backing-up'; version=$job.version; previousVersion=$job.previousVersion; token=$job.token; releaseNotes=$job.releaseNotes }
  Save-State $state
  $null=New-Item -ItemType Directory -Path $backup
  foreach ($item in (Program-Items $root)) { Copy-Item -LiteralPath $item.FullName -Destination $backup -Recurse -Force }
  $state.phase='replacing'; Save-State $state
  # The executable is replaced last. The supervising process repairs a killed worker.
  foreach ($item in (Get-ChildItem -LiteralPath $stage -Force | Sort-Object @{Expression={if ($_.Name -eq [IO.Path]::GetFileName($job.exe)) {1} else {0}}})) {
    $target=Join-Path $root $item.Name; Assert-Child $target $root
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Copy-Item -LiteralPath $item.FullName -Destination $root -Recurse -Force
  }
  $state.phase='booting'; Save-State $state
  exit 0
}
if ($Mode -eq 'Recover') { Wait-Parent; Restore-Old; exit 0 }
try {
  $args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Request',('"'+$Request+'"'),'-Mode','Apply')
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=Join-Path $PSHOME 'powershell.exe'
  $info.Arguments=$args -join ' '
  $info.UseShellExecute=$false
  $info.CreateNoWindow=$true
  $info.RedirectStandardError=$true
  $worker=[Diagnostics.Process]::Start($info)
  [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetDirectoryName($Request)) 'worker.pid'),[string]$worker.Id)
  $workerError=$worker.StandardError.ReadToEndAsync()
  $worker.WaitForExit()
  if ($worker.ExitCode -ne 0) { throw 'Replacement worker stopped' }
  if (Test-Path -LiteralPath $ack) { Remove-Item -LiteralPath $ack -Force }
  $next=Start-Process -FilePath $job.exe -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  $healthy=$false
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $ack) {
      $receipt=Get-Content -LiteralPath $ack -Raw | ConvertFrom-Json
      if ($receipt.token -eq $job.token -and $receipt.version -eq $job.version) { $healthy=$true; break }
    }
    # The acknowledgement can arrive between the file check and process exit.
    if ($next.HasExited -and !(Test-Path -LiteralPath $ack)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (!$healthy) {
    if (!$next.HasExited) { Stop-Process -Id $next.Id -Force; $next.WaitForExit() }
    throw 'New application did not become ready'
  }
  $state=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
  $state.phase='completed'; Save-State $state
  # Only application files are removed. data and Downloads are never traversed.
  foreach ($item in (Program-Items $root)) {
    if (!(Test-Path -LiteralPath (Join-Path $stage $item.Name))) { Assert-Child $item.FullName $root; Remove-Item -LiteralPath $item.FullName -Recurse -Force }
  }
  Assert-Child $backup $root; Remove-Item -LiteralPath $backup -Recurse -Force
  Assert-Child $stage ([IO.Path]::GetDirectoryName($Request)); Remove-Item -LiteralPath $stage -Recurse -Force
  Remove-Item -LiteralPath $job.zip -Force
} catch {
  if (Test-Path -LiteralPath $journal) {
    $state=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
    if ($state.phase -in @('backing-up','replacing','booting','rolling-back')) { Restore-Old; exit 1 }
  }
  # Extraction or permission failure precedes any program mutation.
  $state=[ordered]@{ phase='restored'; version=$job.version; previousVersion=$job.previousVersion; token=$job.token; releaseNotes=$job.releaseNotes }
  Save-State $state
  $null=Start-Process -FilePath $job.exe -WorkingDirectory $root -WindowStyle Hidden -PassThru
  exit 1
}
