@echo off
rem Double-click launcher for Windows; see start.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
