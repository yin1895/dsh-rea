# D:\REA-tool\bin\rea-set-user-env.ps1
# Publish the REA engine variables as USER-level environment variables, so any
# agent that launches REA (Cursor, Codex, VS Code, OpenCode, Kimi, ...) inherits
# a fully configured toolchain without editing each client's config file.
#
# User-scope values win over machine-scope values with the same name on Windows,
# which is what lets these pointed paths replace older machine-wide settings.
# Run once:  powershell -ExecutionPolicy Bypass -File D:\REA-tool\bin\rea-set-user-env.ps1
# Undo:      remove the names listed below from HKCU:\Environment (or run with -Remove)

param([switch]$Remove, [switch]$WhatIfOnly)

$cfg = Get-Content 'D:\REA-tool\config\rea.env.json' -Raw | ConvertFrom-Json

$names = @($cfg.variables.PSObject.Properties.Name) + @('REA_TOOL_HOME', 'REA_MCP_LAUNCHER', 'REA_MCP_NODE')
$names = $names | Where-Object { $_ -notlike 'DOTNET_*' }

if ($Remove) {
    foreach ($n in $names) {
        [System.Environment]::SetEnvironmentVariable($n, $null, 'User')
        "removed $n"
    }
    return
}

$pairs = [ordered]@{}
foreach ($p in $cfg.variables.PSObject.Properties) {
    if ($p.Name -like 'DOTNET_*') { continue }
    $pairs[$p.Name] = [string]$p.Value
}
$pairs['REA_TOOL_HOME'] = $cfg.home
$pairs['REA_MCP_LAUNCHER'] = $cfg.launcher
$pairs['REA_MCP_NODE'] = $cfg.node

foreach ($k in $pairs.Keys) {
    if ($WhatIfOnly) { "would set $k = $($pairs[$k])"; continue }
    [System.Environment]::SetEnvironmentVariable($k, $pairs[$k], 'User')
    "set $k = $($pairs[$k])"
}
