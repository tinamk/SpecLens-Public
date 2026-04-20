#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
LOOP_LOG="$REPO_MAIN/.hermes/pr-autopilot/logs/loop.log"

mkdir -p "$(dirname "$LOOP_LOG")"
touch "$LOOP_LOG"

exec tail -n 200 -f "$LOOP_LOG"
