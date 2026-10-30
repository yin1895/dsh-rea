<#
.SYNOPSIS
  Deploy the dsh-rea plugin into one or more DSH profiles.

.DESCRIPTION
  Copies D:\REA-tool\plugin\dsh-rea into <profile>\node_modules\dsh-rea and makes
  sure "dsh-rea" is listed in that profile's dsh.profile.bundles.

  Copy, never junction/symlink: a later `pnpm install` inside a profile can follow
  a link and delete the plugin source tree (this really happened once on this
  machine). Copying keeps the profile self-contained and the source safe.

  Restart DSH afterwards for the plugin to be picked up.

.EXAMPLE
  D:\REA-tool\bin\rea-deploy-plugin.ps1
  D:\REA-tool\bin\rea-deploy-plugin.ps1 -Profile desktop,headless
#>
[CmdletBinding()]
param(
  [string[]]$Profile = @('desktop', 'headless'),
  [string]$ReaToolHome = 'D:\REA-tool',
  [string]$DshHome = "$env:USERPROFILE\.dsh"
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $ReaToolHome 'plugin\dsh-rea'
if (-not (Test-Path $source)) { throw "plugin source not found: $source" }

# Directories that must never be deployed (dev-only vendor copy, build leftovers).
$excludeDirs = @('vendor', 'node_modules', '.git', '.cache')

foreach ($name in $Profile) {
  $profileDir = Join-Path $DshHome "profiles\$name"
  if (-not (Test-Path $profileDir)) { Write-Warning "skip ${name}: no such profile ($profileDir)"; continue }
  $target = Join-Path $profileDir 'node_modules\dsh-rea'

  # Remove a previous junction safely (rmdir drops the link, never the target).
  if ((Get-Item $target -Force -ErrorAction SilentlyContinue).LinkType) {
    cmd /c rmdir "$target" | Out-Null
  }

  $robo = @($source, $target, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') + $excludeDirs
  & robocopy @robo | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for ${name} (exit $LASTEXITCODE)" }

  $manifestPath = Join-Path $profileDir 'package.json'
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($null -eq $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $manifest.dsh.profile.bundles) { $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
  if (@($manifest.dsh.profile.bundles) -notcontains 'dsh-rea') {
    $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + 'dsh-rea'
    ($manifest | ConvertTo-Json -Depth 10) | Set-Content -Path $manifestPath -Encoding UTF8
    Write-Host "bundles: added dsh-rea to $name"
  } else {
    Write-Host "bundles: dsh-rea already listed for $name"
  }
  $files = (Get-ChildItem $target -Recurse -File | Measure-Object).Count
  Write-Host "deployed $name -> $target ($files files)"
}
Write-Host 'Restart DSH to load the plugin.'