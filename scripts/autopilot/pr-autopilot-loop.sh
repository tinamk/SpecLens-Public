#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pr-autopilot-common.sh"
WORKTREE_DIR="${SPECLENS_AUTOPILOT_WORKTREE:-${REPO_MAIN}-autopilot}"
BRANCH="${SPECLENS_AUTOPILOT_BRANCH:-autopilot/speclens}"
HERMES="${HERMES_BIN:-$HOME/.local/bin/hermes}"
PROMPT_FILE="$REPO_MAIN/.hermes/agents/speclens-pr-autopilot.prompt.md"
STATE_DIR="$REPO_MAIN/.hermes/pr-autopilot"
STATUS_FILE="$STATE_DIR/status.json"
PLAN_FILE="$STATE_DIR/OVERARCHING-PLAN.md"
HISTORY_FILE="$STATE_DIR/history.ndjson"
LOG_DIR="$STATE_DIR/logs"
LOOP_LOG="$LOG_DIR/loop.log"
INTERVAL_SECONDS="${SPECLENS_AGENT_INTERVAL_SECONDS:-60}"
BACKOFF_SECONDS="${SPECLENS_AGENT_BACKOFF_SECONDS:-120}"
DIRTY_REPO_EXIT_CODE=20

mkdir -p "$STATE_DIR" "$LOG_DIR" "$REPO_MAIN/.hermes/agents"
touch "$PLAN_FILE" "$HISTORY_FILE"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$msg" | tee -a "$LOOP_LOG"
}

resolve_hermes() {
  if [ -x "$HERMES" ]; then
    printf '%s\n' "$HERMES"
    return 0
  fi

  if command -v hermes >/dev/null 2>&1; then
    command -v hermes
    return 0
  fi

  return 1
}

write_status() {
  local state="$1"
  local summary="$2"
  local head=""
  if [ -d "$WORKTREE_DIR/.git" ] || [ -f "$WORKTREE_DIR/.git" ]; then
    head="$(git -C "$WORKTREE_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  python3 - <<'PY' "$STATUS_FILE" "$state" "$summary" "$BRANCH" "$WORKTREE_DIR" "$head"
import json, sys, datetime
status_file, state, summary, branch, worktree, head = sys.argv[1:]
payload = {
    "state": state,
    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "summary": summary,
    "branch": branch,
    "worktree": worktree,
    "head": head,
    "evidence": [],
    "next_steps": [],
    "blockers": [],
}
with open(status_file, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
PY
}

notify() {
  local body="$1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "SpecLens PR autopilot" "$body" >/dev/null 2>&1 || true
  fi
}

ensure_main_repo_clean() {
  local dirty_output
  dirty_output="$(filtered_dirty_output)"
  if [ -n "$dirty_output" ]; then
    log "Refusing to start: repository is dirty after ignoring runtime state under $RUNTIME_DIR_REL/. Commit, stash, or clean these paths first:"
    while IFS= read -r line; do
      [ -n "$line" ] && log "  $line"
    done <<< "$dirty_output"
    write_status "blocked" "Refusing to start because the main repository is dirty. Commit, stash, or clean changes before running autopilot."
    notify "Blocked: repository is dirty; autopilot did not start"
    return "$DIRTY_REPO_EXIT_CODE"
  fi
}

ensure_worktree() {
  if [ -d "$WORKTREE_DIR/.git" ] || [ -f "$WORKTREE_DIR/.git" ]; then
    return 0
  fi

  log "Creating dedicated worktree at $WORKTREE_DIR on branch $BRANCH"
  git -C "$REPO_MAIN" fetch --all --prune >/dev/null 2>&1 || true

  if git -C "$REPO_MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$REPO_MAIN" worktree add "$WORKTREE_DIR" "$BRANCH" >>"$LOOP_LOG" 2>&1
  elif git -C "$REPO_MAIN" show-ref --verify --quiet refs/remotes/origin/main; then
    git -C "$REPO_MAIN" worktree add -b "$BRANCH" "$WORKTREE_DIR" origin/main >>"$LOOP_LOG" 2>&1
  else
    git -C "$REPO_MAIN" worktree add -b "$BRANCH" "$WORKTREE_DIR" main >>"$LOOP_LOG" 2>&1
  fi
}

reset_worktree_to_head() {
  if [ -d "$WORKTREE_DIR/.git" ] || [ -f "$WORKTREE_DIR/.git" ]; then
    git -C "$WORKTREE_DIR" reset --hard HEAD >>"$LOOP_LOG" 2>&1 || true
    git -C "$WORKTREE_DIR" clean -fd >>"$LOOP_LOG" 2>&1 || true
  fi
}

run_pass() {
  local hermes_bin
  hermes_bin="$(resolve_hermes)"
  ensure_worktree
  reset_worktree_to_head
  write_status "working" "Starting autonomous pass in dedicated PR worktree."
  log "Starting autonomous pass in $WORKTREE_DIR"
  (
    cd "$WORKTREE_DIR"
    "$hermes_bin" --yolo chat -q "$(cat "$PROMPT_FILE")"
  ) >>"$LOOP_LOG" 2>&1
  log "Autonomous pass finished successfully"
  notify "Autonomous pass finished. See $STATUS_FILE"
}

if ! resolve_hermes >/dev/null 2>&1; then
  log "Hermes binary not found. Set HERMES_BIN or install hermes in PATH."
  write_status "blocked" "Hermes binary not found. Set HERMES_BIN or install hermes in PATH."
  exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
  log "Missing prompt file: $PROMPT_FILE"
  write_status "blocked" "Missing prompt file: $PROMPT_FILE"
  exit 1
fi

if [ ! -f "$STATUS_FILE" ]; then
  write_status "working" "Initialized PR-only autopilot status file."
fi

if ! ensure_main_repo_clean; then
  rc=$?
  exit "$rc"
fi

while true; do
  if run_pass; then
    sleep "$INTERVAL_SECONDS"
  else
    rc=$?
    log "Pass failed with exit code $rc. Resetting worktree and backing off for ${BACKOFF_SECONDS}s."
    reset_worktree_to_head
    write_status "blocked" "Autonomous pass failed with exit code $rc. See loop log for details."
    notify "Autonomous pass failed with exit code $rc"
    sleep "$BACKOFF_SECONDS"
  fi
done
