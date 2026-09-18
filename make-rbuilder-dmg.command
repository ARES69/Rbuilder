#!/usr/bin/env bash
# Package the built RBuilder.app into a distributable .dmg.
#
# Usage:
#   ./make-rbuilder-dmg.command
#
# Prerequisite: build-rbuilder-mac.command has been run once (it produces
# src-tauri/target/<triple>/release/bundle/macos/RBuilder.app).
# Tauri's own bundler usually creates the .dmg already; this helper exists for
# the universal build where the target directory differs, and for repackaging
# after manual changes to the app.
set -uo pipefail

cd "$(dirname "$0")"

APP="$(find src-tauri/target -type d -name "RBuilder.app" -path "*release/bundle/macos*" 2>/dev/null | head -1 || true)"
if [[ -z "$APP" ]]; then
  APP="$(find src-tauri/target -type d -name "RBuilder.app" -path "*release*" 2>/dev/null | head -1 || true)"
fi
if [[ -z "$APP" ]]; then
  printf "[ERROR] RBuilder.app not found. Run build-rbuilder-mac.command first.\n"
  exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "0.1.0")"
ARCH_TAG="$(uname -m)"
OUT="RBuilder_${VERSION}_macOS_${ARCH_TAG}.dmg"
DMG_DIR="$(mktemp -d)"
trap 'rm -rf "$DMG_DIR"' EXIT

printf "Packaging %s -> %s\n" "$APP" "$OUT"
mkdir -p "$DMG_DIR/RBuilder"
cp -R "$APP" "$DMG_DIR/RBuilder/"
ln -s /Applications "$DMG_DIR/Applications"

rm -f "$OUT"
hdiutil create -volname "RBuilder" \
  -srcfolder "$DMG_DIR" \
  -ov -format UDZO \
  "$OUT"

printf "\n[OK] Created %s\n" "$OUT"
printf "Share this file - the recipient drags RBuilder into Applications.\n"
