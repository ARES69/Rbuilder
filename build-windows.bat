@echo off
setlocal EnableExtensions

chcp 65001 >nul 2>nul
cd /d "%~dp0"

if not exist "%~dp0setup-windows.ps1" (
  echo [ERROR] setup-windows.ps1 не найден рядом с build-windows.bat.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Build
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  echo.
  echo Установщик создан в:
  echo   src-tauri\target\release\bundle\msi
  echo   src-tauri\target\release\bundle\nsis
)

pause
exit /b %EXIT_CODE%
