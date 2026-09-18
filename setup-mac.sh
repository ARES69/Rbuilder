#!/usr/bin/env bash
# RBuilder macOS setup/build - one script for both.
#
# Usage:
#   ./install-rbuilder-mac.command   -> environment only (double-clickable)
#   ./build-rbuilder-mac.command     -> environment + checks + Tauri installers
#
# Or from Terminal directly:
#   bash setup-mac.sh            # environment only
#   bash setup-mac.sh --build    # environment + checks + installers
#
# Design notes (mirrors setup-windows.ps1):
# - Nothing outside the user profile is modified: Xcode CLT install touches
#   /Library only via Apple's own installer; Bun and Rust live in ~/.bun and
#   ~/.cargo; cargo targets stay inside the project.
# - ASCII-only console output (same reasoning as the Windows script: the old
#   version printed Russian text from cmd and it mojibake'd depending on the
#   console codepage).
# - Idempotent: re-running installs only what is missing.

set -euo pipefail

BUILD=0
if [[ "${1:-}" == "--build" ]]; then
  BUILD=1
fi

# --- pretty printing ---------------------------------------------------------

step() { printf "\n==> %s\n" "$1"; }
ok()   { printf "  [OK] %s\n" "$1"; }
info() { printf "  ..  %s\n" "$1"; }
fail() { printf "\n[ERROR] %s\n" "$1" >&2; printf "Setup stopped. Fix the issue above and run this script again.\n" >&2; exit 1; }

trap 'fail "Command failed at line $LINENO (exit $?)"' ERR

# --- sanity checks -----------------------------------------------------------

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "macOS only. On Windows use install-rbuilder-windows.bat / build-windows.bat."
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  TARGET="aarch64-apple-darwin" ;;
  x86_64) TARGET="x86_64-apple-darwin" ;;
  *)      fail "Unsupported architecture: $ARCH (need arm64 or x86_64)." ;;
esac

# macOS 11 Big Sur is the oldest Tauri 2 supports.
MAC_MAJOR="$(uname -r | cut -d. -f1)"
if [[ "$MAC_MAJOR" -lt 20 ]]; then
  fail "macOS $(sw_vers -productVersion 2>/dev/null || echo '<unknown>') is too old. Tauri 2 needs macOS 11+."
fi

cd "$(dirname "$0")"

step "RBuilder macOS setup (arch: $ARCH)"
info "Nothing outside your user profile is modified."
info "Admin password is asked only by Apple's own CLT installer, if needed."

# --- ensure Xcode Command Line Tools ----------------------------------------

ensure_clt() {
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools ($(xcode-select -p))"
    return
  fi
  info "Installing Xcode Command Line Tools (Apple dialog, a few minutes)..."
  # Touch the CLT receipt so the system dialog appears even without dev tools.
  touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  CLT_LABEL=$(softwareupdate --list 2>/dev/null \
    | awk '/Command Line Tools/ {print $NF; exit}' \
    | tr -d '*' \
    | sed 's/^ *//;s/ *$//')
  if [[ -n "$CLT_LABEL" ]]; then
    info "Installing via softwareupdate: $CLT_LABEL"
    softwareupdate --install "$CLT_LABEL" --no-scan >/dev/null 2>&1 || true
  else
    xcode-select --install >/dev/null 2>&1 || true
    info "A system dialog should be open. Approve it and run this script again."
    fail "Xcode Command Line Tools are not confirmed yet."
  fi
  if ! xcode-select -p >/dev/null 2>&1; then
    fail "Xcode Command Line Tools are not confirmed. Approve the dialog and run again."
  fi
  ok "Xcode Command Line Tools"
}

# --- ensure Bun --------------------------------------------------------------

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    ok "Bun $(bun --version)"
    return
  fi
  info "Installing Bun (user profile ~/.bun, no admin)..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    fail "Bun not available after install. Reopen the Terminal and run again."
  fi
  ok "Bun $(bun --version)"
}

# --- ensure Rust -------------------------------------------------------------

ensure_rust() {
  if ! command -v rustup >/dev/null 2>&1; then
    info "Installing rustup (user profile ~/.cargo, no admin)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
  if ! command -v rustup >/dev/null 2>&1; then
    fail "rustup not found after install. Reopen the Terminal and run again."
  fi
  info "Rust stable ($TARGET) - a few minutes on first run..."
  rustup toolchain install stable --profile minimal >/dev/null 2>&1 || true
  rustup default stable >/dev/null
  rustup target add "$TARGET" >/dev/null
  if ! command -v cargo >/dev/null 2>&1; then
    fail "cargo/rustc not found after Rust install. Reopen the Terminal and run again."
  fi
  ok "$(rustc --version)"
}

# --- project dependencies and build -------------------------------------------

ensure_project_dependencies() {
  info "bun install..."
  bun install
  ok "Project dependencies"
}

run_checks_and_build() {
  info "TypeScript check..."
  bunx tsc -b --noEmit
  ok "TypeScript check"

  info "Unit tests..."
  bun test | tail -4
  ok "Unit tests"

  info "Web build (vite)..."
  bun run build
  ok "Web build"

  info "Tauri installer build (several minutes on first run)..."
  # Build universal binaries when both toolchains are present so the .dmg
  # runs natively on Apple Silicon and Intel. On a plain machine this falls
  # back to the host architecture.
  if rustup target list --installed | grep -q aarch64-apple-darwin && \
     rustup target list --installed | grep -q x86_64-apple-darwin; then
    info "Both toolchains present - building a universal macOS binary..."
    rustup target add aarch64-apple-darwin >/dev/null
    rustup target add x86_64-apple-darwin >/dev/null
    bunx tauri build --target universal-apple-darwin
  else
    bunx tauri build --target "$TARGET"
  fi
  ok "Tauri build"

  local APP DMG
  APP="$(find src-tauri/target -type f -name "RBuilder.app" -path "*release*" 2>/dev/null | head -1 || true)"
  DMG="$(find src-tauri/target -type f -name "*.dmg" 2>/dev/null | head -1 || true)"
  if [[ -n "$APP" ]]; then info "app:  $APP"; fi
  if [[ -n "$DMG" ]]; then info "dmg:  $DMG"; fi

  info "Make a distributable disk image: ./make-rbuilder-dmg.command"
}

# ---------------------------------------------------------------------------

step "Xcode Command Line Tools"
ensure_clt

step "Bun (user profile)"
ensure_bun

step "Rust toolchain"
ensure_rust

step "Project dependencies"
ensure_project_dependencies

if [[ "$BUILD" == "1" ]]; then
  step "Checks + build"
  run_checks_and_build
fi

printf "\n"
printf "========================================\n"
if [[ "$BUILD" == "1" ]]; then
  printf "  DONE. Artifacts:\n"
  printf "  src-tauri/target/*/release/bundle/macos/RBuilder.app\n"
  printf "  src-tauri/target/*/release/bundle/dmg/*.dmg\n"
  printf "  Share the .dmg - no Rust/Bun needed on other Macs.\n"
else
  printf "  Environment ready. Run build-rbuilder-mac.command to build installers.\n"
  printf "  Dev mode: bun tauri dev\n"
fi
printf "========================================\n"
