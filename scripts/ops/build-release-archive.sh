#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?usage: build-release-archive.sh <repo-root> <archive-path>}"
archive_path="${2:?usage: build-release-archive.sh <repo-root> <archive-path>}"

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "SpecLens deploy archive builder requires a git worktree: $repo_root" >&2
  exit 1
fi

dirty_status="$(git -C "$repo_root" status --short --untracked-files=all --ignore-submodules=all)"
if [[ -n "$dirty_status" ]]; then
  printf 'Refusing to build release archive from dirty repo %s. Commit, stash, or clean these paths first:\n%s\n' "$repo_root" "$dirty_status" >&2
  exit 1
fi

mkdir -p "$(dirname "$archive_path")"
git -C "$repo_root" archive --format=tar.gz --output="$archive_path" HEAD
