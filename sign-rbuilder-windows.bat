@echo off
setlocal EnableExtensions

rem UTF-8 console so any non-ASCII path renders correctly.
chcp 65001 >nul

cd /d "%~dp0"

echo.
echo ========================================
echo   RBuilder Windows - sign installers
echo ========================================
echo.
echo Signs the already built MSI/NSIS files with your code signing
echo certificate and verifies the result.
echo.
echo Configure the certificate first - either set RB_SIGN_PFX
echo (+ RB_SIGN_PFX_PASSWORD) or RB_SIGN_THUMBPRINT, or call
echo sign-windows.ps1 with -Pfx / -Thumbprint arguments.
echo Details: README-WINDOWS.md
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sign-windows.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
echo Exit code: %EXITCODE%
echo A non-zero code means signing failed - read the [ERROR] line above.
echo.
pause
exit /b %EXITCODE%
