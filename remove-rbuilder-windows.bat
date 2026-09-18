@echo off
setlocal EnableExtensions

rem UTF-8 console so the Russian messages below render correctly.
chcp 65001 >nul

cd /d "%~dp0"

echo.
echo ========================================
echo   RBuilder Windows Uninstaller
echo ========================================
echo.
echo Скрипт удалит только:
echo   - установленное приложение RBuilder;
echo   - локальные настройки RBuilder;
echo   - ярлыки RBuilder.
echo.
echo Исходный проект, Rust, Bun и другие приложения удалены НЕ будут.
echo.
set /p "CONFIRM=Для продолжения введите REMOVE: "
if /I not "%CONFIRM%"=="REMOVE" (
  echo.
  echo Удаление отменено.
  pause
  exit /b 0
)

echo.
echo [1/4] Остановка RBuilder...
taskkill /IM rbuilder-desktop.exe /F >nul 2>nul
taskkill /IM RBuilder.exe /F >nul 2>nul

echo [2/4] Удаление установленного приложения...
rem NSIS-деинсталлятор знает о своих файлах больше, чем winget:
if exist "%LOCALAPPDATA%\Programs\RBuilder\Uninstall RBuilder.exe" (
  "%LOCALAPPDATA%\Programs\RBuilder\Uninstall RBuilder.exe" /S
) else (
  where winget >nul 2>nul && winget uninstall --id ru.rbuilder.desktop --silent --accept-source-agreements >nul 2>nul
  where winget >nul 2>nul && winget uninstall --name RBuilder --silent --accept-source-agreements >nul 2>nul
)
rem MSI-инсталлятор тоже может стоять:
msiexec /x ru.rbuilder.desktop /qn >nul 2>nul

if exist "%LOCALAPPDATA%\Programs\RBuilder" rmdir /s /q "%LOCALAPPDATA%\Programs\RBuilder"
if exist "%PROGRAMFILES%\RBuilder" rmdir /s /q "%PROGRAMFILES%\RBuilder"
if exist "%PROGRAMFILES%\RBuilder Desktop" rmdir /s /q "%PROGRAMFILES%\RBuilder Desktop"

echo [3/4] Удаление пользовательских данных RBuilder...
if exist "%APPDATA%\RBuilder" rmdir /s /q "%APPDATA%\RBuilder"
if exist "%LOCALAPPDATA%\RBuilder" rmdir /s /q "%LOCALAPPDATA%\RBuilder"
if exist "%LOCALAPPDATA%\ru.rbuilder.desktop" rmdir /s /q "%LOCALAPPDATA%\ru.rbuilder.desktop"

echo [4/4] Удаление ярлыков...
if exist "%USERPROFILE%\Desktop\RBuilder.lnk" del /f /q "%USERPROFILE%\Desktop\RBuilder.lnk"
if exist "%PUBLIC%\Desktop\RBuilder.lnk" del /f /q "%PUBLIC%\Desktop\RBuilder.lnk"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\RBuilder.lnk" del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\RBuilder.lnk"
if exist "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RBuilder.lnk" del /f /q "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RBuilder.lnk"

echo.
echo ========================================
echo УДАЛЕНИЕ RBUILDER ЗАВЕРШЕНО
echo ========================================
echo.
echo Исходная папка проекта сохранена.
echo Для полного удаления исходного кода удалите папку проекта вручную.
echo.
pause
exit /b 0
