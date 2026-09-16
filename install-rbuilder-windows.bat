@echo off
setlocal EnableExtensions

chcp 65001 >nul 2>nul
cd /d "%~dp0"

echo.
echo ========================================
echo   RBuilder Full Windows Installer
echo ========================================
echo.
echo Скрипт проверит и при необходимости установит:
echo   Git, Bun, Rust MSVC, Visual Studio C++,
echo   WebView2, VC++ Runtime и зависимости проекта.
echo Затем будет создан Tauri installer.
echo.
echo Требуется интернет и права администратора.
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell не найден.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Build
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Установка завершилась с ошибкой. Код: %EXIT_CODE%
) else (
  echo Установка и сборка успешно завершены.
)
echo.
pause
exit /b %EXIT_CODE%
