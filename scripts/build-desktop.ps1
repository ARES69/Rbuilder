# Builds the RBuilder desktop app end to end:
#   1. the front end (dist/),
#   2. the production server bundle (dist-server/),
#   3. the standalone sidecar executable (.freebuff-build/rbuilder-server.exe),
#   4. the Tauri shell with MSI and NSIS installers.
# Artifacts land in src-tauri/target/release/bundle/.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '==> 1/4 front end' -ForegroundColor Cyan
pnpm exec vite build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '==> 2/4 server bundle' -ForegroundColor Cyan
pnpm exec vite build --config vite.config.server.ts
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '==> 3/4 sidecar executable' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path .freebuff-build | Out-Null
bun build dist-server/index.js --compile --outfile .freebuff-build/rbuilder-server.exe
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '==> 4/4 Tauri shell (MSI + NSIS)' -ForegroundColor Cyan
pnpm exec tauri build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ''
Write-Host 'Done. Installers:' -ForegroundColor Green
Get-ChildItem -Recurse src-tauri\target\release\bundle -Include *.msi, *.exe |
    ForEach-Object { Write-Host "  $($_.FullName)" }
