@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "%~dp0setup-windows.ps1" (
  echo [ERROR] setup-windows.ps1 was not found next to build-windows.bat.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Build
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  echo.
  echo Installers were created in:
  echo   src-tauri\target\release\bundle\msi
  echo   src-tauri\target\release\bundle\nsis
)

pause
exit /b %EXIT_CODE%
