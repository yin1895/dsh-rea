# D:\REA-tool\bin\rea.ps1 - run the D:\REA-tool REA CLI with every engine configured.
# Usage:  D:\REA-tool\bin\rea.ps1 doctor --format json
#         D:\REA-tool\bin\rea.ps1 capabilities
#         D:\REA-tool\bin\rea.ps1 open
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

. "$PSScriptRoot\..\config\rea.env.ps1" -Quiet
& $script:ReaEnv.node $script:ReaEnv.launcher @Arguments
exit $LASTEXITCODE
