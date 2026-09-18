#!/usr/bin/env bash
# Double-clickable wrapper: environment + checks + Tauri installers (.app/.dmg).
# Gatekeeper note: see install-rbuilder-mac.command.
cd "$(dirname "$0")"
exec bash setup-mac.sh --build "$@"
