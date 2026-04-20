#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

exec "$REPO_MAIN/scripts/autopilot/pr-autopilot-loop.sh" "$@"
