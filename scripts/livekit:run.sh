#!/usr/bin/env bash
# Start LiveKit with deployment/livekit.dev.yaml (after ensure.py).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

BIN="$(python3 "$ROOT/scripts/livekit/ensure.py" | tail -1)"
CONFIG="$ROOT/deployment/livekit.dev.yaml"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing $CONFIG" >&2
  exit 1
fi

echo "Starting LiveKit: $BIN --config $CONFIG" >&2
exec "$BIN" --config "$CONFIG"
