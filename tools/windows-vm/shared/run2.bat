@echo off
title NeoLeaf agent test (compile)
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\test-compile.ps1
echo.
echo Finished. The result is in Z:\result2.txt
pause
