#!/usr/bin/env bash
# Double-clickable wrapper: environment only.
#
# First run is usually blocked by Gatekeeper because this file came from the
# internet. Approve it once: System Settings -> Privacy & Security ->
# "Open Anyway", or right-click the file -> Open -> Open.
cd "$(dirname "$0")"
exec bash setup-mac.sh "$@"
