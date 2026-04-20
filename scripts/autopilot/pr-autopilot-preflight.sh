#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
STATUS_FILE_REL=".hermes/pr-autopilot/status.json"

filtered_dirty_output() {
  git -C "$REPO_MAIN" status --short --untracked-files=all | grep -F -v " $STATUS_FILE_REL" || true
}

printf 'Checking repo cleanliness for autopilot startup...\n'
printf 'Repo: %s\n\n' "$REPO_MAIN"
printf 'Ignoring runtime state path: %s\n\n' "$STATUS_FILE_REL"

DIRTY_OUTPUT="$(filtered_dirty_output)"

if [ -n "$DIRTY_OUTPUT" ]; then
  printf 'FAIL: repository is dirty. Commit, stash, or clean these paths first:\n'
  printf '%s\n' "$DIRTY_OUTPUT"
  exit 20
fi

printf 'OK: repository is clean and safe for autopilot startup.\n'
