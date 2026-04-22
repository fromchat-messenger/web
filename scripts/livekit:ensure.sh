#!/usr/bin/env bash
# Ensures a LiveKit server binary is available (downloads from GitHub on Linux/Windows;
# on macOS runs `brew install livekit` if needed — see scripts/livekit/ensure.py).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
exec python3 "$ROOT/scripts/livekit/ensure.py"
