# Starts the Earth System Trend Detective: backend (port 8000) and front-end (port 5173).
# Each server opens in its own window so you can see its logs.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File .\start-app.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

$python = Join-Path $backend ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "Backend environment not found. Run these first:`n  cd backend; python -m venv .venv; .venv\Scripts\activate; pip install -r requirements.txt"
    exit 1
}

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = Join-Path $env:ProgramFiles "nodejs\npm.cmd" }
if (-not (Test-Path $npm)) {
    Write-Error "npm not found. Install Node.js LTS, then reopen PowerShell."
    exit 1
}
# Make sure child processes can find node and npm.
$env:Path = "$(Split-Path -Parent $npm);$env:Path"

if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing front-end packages (first run only)..."
    Push-Location $frontend
    & $npm install --no-audit --no-fund
    Pop-Location
}

Write-Host "Starting backend on http://127.0.0.1:8000 ..."
Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" `
    -WorkingDirectory $backend

Write-Host "Starting front-end on http://localhost:5173 ..."
# Run through cmd so the window stays open and shows any errors.
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "npm run dev" -WorkingDirectory $frontend

Write-Host ""
Write-Host "Both servers are starting in their own windows."
Write-Host "Open http://127.0.0.1:5173 in your browser. API docs: http://127.0.0.1:8000/docs"
Write-Host "To stop them, close those two windows."
