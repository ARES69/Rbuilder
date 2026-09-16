@echo off
setlocal EnableExtensions

rem Use UTF-8 in Windows cmd so Russian messages render correctly.
chcp 65001 >nul

rem Add standard per-user install locations to PATH.
if exist "%USERPROFILE%\.bun\bin" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
if exist "%USERPROFILE%\.cargo\bin" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

cd /d "%~dp0"
set "EXIT_CODE=0"

echo.
echo ========================================
echo        RBuilder Windows Builder
echo ========================================
echo.

where bun >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Bun не найден.
  echo Установите Bun командой:
  echo powershell -c "irm bun.sh/install.ps1 ^| iex"
  echo Затем закройте и заново откройте PowerShell.
  set "EXIT_CODE=1"
  goto :fail
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cargo/Rust не найден.
  echo Установите Rust MSVC: https://rustup.rs
  echo Затем закройте и заново откройте PowerShell.
  set "EXIT_CODE=1"
  goto :fail
)

where rustc >nul 2>nul
if errorlevel 1 (
  echo [ERROR] rustc не найден в PATH.
  set "EXIT_CODE=1"
  goto :fail
)

echo [1/6] Проверка версий...
bun --version
rustc --version
cargo --version

echo.
echo [2/6] Установка JavaScript-зависимостей...
bun install
if errorlevel 1 goto :command_failed

echo.
echo [3/6] TypeScript typecheck...
bunx tsc -b --noEmit
if errorlevel 1 goto :command_failed

echo.
echo [4/6] Unit-тесты...
bun test
if errorlevel 1 goto :command_failed

echo.
echo [5/6] Сборка web-приложения...
bun run build
if errorlevel 1 goto :command_failed

echo.
echo [6/6] Сборка Tauri installer...
bunx tauri build
if errorlevel 1 goto :command_failed

echo.
echo ========================================
echo СБОРКА УСПЕШНО ЗАВЕРШЕНА
echo ========================================
echo.
echo Установщики находятся в:
echo   src-tauri\target\release\bundle\msi
echo   src-tauri\target\release\bundle\nsis
echo.
explorer "%CD%\src-tauri\target\release\bundle"
goto :done

:command_failed
set "EXIT_CODE=1"
echo.
echo [ERROR] Предыдущая команда завершилась с ошибкой.
goto :fail

:fail
echo.
echo Сборка остановлена. Исправьте ошибку и запустите файл снова.
echo.
pause
exit /b %EXIT_CODE%

:done
pause
exit /b 0
