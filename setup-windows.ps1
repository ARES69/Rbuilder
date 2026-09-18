# RBuilder Windows setup/build - one script for both.
#
# Usage (from Explorer, double-click the .bat wrappers):
#   install-rbuilder-windows.bat  -> environment only
#   build-windows.bat             -> environment + checks + Tauri installers
#
# Or from PowerShell directly:
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup-windows.ps1 [-Build]
#
# Design notes:
# - No admin required by default: Bun and Rust install to the user profile.
#   Elevation is requested ONLY when winget needs to install system-wide
#   packages (VC Build Tools, WebView2, VCRedist) - and the working directory
#   is preserved through the UAC hop.
# - ASCII-only console output. The old version printed Russian text from cmd,
#   which mojibake'd depending on the console codepage. English output is
#   codepage-proof; chcp 65001 stays in the .bat wrappers for the filesystem
#   messages they print themselves.

[CmdletBinding()]
param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Info([string]$Message) {
  Write-Host "  ..  $Message" -ForegroundColor DarkCyan
}

function Add-ToolPaths {
  $candidates = @(
    "$env:USERPROFILE\.bun\bin",
    "$env:USERPROFILE\.cargo\bin",
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\Git\bin",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
  )
  $existing = @($candidates | Where-Object { $_ -and (Test-Path $_) })
  if ($existing.Count -gt 0) {
    $env:Path = (($existing + ($env:Path -split [IO.Path]::PathSeparator)) -join [IO.Path]::PathSeparator)
  }
}

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

# Install helper notes: elevation happens inside Install-WingetPackage only
# when the session is not already admin; the project directory never changes
# because the elevated child runs a standalone winget command.

function Install-WingetPackage([string]$Id, [string[]]$ExtraArguments = @()) {
  Write-Info "Installing $Id via winget (system-wide)..."
  if (Test-IsAdmin) {
    & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements @ExtraArguments
    if ($LASTEXITCODE -ne 0) {
      throw "winget failed to install $Id (exit code $LASTEXITCODE)."
    }
  } else {
    # Elevate just this install. Arguments are serialized into the elevated
    # session (EncodedCommand), so quoting survives the UAC hop.
    $script = "& winget install --id '$Id' --exact --silent --accept-package-agreements --accept-source-agreements" +
      $(if ($ExtraArguments.Count -gt 0) { " " + ($ExtraArguments -join " ") }) + "; exit `$LASTEXITCODE"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
    if ($process.ExitCode -ne 0) {
      throw "winget failed to install $Id (exit code $($process.ExitCode))."
    }
  }
  Add-ToolPaths
}

function Ensure-Git {
  Add-ToolPaths
  if (Test-Command "git") {
    Write-Ok "Git $(git --version)"
    return
  }
  if (Test-Command "winget") {
    Install-WingetPackage "Git.Git"
  } else {
    throw "Git not found and winget is unavailable. Install Git from https://git-scm.com/download/win"
  }
  Add-ToolPaths
  if (-not (Test-Command "git")) { throw "Git installed but not in PATH. Reopen the terminal and run again." }
  Write-Ok "Git $(git --version)"
}

function Ensure-Bun {
  Add-ToolPaths
  if (Test-Command "bun") {
    Write-Ok "Bun $(bun --version)"
    return
  }
  # Bun installs to %USERPROFILE%\.bun - no admin needed.
  Write-Info "Installing Bun (user profile, no admin)..."
  $installer = Invoke-RestMethod -Uri "https://bun.sh/install.ps1"
  Invoke-Expression $installer
  Add-ToolPaths
  if (-not (Test-Command "bun")) { throw "Bun not available after install. Reopen the terminal and run again." }
  Write-Ok "Bun $(bun --version)"
}

function Ensure-Rust {
  Add-ToolPaths
  if (-not (Test-Command "rustup")) {
    if (Test-Command "winget") {
      # rustup.exe is user-profile; winget still needs the machine context for
      # its default install scope, so elevate only if required.
      Install-WingetPackage "Rustlang.Rustup"
    } else {
      throw "Rust not found and winget is unavailable. Install rustup from https://rustup.rs"
    }
  }
  Add-ToolPaths
  if (-not (Test-Command "rustup")) { throw "rustup not found after install." }

  Write-Info "Rust toolchain (stable, MSVC) - a few minutes on first run..."
  & rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal 2>&1 | Out-Null
  & rustup default stable-x86_64-pc-windows-msvc 2>&1 | Out-Null
  & rustup target add x86_64-pc-windows-msvc 2>&1 | Out-Null
  Add-ToolPaths
  if (-not (Test-Command "cargo") -or -not (Test-Command "rustc")) {
    throw "cargo/rustc not found after Rust install. Reopen the terminal and run again."
  }
  Write-Ok "$(rustc --version)"
}

