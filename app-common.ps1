# Shared helpers for start-app.ps1 and stop-app.ps1 (the scripts behind START.bat and STOP.bat).
#
# The point of these helpers: never reuse a server blindly. Two copies of this project cannot share ports 8000 and 5173, and
# a copy left running (an old clone, or code that changed after the server started) would otherwise be opened as "the app".

$script:AppPorts = 8000, 5173

# Does this command line belong to Trend Detective's backend (port 8000) or front-end dev server (port 5173)?
function Test-AppCommandLine([string]$commandLine, [int]$port) {
    if (-not $commandLine) { return $false }
    if ($port -eq 8000) { return $commandLine -match 'uvicorn\s+app\.main:app' }
    return ($commandLine -match 'vite') -and ($commandLine -match '[\\/]frontend[\\/]')
}

# The project folder a server was started from, read from its command line (null if it cannot be told).
function Get-AppFolder([string]$commandLine) {
    $m = [regex]::Match($commandLine, '([A-Za-z]:\\[^"]*?)\\(?:backend|frontend)\\')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

# Everything listening on the two ports, with what started it and whether that is Trend Detective.
function Get-AppListeners {
    $found = @()
    foreach ($port in $script:AppPorts) {
        foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
            $cmd = if ($proc) { [string]$proc.CommandLine } else { "" }
            $found += [pscustomobject]@{
                Port = $port; ProcessId = [int]$listener.OwningProcess; CommandLine = $cmd
                Ours = (Test-AppCommandLine $cmd $port); Folder = (Get-AppFolder $cmd)
            }
        }
    }
    return @($found | Sort-Object Port, ProcessId -Unique)
}

# Stop a server and the console window that was running it (npm leaves a chain of cmd and node processes behind).
function Stop-AppProcess([int]$processId) {
    $target = $processId
    for ($i = 0; $i -lt 5; $i++) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$target" -ErrorAction SilentlyContinue
        if (-not $p) { break }
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($parent -and $parent.Name -match '^(cmd|node|npm)' -and [string]$parent.CommandLine -match 'npm|vite|cmd(\.exe)?"?\s+/[kdsc]') { $target = [int]$parent.ProcessId } else { break }
    }
    & taskkill /PID $target /T /F 2>$null | Out-Null
}

function Wait-PortsFree([int]$seconds = 12) {
    for ($i = 0; $i -lt $seconds * 2; $i++) {
        if (-not (Get-NetTCPConnection -State Listen -LocalPort $script:AppPorts -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# What the running backend says it is (null if it does not answer, or is an old build without /api/version).
function Get-ServerVersion([string]$apiUrl) {
    try { return Invoke-RestMethod -Uri "$apiUrl/api/version" -TimeoutSec 4 } catch { return $null }
}

# The commit this folder is at right now, and whether tracked files have uncommitted changes (null without git).
function Get-ExpectedVersion([string]$root) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Test-Path (Join-Path $root ".git"))) { return $null }
    $commit = (& git -C $root rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $commit) { return $null }
    $dirty = [bool](& git -C $root status --porcelain --untracked-files=no 2>$null)
    return [pscustomobject]@{ Commit = ("$commit").Trim(); Dirty = $dirty }
}

# Why a running backend is NOT the current code of this folder, or $null if it is.
function Get-StaleReason([string]$root, $info) {
    if (-not $info -or $info.app -ne "trend-detective") { return "it is an older build that does not report its version" }
    if ($info.root -and (([string]$info.root).TrimEnd('\') -ne $root.TrimEnd('\'))) { return "it is running from another folder: $($info.root)" }
    $started = [DateTimeOffset]::FromUnixTimeSeconds([long]$info.started_epoch).UtcDateTime
    $newest = Get-ChildItem (Join-Path $root "backend\app") -Filter *.py | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($newest -and $newest.LastWriteTimeUtc -gt $started.AddSeconds(2)) { return "the code changed after it started ($($newest.Name))" }
    $expected = Get-ExpectedVersion $root
    if ($expected -and $info.version -ne "unknown" -and $info.version -ne $expected.Commit) { return "it is version $($info.version) but this folder is at $($expected.Commit)" }
    if ($expected -and ([bool]$info.dirty -ne $expected.Dirty)) { return "uncommitted changes in this folder differ from what it loaded" }
    return $null
}

function Format-Version($info) {
    if (-not $info) { return "unknown" }
    $text = [string]$info.version
    if ($info.dirty) { $text += " + uncommitted changes" }
    return $text
}
