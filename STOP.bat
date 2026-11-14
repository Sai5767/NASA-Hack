@echo off
rem Double-click to stop Trend Detective.
cd /d "%~dp0"
title Stop Trend Detective
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-app.ps1" %*
exit /b %errorlevel%
