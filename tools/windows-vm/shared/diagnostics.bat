@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostics-run.ps1"
echo Done: result5.txt in the Shared folder
pause
