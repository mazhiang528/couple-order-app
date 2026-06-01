@echo off
title ?? ??????
echo.
echo   ??  ?????????...
echo.
echo   [1/2] ???????...
start /B node "%~dp0server.js" > nul 2>&1
timeout /t 2 /nobreak > nul
echo   [2/2] ?? Cloudflare ??????????...
echo.
"C:\Users\ASUS\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe" tunnel --url http://localhost:3456 --no-autoupdate
pause
