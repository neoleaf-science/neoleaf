@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-after-restart.ps1"
echo Done: result3.txt in the Shared folder
pause
