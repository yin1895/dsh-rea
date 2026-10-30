# D:\REA-tool\bin\rea-selftest.ps1
# End-to-end probe of every configured engine, using the staged samples in
# D:\REA-tool\samples. Each step writes raw JSON to D:\REA-tool\logs\e2e-*.json
# and prints a one-line verdict, so a cold host can be validated in one run.
#
#   pwsh -File D:\REA-tool\bin\rea-selftest.ps1
#   pwsh -File D:\REA-tool\bin\rea-selftest.ps1 -SkipHeavy   (skip Ghidra + APK decodes)

param([switch]$SkipHeavy)

$ErrorActionPreference = 'Continue'
. 'D:\REA-tool\config\rea.env.ps1' -Quiet
$node = $script:ReaEnv.node
$launcher = $script:ReaEnv.launcher
$samples = 'D:\REA-tool\samples'
$logs = 'D:\REA-tool\logs'

function Invoke-ReaStep {
    param([string]$Name, [string[]]$Arguments, [int]$TimeoutSec = 900)

    $out = Join-Path $logs ("e2e-" + $Name + ".json")
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    # The child speaks UTF-8. Windows PowerShell otherwise decodes its stdout with
    # the console code page (CP936 here), which both mojibakes non-ASCII strings
    # and can swallow the following quote byte, so the captured JSON no longer
    # parses. Decode and write UTF-8 explicitly, inside the job process.
    $job = Start-Job -ScriptBlock {
        param($n, $l, $a, $o)
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [Console]::OutputEncoding = $utf8
        $OutputEncoding = $utf8
        $text = (& $n $l @a 2>&1 | Out-String)
        [System.IO.File]::WriteAllText($o, $text, $utf8)
    } -ArgumentList $node, $launcher, $Arguments, $out

    if (-not (Wait-Job $job -Timeout $TimeoutSec)) {
        Stop-Job $job; Remove-Job $job -Force
        "{0,-22} {1,8:N1}s  TIMEOUT" -f $Name, $sw.Elapsed.TotalSeconds
        return
    }
    Remove-Job $job -Force
    $sw.Stop()

    $raw = if (Test-Path $out) { Get-Content $out -Raw } else { '' }
    # Strip optional leading pino log lines, then parse the JSON envelope.
    $start = $raw.IndexOf('{')
    $end = $raw.LastIndexOf('}')
    $verdict = 'no output'
    if ($start -ge 0 -and $end -gt $start) {
        $json = $raw.Substring($start, $end - $start + 1)
        try {
            $j = $json | ConvertFrom-Json
            if ($j.code) {
                $verdict = "FAIL $($j.code): $($j.message)"
            } else {
                $provider = $j.provider.id
                if (-not $provider) { $provider = $j.normalized_result.provider.id }
                $subject = $j.subject.path
                if (-not $subject) { $subject = $j.normalized_result.subject.path }
                $verdict = ("ok provider={0}{1}" -f ($provider ?? 'session'), ($(if ($subject) { " target=$(Split-Path $subject -Leaf)" } else { '' })))
            }
        } catch {
            $verdict = "parse failed: $($_.Exception.Message)"
        }
    } elseif ($raw -match '\S') {
        $verdict = (($raw -split "`r?`n") | Where-Object { $_ -match '\S' } | Select-Object -First 1)
    }
    "{0,-22} {1,8:N1}s  {2}" -f $Name, $sw.Elapsed.TotalSeconds, $verdict
}

"REA self-test $(Get-Date -Format 'u')"
"node    : $node"
"launcher: $launcher"
""
"--- structural checks (no engine needed) ---"
Invoke-ReaStep 'providers'      @('providers', '--format', 'json')
Invoke-ReaStep 'capabilities'   @('capabilities', '--format', 'json', '--token-limit', '1500')
Invoke-ReaStep 'adb-client'     @('inspect-adb-client', '--format', 'json')
Invoke-ReaStep 'apktool-client' @('inspect-apktool-client', '--format', 'json')

""
"--- managed / archive (pure static) ---"
Invoke-ReaStep 'managed-dll'    @('inspect-managed-artifact', "$samples\managed-System.netfx.dll", '--format', 'json')
Invoke-ReaStep 'archive-zip'    @('inspect-artifact', "$samples\archive-lsposed.zip", '--format', 'json')

if (-not $SkipHeavy) {
    ""
    "--- native PE through Ghidra (slow: import + auto-analysis) ---"
    Invoke-ReaStep 'native-ghidra' @('inspect', "$samples\native-elevate.exe", '--provider', 'ghidra', '--format', 'json') 1800

    ""
    "--- Android APK (jadx + apktool) ---"
    Invoke-ReaStep 'apk-jadx'      @('inspect-android-package', "$samples\android-magisk-alpha.apk", '--format', 'json') 1800
    Invoke-ReaStep 'apk-resources' @('decode-android-resources', "$samples\android-magisk-alpha.apk", '--format', 'json') 1200
}

""
"Raw JSON for every step is in $logs\e2e-*.json"
