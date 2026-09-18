#!/usr/bin/env bash
# RBuilder macOS uninstaller - the inverse of install-rbuilder-mac.command.
#
# Removes ONLY what the setup script installed:
#   - the built RBuilder.app and any RBuilder disk images in the project;
#   - the installed app in /Applications and its preferences (optional, asked);
#   - ~/.cargo, ~/.rustup and ~/.bun (asked before each removal).
#
# The project folder itself (source code) is never touched.

set -uo pipefail

step() { printf "\n==> %s\n" "$1"; }
ok()   { printf "  [OK] %s\n" "$1"; }
info() { printf "  ..  %s\n" "$1"; }

cd "$(dirname "$0")"

printf "\n========================================\n"
printf "  RBuilder macOS Uninstaller\n"
printf "========================================\n"
printf "This script removes only what RBuilder setup installed:\n"
printf "  - built app / disk images in the project folder\n"
printf "  - RBuilder.app in /Applications and its preferences\n"
printf "  - Rust and Bun (asked separately)\n\n"

# Step 1: kill any running instances.
step "1/5 Stopping RBuilder"
pkill -f "RBuilder.app/Contents/MacOS/RBuilder" 2>/dev/null && ok "Stopped" || info "Not running"

# Step 2: remove project build artifacts.
step "2/5 Removing build artifacts from the project"
removed=0
if [[ -d src-tauri/target ]]; then
  printf "Remove build cache src-tauri/target (regenerated on next build)? [y/N] "
  read -r answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    rm -rf src-tauri/target
    ok "src-tauri/target removed"
    removed=1
  fi
fi
shopt -s nullglob
for dmg in RBuilder*.dmg RBuilder_*-*.dmg; do
  rm -f -- "$dmg"
  ok "Removed $dmg"
  removed=1
done
shopt -u nullglob
if [[ "$removed" == "0" ]]; then info "Nothing to remove in the project"; fi

# Step 3: remove the installed app.
step "3/5 Removing the installed app"
APP_FOUND=0
if [[ -d "/Applications/RBuilder.app" ]]; then
  APP_FOUND=1
  printf "Remove /Applications/RBuilder.app? [y/N] "
  read -r answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    # /Applications usually needs admin rights.
    if rm -rf "/Applications/RBuilder.app" 2>/dev/null; then
      ok "Removed /Applications/RBuilder.app"
    else
      info "Needs admin rights - running with sudo..."
      sudo rm -rf "/Applications/RBuilder.app" && ok "Removed /Applications/RBuilder.app"
    fi
  fi
  # Preferences - removed only after the app itself was removed.
  printf "Remove RBuilder preferences (~/Library/Preferences/ru.rbuilder.desktop*)? [y/N] "
  read -r answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    rm -rf "$HOME/Library/Preferences/ru.rbuilder.desktop."* 2>/dev/null || true
    rm -rf "$HOME/Library/WebKit/ru.rbuilder.desktop" 2>/dev/null || true
    rm -rf "$HOME/Library/Caches/ru.rbuilder.desktop" 2>/dev/null || true
    ok "Preferences removed"
  fi
fi
if [[ "$APP_FOUND" == "0" ]]; then info "No installed app found in /Applications"; fi

# Step 4: remove Rust.
step "4/5 Rust toolchain"
if [[ -d "$HOME/.cargo" || -d "$HOME/.rustup" ]]; then
  printf "Remove Rust (~/.cargo, ~/.rustup)? Other projects may need it. [y/N] "
  read -r answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    rustup self uninstall -y >/dev/null 2>&1 || true
    rm -rf "$HOME/.cargo" "$HOME/.rustup"
    ok "Rust removed"
  fi
else
  info "Rust not found"
fi

# Step 5: remove Bun.
step "5/5 Bun"
if [[ -d "$HOME/.bun" ]]; then
  printf "Remove Bun (~/.bun)? Other projects may need it. [y/N] "
  read -r answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    rm -rf "$HOME/.bun"
    # Clean PATH lines the Bun installer appended.
    for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.profile"; do
      if [[ -f "$rc" ]] && grep -q "\.bun/bin" "$rc" 2>/dev/null; then
        sed -i '' '/\.bun\/bin/d' "$rc" 2>/dev/null || true
        ok "Cleaned $rc"
      fi
    done
    ok "Bun removed"
  fi
else
  info "Bun not found"
fi

printf "\n========================================\n"
printf "  RBUILDER MACOS UNINSTALL FINISHED\n"
printf "========================================\n"
printf "The project folder itself is preserved.\n"
printf "To remove the source code too, delete the project folder manually.\n"
