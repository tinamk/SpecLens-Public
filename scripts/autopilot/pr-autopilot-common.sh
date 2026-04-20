#!/usr/bin/env bash

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_DIR_REL=".hermes/pr-autopilot"
STATUS_FILE_REL="$RUNTIME_DIR_REL/status.json"
PLAN_FILE_REL="$RUNTIME_DIR_REL/OVERARCHING-PLAN.md"
HISTORY_FILE_REL="$RUNTIME_DIR_REL/history.ndjson"
LOG_DIR_REL="$RUNTIME_DIR_REL/logs"

filter_runtime_status_lines() {
  python3 -c '
import sys

runtime_dir = sys.argv[1]
prefix = f"{runtime_dir}/"

for raw_line in sys.stdin:
    line = raw_line.rstrip("\\n")
    if len(line) < 4:
        continue

    payload = line[3:]
    paths = [segment.strip() for segment in payload.split(" -> ")]
    if paths and all(path == runtime_dir or path.startswith(prefix) for path in paths):
        continue

    print(line)
' "$RUNTIME_DIR_REL"
}

filtered_dirty_output() {
  git -C "$REPO_MAIN" status --short --untracked-files=all | filter_runtime_status_lines || true
}
