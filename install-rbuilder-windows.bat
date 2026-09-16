@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ========================================
echo   RBuilder Full Windows Installer
echo ========================================
echo.
echo This installer checks and installs:
echo   Git, Bun, Rust MSVC, Visual Studio C++,
echo   WebView2, VC++ Runtime and project packages.
echo Then it builds the RBuilder Tauri installer.
echo.
echo Internet access and administrator rights are required.
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Build
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Installation failed. Exit code: %EXIT_CODE%
) else (
  echo Installation and build completed successfully.
)
echo.
pause
exit /b %EXIT_CODE%
