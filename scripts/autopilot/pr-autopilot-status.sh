#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pr-autopilot-common.sh"
STATUS_FILE="$REPO_MAIN/$STATUS_FILE_REL"
PLAN_FILE="$REPO_MAIN/$PLAN_FILE_REL"
HISTORY_FILE="$REPO_MAIN/$HISTORY_FILE_REL"
WORKTREE_DIR="${SPECLENS_AUTOPILOT_WORKTREE:-${REPO_MAIN}-autopilot}"
SERVICE_NAME="${SPECLENS_AUTOPILOT_SERVICE_NAME:-speclens-pr-autopilot.service}"

printf 'Repo: %s\n' "$REPO_MAIN"
printf 'Worktree: %s\n' "$WORKTREE_DIR"
printf 'Status file: %s\n\n' "$STATUS_FILE"
printf 'Plan file: %s\n' "$PLAN_FILE"
printf 'History file: %s\n\n' "$HISTORY_FILE"

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

if [ -f "$PLAN_FILE" ]; then
  printf '\noverarching plan (first 80 lines):\n'
  sed -n '1,80p' "$PLAN_FILE"
fi

if [ -f "$HISTORY_FILE" ]; then
  printf '\nrecent history entries:\n'
  tail -n 10 "$HISTORY_FILE"
fi

if [ -d "$WORKTREE_DIR/.git" ] || [ -f "$WORKTREE_DIR/.git" ]; then
  printf '\nworktree git status:\n'
  git -C "$WORKTREE_DIR" status --short --branch
fi
