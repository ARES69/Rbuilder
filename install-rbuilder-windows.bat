@echo off
setlocal EnableExtensions

rem UTF-8 console so any non-ASCII output renders correctly.
rem The PowerShell script itself prints ASCII only, so this is belt-and-suspenders.
chcp 65001 >nul

cd /d "%~dp0"

echo.
echo ========================================
echo   RBuilder Windows - environment setup
echo ========================================
echo.
echo Installs everything needed to build RBuilder Desktop:
echo   Git, Bun, Rust (MSVC), VS C++ Build Tools, WebView2.
echo Administrator approval (UAC) is requested only for system packages.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
  echo Setup finished successfully.
  echo Next step: run build-windows.bat to build the installers.
) else (
  echo Setup FAILED with exit code %EXITCODE%. Read the message above,
  echo fix the problem and run this file again.
)
echo.
pause
exit /b %EXITCODE%
