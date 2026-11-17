param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetRoot = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $targetRoot) { throw 'The export destination must be a new directory.' }
if ($targetRoot.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose an export destination outside the source checkout.'
}
$excluded = '^(output/|design/final/compare/|dist/|release/|\.claude/|\.codex/|\.agents/|\.github/pr-assets/|scripts/p0/|AGENTS\.md$|CLAUDE(?:\.local)?\.md$|docs/(?:stage-report-|p0-|platform-status|Replenish\.md|acceptance\.zh-CN\.md|native-messaging-todo\.md|plugin-hook-runtime-plan|relay-performance|nexus-patches\.md))'
$files = & git -C $sourceRoot -c core.quotepath=false ls-files
if ($LASTEXITCODE -ne 0) { throw 'Cannot read source files.' }
New-Item -ItemType Directory -Path $targetRoot | Out-Null
foreach ($relative in $files) {
    if ($relative -match $excluded) { continue }
    $sourceFile = Join-Path $sourceRoot $relative
    if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
    $targetFile = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
    if (!$targetFile.StartsWith($targetRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Invalid export path.'
    }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($targetFile)) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $targetFile
}
& git -C $targetRoot init --initial-branch=main --quiet
if ($LASTEXITCODE -ne 0) { throw 'Cannot initialize the public repository.' }
$publicGuidance = @'
# Development conventions

This public checkout is the sole development directory. Make all subsequent
changes here and push reviewed commits to this repository. Never replace this
checkout with another export.

- NexusDownload is a portable Windows download manager built with Electron,
  React, TypeScript and aria2. Use pnpm and the checked-in lockfile.
- Keep core modules host-neutral. The renderer uses shared transport contracts;
  shared modules contain pure types, schemas and data without IO.
- Put product core modules in `src/core/nexus/` and routes in
  `src/renderer/routes/nexus-*/`. Use protocol constants and semantic icons.
- Follow `design/final/DESIGN.md`, including its concise wording rules.
  Translate user-facing copy in all 26 catalogs and preserve placeholders.
- Never log or commit credentials, signed download URLs or private account data.
- Do not modify `website/` unless the task explicitly includes it.
- Before every commit run `pnpm run check:boundaries`, `pnpm run lint`,
  `pnpm exec tsc --noEmit` and relevant tests. Locale changes also require
  `pnpm run check:i18n`; new files require `pnpm run check:file-names`.
- Inspect staged changes and run `git diff --cached --check` before committing.
- Use Chinese commit messages. Keep generated screenshots and test output ignored.
- Publish matching version tags through the release workflow. Verify downloaded
  release checksums and portable startup. Retain only the latest local package
  and remove temporary extracted applications after testing.
'@
[IO.File]::WriteAllText((Join-Path $targetRoot 'AGENTS.md'), $publicGuidance + "`n", [Text.UTF8Encoding]::new($false))
& git -C $targetRoot add --all
if ($LASTEXITCODE -ne 0) { throw 'Cannot stage the exported files.' }
& git -C $targetRoot -c user.name=NexusDownload -c user.email=opensource@users.noreply.github.com commit --quiet -m 'NexusDownload 1.5.0'
if ($LASTEXITCODE -ne 0) { throw 'Cannot commit the public export.' }
Write-Output "Public source exported to $targetRoot"
