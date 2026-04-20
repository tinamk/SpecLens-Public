#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pr-autopilot-common.sh"

printf 'Checking repo cleanliness for autopilot startup...\n'
printf 'Repo: %s\n\n' "$REPO_MAIN"
printf 'Ignoring runtime state directory: %s/\n\n' "$RUNTIME_DIR_REL"

DIRTY_OUTPUT="$(filtered_dirty_output)"

if [ -n "$DIRTY_OUTPUT" ]; then
  printf 'FAIL: repository is dirty. Commit, stash, or clean these paths first:\n'
  printf '%s\n' "$DIRTY_OUTPUT"
  exit 20
fi

printf 'OK: repository is clean and safe for autopilot startup.\n'
