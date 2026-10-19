@echo off
title NeoLeaf agent test
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\test-agent.ps1
echo.
echo Finished. The result is in Z:\result.txt
pause
