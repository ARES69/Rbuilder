# RBuilder - sign Windows installers that were already built.
#
# Finds the MSI and NSIS files under src-tauri\target, signs each one with
# signtool and verifies the result. Use it when you built without a certificate
# but want to ship signed files.
#
# Limitation worth knowing: this signs the *installers*. The application
# executable inside them was compiled before this script ran, so it stays
# unsigned. To sign that too, configure signing before the build (see
# README-WINDOWS.md) - then Tauri signs the executable and the installers.
#
# Values can also come from the environment, with the same names the build uses:
#   RB_SIGN_PFX, RB_SIGN_PFX_PASSWORD, RB_SIGN_THUMBPRINT, RB_SIGN_TIMESTAMP_URL

[CmdletBinding()]
param(
  [string]$Pfx,
  [string]$PfxPassword,
  [string]$Thumbprint,
  [string]$TimestampUrl,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

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

function Find-SignTool {
  $candidates = @()
  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitsRoot) {
    $candidates += @(
      Get-ChildItem -LiteralPath $kitsRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object -Property Name -Descending |
        ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" }
    )
  }
  $fromPath = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($fromPath) { $candidates += $fromPath.Source }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  return (New-Object System.Net.NetworkCredential("", $secure)).Password
}

try {
  if ([Environment]::OSVersion.Platform -ne "Win32NT") { throw "Windows only." }
  Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Blue
  Write-Host "  RBuilder - sign Windows installers" -ForegroundColor Blue
  Write-Host "========================================" -ForegroundColor Blue

  $pfxPath = $Pfx
  if (-not $pfxPath) { $pfxPath = $env:RB_SIGN_PFX }
  $certThumbprint = $Thumbprint
  if (-not $certThumbprint) { $certThumbprint = $env:RB_SIGN_THUMBPRINT }
  $password = $PfxPassword
  if (-not $password) { $password = $env:RB_SIGN_PFX_PASSWORD }
  $timestamp = $TimestampUrl
  if (-not $timestamp) { $timestamp = $env:RB_SIGN_TIMESTAMP_URL }
  if (-not $timestamp) { $timestamp = "http://timestamp.digicert.com" }

  if (-not $pfxPath -and -not $certThumbprint) {
    throw "No certificate configured. Pass -Pfx <file.pfx> or -Thumbprint <sha1>, or set RB_SIGN_PFX / RB_SIGN_THUMBPRINT. See README-WINDOWS.md."
  }
  if ($pfxPath) {
    if (-not (Test-Path -LiteralPath $pfxPath)) { throw "Certificate not found: $pfxPath" }
    if (-not $password) { $password = Read-Secret "Password for $pfxPath" }
  }

  Write-Step "signtool"
  $signtool = Find-SignTool
  if (-not $signtool) {
    throw "signtool.exe not found. Install the Windows 10/11 SDK (it comes with the Visual Studio C++ Build Tools)."
  }
  Write-Ok $signtool

  Write-Step "Installers"
  $installers = @(
    Get-ChildItem -Path "src-tauri\target" -Recurse -Include *.msi,*-setup.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\bundle\\(msi|nsis)\\" } |
      Sort-Object LastWriteTime -Descending
  )
  if ($installers.Count -eq 0) {
    throw "No installers found under src-tauri\target. Run build-windows.bat first."
  }
  $installers | ForEach-Object { Write-Info $_.FullName }

  Write-Step "Signing"
  foreach ($installer in $installers) {
    $signArguments = @("sign", "/fd", "sha256", "/tr", $timestamp, "/td", "sha256", "/v")
    if ($certThumbprint) {
      $signArguments += @("/sha1", $certThumbprint)
    } else {
      $signArguments += @("/f", $pfxPath, "/p", $password)
    }
    $signArguments += $installer.FullName
    & $signtool @signArguments
    if ($LASTEXITCODE -ne 0) {
      throw "Signing failed for $($installer.Name) (exit code $LASTEXITCODE)."
    }
    Write-Ok "Signed $($installer.Name)"
  }

  if (-not $SkipVerify) {
    Write-Step "Verification"
    foreach ($installer in $installers) {
      $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
      if ($signature.Status -eq "Valid") {
        Write-Ok "Valid: $($installer.Name) - $($signature.SignerCertificate.Subject)"
      } elseif ($signature.Status -eq "NotSigned" -or $signature.Status -eq "HashMismatch") {
        throw "Signature check failed for $($installer.Name): $($signature.Status)"
      } else {
        Write-Info "Signature present, not trusted on this machine: $($installer.Name) - $($signature.Status)"
      }
    }
  }

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  Write-Host "  DONE. Installers are signed and timestamped." -ForegroundColor Green
  Write-Host "  SmartScreen reputation follows the certificate:" -ForegroundColor Green
  Write-Host "  sign every release with the same one." -ForegroundColor Green
  Write-Host "========================================" -ForegroundColor Green
  exit 0
} catch {
  Write-Host ""
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Nothing else was changed. Fix the issue above and run this script again." -ForegroundColor Yellow
  exit 1
}
