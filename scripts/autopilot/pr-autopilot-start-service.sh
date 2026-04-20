#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

"$REPO_MAIN/scripts/autopilot/pr-autopilot-preflight.sh"
systemctl --user start speclens-pr-autopilot.service
systemctl --user status --no-pager speclens-pr-autopilot.service
