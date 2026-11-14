# One-click launcher for Trend Detective (Windows). Normally started by double-clicking START.bat.
#
# What it does, in order:
#   1. finds Python 3.10+ and Node.js 18+
#   2. first run only: creates the Python environment and installs its packages
#   3. first run only: installs the front-end packages
#   4. starts the backend (port 8000) and front-end (port 5173), each in its own minimized window
#   5. waits until both answer, then opens the app in your browser
#
# Options (for automation and testing): -NoBrowser, -NoPause

param([switch]$NoBrowser, [switch]$NoPause)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$pidFile = Join-Path $root ".app-pids.json"
$apiUrl = "http://127.0.0.1:8000"
$webUrl = "http://127.0.0.1:5173"

function Step($n, $text) { Write-Host ""; Write-Host "[$n/5] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "      $text" -ForegroundColor Green }
function Info($text) { Write-Host "      $text" -ForegroundColor DarkGray }

function Fail($text) {
    Write-Host ""
    Write-Host "  PROBLEM: $text" -ForegroundColor Red
    Write-Host ""
    if (-not $NoPause) { Read-Host "  Press Enter to close this window" | Out-Null }
    exit 1
}

function Test-Url($url) {
    try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { return $false }
}

function Test-Port($port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if ($attempt.AsyncWaitHandle.WaitOne(400) -and $client.Connected) { $client.EndConnect($attempt); return $true }
        return $false
    } catch { return $false } finally { $client.Close() }
}

# Runs a program, keeps its output, and never lets Windows PowerShell turn harmless stderr lines (pip and npm warnings) into errors.
function Invoke-Native([string]$exe, [string[]]$arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Output = (@($lines) | Select-Object -Last 12) -join "`n      " }
}

function Find-Python {
    foreach ($candidate in @(@("py", "-3"), @("python"), @("python3"))) {
        try {
            $exe = $candidate[0]
            $extra = @(); if ($candidate.Count -gt 1) { $extra = $candidate[1..($candidate.Count - 1)] }
            $out = & $exe @extra -c "import sys; print(sys.version_info[0], sys.version_info[1]); print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and @($out).Count -ge 2) {
                $v = ([string]$out[0]).Split(" ")
                if ([int]$v[0] -eq 3 -and [int]$v[1] -ge 10) { return ([string]$out[1]).Trim() }
            }
        } catch { continue }  # includes the Microsoft Store "python" stub, which is not a real Python
    }
    return $null
}

function Find-Npm {
    $found = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    foreach ($path in @("$env:ProgramFiles\nodejs\npm.cmd", "${env:ProgramFiles(x86)}\nodejs\npm.cmd", "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd")) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

try {
    Write-Host ""
    Write-Host "  TREND DETECTIVE  -  Earth system case files" -ForegroundColor Cyan
    Write-Host "  ------------------------------------------" -ForegroundColor DarkGray

    # Already running? Then just open it.
    if ((Test-Url "$apiUrl/api/places") -and (Test-Url "$webUrl/")) {
        Ok "Trend Detective is already running at $webUrl"
        if (-not $NoBrowser) { Start-Process $webUrl }
        if (-not $NoPause) { Start-Sleep -Seconds 3 }
        exit 0
    }
    foreach ($port in 8000, 5173) {
        if (Test-Port $port) {
            Fail "Port $port is already used by another program. Close it (or run STOP.bat if it is an old copy of this app) and try again."
        }
    }

    # 1. Tools
    Step 1 "Checking Python and Node.js"
    $python = Find-Python
    if (-not $python) {
        Fail "Python 3.10 or newer was not found.`n  Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'),`n  or run:  winget install Python.Python.3.12`n  Then double-click START.bat again."
    }
    Ok "Python: $python"

    $npm = Find-Npm
    if (-not $npm) {
        Fail "Node.js was not found.`n  Install it from https://nodejs.org/ (the LTS version),`n  or run:  winget install OpenJS.NodeJS.LTS`n  Then double-click START.bat again."
    }
    $env:Path = "$(Split-Path -Parent $npm);$env:Path"
    $nodeVersion = (& node --version 2>$null)
    if (-not $nodeVersion -or [int]($nodeVersion.TrimStart("v").Split(".")[0]) -lt 18) {
        Fail "Node.js 18 or newer is needed (found: $nodeVersion). Install the current LTS from https://nodejs.org/."
    }
    Ok "Node.js: $nodeVersion"

    # 2. Python environment
    Step 2 "Preparing the backend"
    $venvPython = Join-Path $backend ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        Info "First run: creating the Python environment (about a minute)..."
        $r = Invoke-Native $python @("-m", "venv", (Join-Path $backend ".venv"))
        if ($r.Code -ne 0) { Fail "Could not create the Python environment.`n      $($r.Output)" }
    }
    $r = Invoke-Native $venvPython @("-c", "import fastapi, uvicorn, httpx")
    if ($r.Code -ne 0) {
        Info "Installing backend packages (first run only)..."
        $r = Invoke-Native $venvPython @("-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", (Join-Path $backend "requirements.txt"))
        if ($r.Code -ne 0) { Fail "Installing the backend packages failed. Check your internet connection and try again.`n      $($r.Output)" }
    }
    Ok "Backend ready"

    # 3. Front-end packages
    Step 3 "Preparing the front-end"
    if (-not (Test-Path (Join-Path $frontend "node_modules\vite"))) {
        Info "Installing front-end packages (first run only, about a minute)..."
        Push-Location $frontend
        $r = Invoke-Native $npm @("install", "--no-audit", "--no-fund", "--loglevel=error")
        Pop-Location
        if ($r.Code -ne 0) { Fail "Installing the front-end packages failed. Check your internet connection and try again.`n      $($r.Output)" }
    }
    Ok "Front-end ready"

    # 4. Start both servers
    Step 4 "Starting the servers"
    $be = Start-Process -FilePath $venvPython -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" -WorkingDirectory $backend -WindowStyle Minimized -PassThru
    $fe = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "npm run dev" -WorkingDirectory $frontend -WindowStyle Minimized -PassThru
    @{ backend = $be.Id; frontend = $fe.Id } | ConvertTo-Json | Set-Content -Path $pidFile -Encoding ascii
    Info "Backend and front-end are starting in two minimized windows."

    # 5. Wait until ready, then open
    Step 5 "Waiting for the app to come up"
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ((Test-Url "$apiUrl/api/places") -and (Test-Url "$webUrl/")) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Fail "The app did not start within a minute. Look at the two minimized windows for error messages, or run STOP.bat and try again."
    }
    Ok "Ready at $webUrl"
    if (-not $NoBrowser) { Start-Process $webUrl }

    Write-Host ""
    Write-Host "  Trend Detective is running. Use STOP.bat when you are finished." -ForegroundColor Green
    if (-not $NoPause) { Start-Sleep -Seconds 4 }
    exit 0
} catch {
    Fail $_.Exception.Message
}
