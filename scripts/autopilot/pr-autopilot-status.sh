#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
STATUS_FILE="$REPO_MAIN/.hermes/pr-autopilot/status.json"
WORKTREE_DIR="${SPECLENS_AUTOPILOT_WORKTREE:-${REPO_MAIN}-autopilot}"
SERVICE_NAME="${SPECLENS_AUTOPILOT_SERVICE_NAME:-speclens-pr-autopilot.service}"

printf 'Repo: %s\n' "$REPO_MAIN"
printf 'Worktree: %s\n' "$WORKTREE_DIR"
printf 'Status file: %s\n\n' "$STATUS_FILE"

if command -v systemctl >/dev/null 2>&1; then
  printf 'systemd service (%s):\n' "$SERVICE_NAME"
  systemctl --user status --no-pager "$SERVICE_NAME" || true
  printf '\n'
fi

if [ -f "$STATUS_FILE" ]; then
  printf 'status.json:\n'
  python3 -m json.tool "$STATUS_FILE"
else
  printf 'status.json not found yet.\n'
fi

if [ -d "$WORKTREE_DIR/.git" ] || [ -f "$WORKTREE_DIR/.git" ]; then
  printf '\nworktree git status:\n'
  git -C "$WORKTREE_DIR" status --short --branch
fi
