@echo off
rem Double-click to start Trend Detective. The first run installs what it needs automatically.
cd /d "%~dp0"
title Trend Detective
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-app.ps1" %*
exit /b %errorlevel%
