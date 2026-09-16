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
  $existing = @($paths | Where-Object { $_ -and (Test-Path $_) })
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

  Write-Host "Administrator permission is required. Requesting elevation..." -ForegroundColor Yellow
  $scriptPath = $MyInvocation.ScriptName
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath
  )
  if ($Build) { $arguments += "-Build" }
  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

function Ensure-Winget {
  if (Test-Command "winget") {
    Write-Ok "winget found"
    return
  }

  throw "winget was not found. Install or update App Installer from Microsoft Store, then run the installer again."
}

function Install-WingetPackage([string]$Id, [string[]]$ExtraArguments = @()) {
  Write-Host "Installing $Id..." -ForegroundColor DarkCyan
  & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements @ExtraArguments
  if ($LASTEXITCODE -ne 0) {
    throw "winget failed to install $Id (exit code $LASTEXITCODE)."
  }
  Add-ToolPaths
}

function Ensure-Git {
  Add-ToolPaths
  if (-not (Test-Command "git")) {
    Install-WingetPackage "Git.Git"
    Add-ToolPaths
  }
  if (-not (Test-Command "git")) { throw "Git was installed but is not available in PATH. Restart Windows and try again." }
  Write-Ok "Git $(git --version)"
}

function Ensure-Bun {
  Add-ToolPaths
  if (-not (Test-Command "bun")) {
    Write-Host "Bun was not found. Running the official Bun installer..." -ForegroundColor DarkCyan
    $installer = Invoke-RestMethod -Uri "https://bun.sh/install.ps1"
    Invoke-Expression $installer
    Add-ToolPaths
  }
  if (-not (Test-Command "bun")) { throw "Bun was not found after installation. Restart the terminal and try again." }
  Write-Ok "Bun $(bun --version)"
}

function Ensure-Rust {
  Add-ToolPaths
  if (-not (Test-Command "rustup")) {
    Install-WingetPackage "Rustlang.Rustup"
    Add-ToolPaths
  }
  if (-not (Test-Command "rustup")) { throw "Rustup was not found after installation." }

  & rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
  if ($LASTEXITCODE -ne 0) { throw "Could not install the Rust MSVC toolchain." }
  & rustup default stable-x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) { throw "Could not select the Rust MSVC toolchain." }
  & rustup target add x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) { throw "Could not add the Windows MSVC target." }
  Add-ToolPaths

  if (-not (Test-Command "cargo") -or -not (Test-Command "rustc")) {
    throw "Cargo or rustc was not found after Rust installation. Restart Windows and try again."
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
    Write-Host "Visual Studio C++ Build Tools were not found. Installation may take 10-30 minutes..." -ForegroundColor DarkCyan
    Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @(
      "--override",
      "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    )
  }
  if (-not (Test-VisualStudioCpp)) {
    throw "Visual Studio C++ Build Tools were not confirmed. Install the Desktop development with C++ workload and try again."
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
    throw "WebView2 Runtime was not found after installation. Restart Windows and try again."
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
  Write-Host "Installing project dependencies with Bun..." -ForegroundColor DarkCyan
  & bun install
  if ($LASTEXITCODE -ne 0) { throw "bun install failed." }
  Write-Ok "Project dependencies installed"

  & bunx tauri --version
  if ($LASTEXITCODE -ne 0) { throw "Tauri CLI is not available through bunx." }
  Write-Ok "Tauri CLI available"
}

function Test-ProjectConfiguration {
  $envFiles = @(".env", ".env.local") | Where-Object { Test-Path (Join-Path $projectRoot $_) }
  if ($envFiles.Count -eq 0) {
    Write-Warn "No .env/.env.local file found. Secrets are not created automatically; configure VITE_CONVEX_URL through the project Keys/API keys settings before using cloud features."
  } else {
    Write-Ok "Project configuration file found"
  }
}

function Build-Project {
  Set-Location $projectRoot
  Write-Step "TypeScript check"
  & bunx tsc -b --noEmit
  if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed." }

  Write-Step "Unit tests"
  & bun test
  if ($LASTEXITCODE -ne 0) { throw "Unit tests failed." }

  Write-Step "Web build"
  & bun run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }

  Write-Step "Tauri installer build"
  & bunx tauri build
  if ($LASTEXITCODE -ne 0) { throw "Tauri installer build failed." }

  Write-Ok "Installers created in src-tauri\target\release\bundle"
}

try {
  Ensure-Administrator
  $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  Set-Location $projectRoot

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Blue
  Write-Host "     RBuilder environment installer" -ForegroundColor Blue
  Write-Host "========================================" -ForegroundColor Blue

  Write-Step "Windows and package manager"
  if ([Environment]::OSVersion.Platform -ne "Win32NT") { throw "This script only runs on Windows." }
  Ensure-Winget

  Write-Step "Base tools"
  Ensure-Git
  Ensure-Bun
  Ensure-Rust

  Write-Step "Tauri Desktop components"
  Ensure-VisualStudioCpp
  Ensure-WebView2
  Ensure-VcRuntime

  Write-Step "RBuilder project"
  Ensure-ProjectDependencies
  Test-ProjectConfiguration

  if ($Build) {
    Build-Project
  }

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  if ($Build) {
    Write-Host " RBuilder installation and build complete" -ForegroundColor Green
  } else {
    Write-Host " RBuilder environment setup complete" -ForegroundColor Green
  }
  Write-Host "========================================" -ForegroundColor Green
  if (-not $Build) {
    Write-Host "Run install-rbuilder-windows.bat or build-windows.bat to build the installer."
  }
  exit 0
} catch {
  Write-Host ""
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Setup stopped. Fix the issue above and run the installer again." -ForegroundColor Yellow
  exit 1
}
