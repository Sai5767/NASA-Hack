# Stops Trend Detective (the backend and front-end started by START.bat). Normally run by double-clicking STOP.bat.
# Only touches processes that belong to this project folder.

param([switch]$NoPause)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root ".app-pids.json"
$stopped = 0

function Stop-Tree($id) {
    if (-not $id) { return $false }
    if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { return $false }
    & taskkill /PID $id /T /F 2>$null | Out-Null
    return $true
}

# 1. The windows START.bat recorded.
if (Test-Path $pidFile) {
    try {
        $ids = Get-Content $pidFile -Raw | ConvertFrom-Json
        foreach ($id in @($ids.backend, $ids.frontend)) { if (Stop-Tree $id) { $stopped++ } }
    } catch { }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# 2. Anything still listening on our ports that was started from this folder (for example by an older start script).
foreach ($port in 8000, 5173) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -and $proc.CommandLine -like "*$root*") {
            if (Stop-Tree $proc.ProcessId) { $stopped++ }
        }
    }
}

Write-Host ""
if ($stopped -gt 0) {
    Write-Host "  Trend Detective stopped." -ForegroundColor Green
} else {
    Write-Host "  Nothing from this project was running." -ForegroundColor DarkGray
}
foreach ($port in 8000, 5173) {
    $left = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($left) { Write-Host "  Note: something else is still using port $port (not started from this folder, so it was left alone)." -ForegroundColor Yellow }
}
if (-not $NoPause) { Start-Sleep -Seconds 3 }
exit 0
