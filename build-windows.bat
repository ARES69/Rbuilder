@echo off
setlocal EnableExtensions

rem UTF-8 console so any non-ASCII output renders correctly.
chcp 65001 >nul

cd /d "%~dp0"

echo.
echo ========================================
echo   RBuilder Windows - build installers
echo ========================================
echo.
echo Runs: TypeScript check, unit tests, web build, Tauri installer build.
echo The first run takes a while; later runs are much faster.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Build
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
  echo Build finished. Installers are here:
  echo   src-tauri\target\release\bundle\nsis\*-setup.exe
  echo   src-tauri\target\release\bundle\msi\*.msi
  echo Share those files - no Rust/Bun/VS needed on other machines.
) else (
  echo Build FAILED with exit code %EXITCODE%. Read the message above,
  echo fix the problem and run this file again.
)
echo.
pause
exit /b %EXITCODE%
