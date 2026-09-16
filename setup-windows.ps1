[CmdletBinding()]
param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "[$Message]" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Add-ToolPaths {
  $paths = @(
    "$env:USERPROFILE\.bun\bin",
    "$env:USERPROFILE\.cargo\bin",
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\Git\bin",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
  )
  $existing = $paths | Where-Object { $_ -and (Test-Path $_) }
  if ($existing.Count -gt 0) {
    $env:Path = (($existing + ($env:Path -split [IO.Path]::PathSeparator)) -join [IO.Path]::PathSeparator)
  }
}

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    return
  }

  Write-Host "Запрашиваются права администратора для установки системных компонентов..." -ForegroundColor Yellow
  $scriptPath = $MyInvocation.ScriptName
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`""
  )
  if ($Build) { $arguments += "-Build" }
  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

function Ensure-Winget {
  if (Test-Command "winget") {
    Write-Ok "winget найден"
    return
  }

  throw "winget не найден. Установите или обновите App Installer из Microsoft Store, затем запустите install-rbuilder-windows.bat снова."
}

function Install-WingetPackage([string]$Id, [string[]]$ExtraArguments = @()) {
  Write-Host "Установка $Id..." -ForegroundColor DarkCyan
  & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements @ExtraArguments
  if ($LASTEXITCODE -ne 0) {
    throw "winget не смог установить $Id (код $LASTEXITCODE)."
  }
  Add-ToolPaths
}

function Ensure-Git {
  Add-ToolPaths
  if (-not (Test-Command "git")) {
    Install-WingetPackage "Git.Git"
    Add-ToolPaths
  }
  if (-not (Test-Command "git")) { throw "Git установлен, но не найден в PATH. Перезапустите Windows и повторите запуск." }
  Write-Ok "Git $(git --version)"
}

function Ensure-Bun {
  Add-ToolPaths
  if (-not (Test-Command "bun")) {
    Write-Host "Bun не найден. Запускается официальный установщик Bun..." -ForegroundColor DarkCyan
    $installer = Invoke-RestMethod -Uri "https://bun.sh/install.ps1"
    Invoke-Expression $installer
    Add-ToolPaths
  }
  if (-not (Test-Command "bun")) { throw "Bun не найден после установки. Закройте все терминалы, откройте новый PowerShell и повторите запуск." }
  Write-Ok "Bun $(bun --version)"
}

function Ensure-Rust {
  Add-ToolPaths
  if (-not (Test-Command "rustup")) {
    Install-WingetPackage "Rustlang.Rustup"
    Add-ToolPaths
  }
  if (-not (Test-Command "rustup")) { throw "Rustup не найден после установки." }

  & rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
  if ($LASTEXITCODE -ne 0) { throw "Не удалось установить Rust MSVC toolchain." }
  & rustup default stable-x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) { throw "Не удалось выбрать Rust MSVC toolchain." }
  & rustup target add x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) { throw "Не удалось добавить Windows MSVC target." }
  Add-ToolPaths

  if (-not (Test-Command "cargo") -or -not (Test-Command "rustc")) {
    throw "Cargo/rustc не найдены после установки Rust. Перезапустите Windows и повторите запуск."
  }
  Write-Ok "$(rustc --version)"
  Write-Ok "$(cargo --version)"
}

function Test-VisualStudioCpp {
  $vswhereCandidates = @(
    "$env:ProgramFiles(x86)\Microsoft Visual Studio\Installer\vswhere.exe",
    "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
  )
  $vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vswhere) { return $false }

  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if ([string]::IsNullOrWhiteSpace($installPath)) { return $false }
  return Test-Path (Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat")
}

function Ensure-VisualStudioCpp {
  if (-not (Test-VisualStudioCpp)) {
    Write-Host "Visual Studio C++ Build Tools не найдены. Установка может занять 10–30 минут..." -ForegroundColor DarkCyan
    Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @(
      "--override",
      "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    )
  }
  if (-not (Test-VisualStudioCpp)) {
    throw "Visual Studio C++ Build Tools не подтверждены. Установите workload Desktop development with C++ и повторите запуск."
  }
  Write-Ok "Visual Studio C++ Build Tools"
}

function Test-WebView2 {
  $roots = @(
    "$env:ProgramFiles(x86)\Microsoft\EdgeWebView\Application",
    "$env:ProgramFiles\Microsoft\EdgeWebView\Application"
  )
  return @($roots | Where-Object { Test-Path $_ }).Count -gt 0
}

function Ensure-WebView2 {
  if (-not (Test-WebView2)) {
    Install-WingetPackage "Microsoft.EdgeWebView2Runtime"
  }
  if (-not (Test-WebView2)) {
    throw "WebView2 Runtime не найден после установки. Перезагрузите Windows и повторите запуск."
  }
  Write-Ok "Microsoft Edge WebView2 Runtime"
}

function Ensure-VcRuntime {
  $uninstallRoots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  $found = Get-ItemProperty $uninstallRoots -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match "Visual C\+\+.*Redistributable" -and $_.DisplayName -match "2015|2017|2019|2022" }
  if (-not $found) {
    Install-WingetPackage "Microsoft.VCRedist.2015+.x64"
  }
  Write-Ok "Visual C++ Redistributable"
}

function Ensure-ProjectDependencies {
  Set-Location $projectRoot
  Write-Host "Установка зависимостей проекта через Bun..." -ForegroundColor DarkCyan
  & bun install
  if ($LASTEXITCODE -ne 0) { throw "bun install завершился с ошибкой." }
  Write-Ok "Зависимости проекта установлены"

  & bunx tauri --version
  if ($LASTEXITCODE -ne 0) { throw "Tauri CLI недоступен через bunx." }
  Write-Ok "Tauri CLI доступен"
}

function Test-ProjectConfiguration {
  $envFiles = @(".env", ".env.local") | Where-Object { Test-Path (Join-Path $projectRoot $_) }
  if ($envFiles.Count -eq 0) {
    Write-Warn "Файл .env/.env.local не найден. Секреты не создаются автоматически; добавьте VITE_CONVEX_URL через Keys/API keys перед cloud-функциями."
  } else {
    Write-Ok "Конфигурационный файл проекта найден"
  }
}

function Build-Project {
  Set-Location $projectRoot
  Write-Step "Проверка TypeScript"
  & bunx tsc -b --noEmit
  if ($LASTEXITCODE -ne 0) { throw "TypeScript-проверка завершилась с ошибкой." }

  Write-Step "Unit-тесты"
  & bun test
  if ($LASTEXITCODE -ne 0) { throw "Unit-тесты завершились с ошибкой." }

  Write-Step "Web-сборка"
  & bun run build
  if ($LASTEXITCODE -ne 0) { throw "Web-сборка завершилась с ошибкой." }

  Write-Step "Tauri installer"
  & bunx tauri build
  if ($LASTEXITCODE -ne 0) { throw "Сборка Tauri installer завершилась с ошибкой." }

  Write-Ok "Инсталляторы созданы в src-tauri\target\release\bundle"
}

try {
  Ensure-Administrator
  $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  Set-Location $projectRoot

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Blue
  Write-Host "     RBuilder: установка окружения" -ForegroundColor Blue
  Write-Host "========================================" -ForegroundColor Blue

  Write-Step "Проверка Windows и пакетного менеджера"
  if ([Environment]::OSVersion.Platform -ne "Win32NT") { throw "Этот скрипт предназначен только для Windows." }
  Ensure-Winget

  Write-Step "Базовые инструменты"
  Ensure-Git
  Ensure-Bun
  Ensure-Rust

  Write-Step "Компоненты Tauri Desktop"
  Ensure-VisualStudioCpp
  Ensure-WebView2
  Ensure-VcRuntime

  Write-Step "Проект RBuilder"
  Ensure-ProjectDependencies
  Test-ProjectConfiguration

  if ($Build) {
    Build-Project
  }

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  if ($Build) {
    Write-Host " Установка и сборка RBuilder завершены" -ForegroundColor Green
  } else {
    Write-Host " Установка окружения RBuilder завершена" -ForegroundColor Green
  }
  Write-Host "========================================" -ForegroundColor Green
  if (-not $Build) {
    Write-Host "Для сборки установщика запустите install-rbuilder-windows.bat или build-windows.bat."
  }
  exit 0
} catch {
  Write-Host ""
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Установка остановлена. Исправьте указанную проблему и запустите скрипт снова." -ForegroundColor Yellow
  exit 1
}
