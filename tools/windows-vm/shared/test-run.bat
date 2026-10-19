@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-run.ps1"
echo Done: result4.txt in the Shared folder
pause
