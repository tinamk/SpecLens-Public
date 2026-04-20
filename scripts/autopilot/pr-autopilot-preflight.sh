#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

printf 'Checking repo cleanliness for autopilot startup...\n'
printf 'Repo: %s\n\n' "$REPO_MAIN"

DIRTY_OUTPUT="$(git -C "$REPO_MAIN" status --short --untracked-files=all)"

if [ -n "$DIRTY_OUTPUT" ]; then
  printf 'FAIL: repository is dirty. Commit, stash, or clean these paths first:\n'
  printf '%s\n' "$DIRTY_OUTPUT"
  exit 20
fi

printf 'OK: repository is clean and safe for autopilot startup.\n'