function Test-VisualStudioCpp {
  $vswhereCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
    "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
  )
  $vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vswhere) { return $false }
  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if ([string]::IsNullOrWhiteSpace($installPath)) { return $false }
  return Test-Path (Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat")
}

function Ensure-VisualStudioCpp {
  if (Test-VisualStudioCpp) {
    Write-Ok "Visual Studio C++ Build Tools"
    return
  }
  Write-Info "Visual Studio C++ Build Tools not found. Installing (10-30 min, one time)..."
  Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @(
    "--override",
    "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  )
  if (-not (Test-VisualStudioCpp)) {
    throw "C++ Build Tools not confirmed. Install the 'Desktop development with C++' workload, then run again."
  }
  Write-Ok "Visual Studio C++ Build Tools"
}

function Test-WebView2 {
  $roots = @(
    "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application",
    "$env:ProgramFiles\Microsoft\EdgeWebView\Application"
  )
  return @($roots | Where-Object { Test-Path $_ }).Count -gt 0
}

function Ensure-WebView2 {
  if (Test-WebView2) {
    Write-Ok "WebView2 Runtime"
    return
  }
  Install-WingetPackage "Microsoft.EdgeWebView2Runtime"
  if (-not (Test-WebView2)) { throw "WebView2 not confirmed after install. Reboot and run again." }
  Write-Ok "WebView2 Runtime"
}

function Ensure-VcRuntime {
  $roots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  $found = Get-ItemProperty $roots -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match "Visual C\+\+.*Redistributable" -and $_.DisplayName -match "2015|2017|2019|2022" }
  if (-not $found) {
    Install-WingetPackage "Microsoft.VCRedist.2015+.x64"
  }
  Write-Ok "Visual C++ Redistributable"
}

function Ensure-ProjectDependencies {
  Write-Info "bun install..."
  & bun install
  if ($LASTEXITCODE -ne 0) { throw "bun install failed (network/proxy?). Run 'bun install' manually for details." }
  Write-Ok "Project dependencies"

  # Convex type bindings are committed to the repo, so a fresh clone or ZIP
  # typechecks out of the box. Regenerate only when they are missing (e.g. an
  # old archive or a manual cleanup); this may ask for a Convex login.
  if (-not (Test-Path "src\convex\_generated\api.d.ts")) {
    Write-Info "Convex bindings missing - generating (a browser login may be asked)..."
    & bunx convex codegen --typecheck=disable
    if ($LASTEXITCODE -ne 0) {
      throw "Convex bindings could not be generated. Run 'bunx convex dev --once' first, then this script again."
    }
    Write-Ok "Convex bindings generated"
  }
}

function Build-Project {
  Write-Info "TypeScript check..."
  & bunx tsc -b --noEmit
  if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed." }

  Write-Info "Unit tests..."
  & bun test 2>&1 | Select-Object -Last 4 | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "Unit tests failed." }

  Write-Info "Web build (vite)..."
  & bun run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }

  Write-Info "Tauri installer build (several minutes)..."
  & bunx tauri build
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed." }
}

# ---------------------------------------------------------------------------
try {
  $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  Set-Location $projectRoot

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Blue
  Write-Host "  RBuilder Windows setup" -ForegroundColor Blue
  Write-Host "========================================" -ForegroundColor Blue
  if (-not (Test-IsAdmin)) {
    Write-Host "  (no admin required; UAC will be asked only for system packages)" -ForegroundColor DarkGray
  }

  if ([Environment]::OSVersion.Platform -ne "Win32NT") { throw "Windows only." }

  Write-Step "Git + Bun (user profile)"
  Ensure-Git
  Ensure-Bun

  Write-Step "Rust toolchain (MSVC)"
  Ensure-Rust

  Write-Step "System components (admin only when missing)"
  Ensure-VisualStudioCpp
  Ensure-WebView2
  Ensure-VcRuntime

  Write-Step "Project dependencies"
  Ensure-ProjectDependencies

  if ($Build) {
    Write-Step "Checks + build"
    Build-Project
  }

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  if ($Build) {
    Write-Host "  DONE. Installers:" -ForegroundColor Green
    Write-Host "  src-tauri\target\release\bundle\nsis\*-setup.exe" -ForegroundColor Green
    Write-Host "  src-tauri\target\release\bundle\msi\*.msi" -ForegroundColor Green
  } else {
    Write-Host "  Environment ready. Run build-windows.bat to build installers." -ForegroundColor Green
    Write-Host "  Dev mode: bun tauri dev" -ForegroundColor Green
  }
  Write-Host "========================================" -ForegroundColor Green
  exit 0
} catch {
  Write-Host ""
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Setup stopped. Fix the issue above and run this script again." -ForegroundColor Yellow
  exit 1
}
