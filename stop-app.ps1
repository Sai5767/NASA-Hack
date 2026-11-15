# Stops Trend Detective (the backend and front-end started by START.bat). Normally run by double-clicking STOP.bat.
# Stops this folder's servers, and also any older copy of Trend Detective still holding its ports. Other programs are left alone.

param([switch]$NoPause)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root ".app-pids.json"
$stopped = 0
. (Join-Path $root "app-common.ps1")

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

# 2. Any Trend Detective server still listening on our ports, whichever folder started it. An old copy would otherwise keep the
#    ports and get opened instead of this folder's current code.
foreach ($l in @(Get-AppListeners)) {
    if ($l.Ours) {
        if ($l.Folder -and ($l.Folder -ne $root)) { Write-Host "  Stopping an older copy that was running from $($l.Folder)" -ForegroundColor Yellow }
        Stop-AppProcess $l.ProcessId
        $stopped++
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
