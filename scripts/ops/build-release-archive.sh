#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?usage: build-release-archive.sh <repo-root> <archive-path>}"
archive_path="${2:?usage: build-release-archive.sh <repo-root> <archive-path>}"
release_build_mode="${SPECLENS_RELEASE_BUILD_MODE:-auto}"
release_build_image="${SPECLENS_RELEASE_BUILD_IMAGE:-node:22-bookworm}"
release_platform="${SPECLENS_RELEASE_PLATFORM:-linux/amd64}"

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "SpecLens deploy archive builder requires a git worktree: $repo_root" >&2
  exit 1
fi

dirty_status="$(git -C "$repo_root" status --short --untracked-files=all --ignore-submodules=all)"
if [[ -n "$dirty_status" ]]; then
  printf 'Refusing to build release archive from dirty repo %s. Commit, stash, or clean these paths first:\n%s\n' "$repo_root" "$dirty_status" >&2
  exit 1
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd git
need_cmd tar

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/speclens-release.XXXXXX")"
stage_dir="$work_dir/repo"
npm_cache_dir="$work_dir/npm-cache"
commit_sha="$(git -C "$repo_root" rev-parse HEAD)"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p "$stage_dir" "$npm_cache_dir" "$(dirname "$archive_path")"
git -C "$repo_root" archive HEAD | tar -x -C "$stage_dir"

cat >"$stage_dir/.speclens-release-manifest.json" <<EOF
{
  "commit": "$commit_sha",
  "prepared_with": "scripts/ops/build-release-archive.sh",
  "build_mode": "$release_build_mode",
  "platform": "$release_platform"
}
EOF

assert_prepared_release() {
  local missing=0
  for path in \
    node_modules \
    node_modules/.bin/tsx \
    node_modules/.bin/prisma \
    apps/web/.next/BUILD_ID \
    apps/web/.next/static \
    node_modules/.prisma/client
  do
    if [[ ! -e "$stage_dir/$path" ]]; then
      echo "Prepared release is missing required path: $path" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

prepare_release_with_host_node() {
  need_cmd npm
  if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
    echo "Host-mode release prep is only supported on linux/x86_64. Use docker mode instead." >&2
    exit 1
  fi
  (
    cd "$stage_dir"
    export NEXT_TELEMETRY_DISABLED=1
    export npm_config_cache="$npm_cache_dir"
    npm ci
    npm run db:generate
    npm run web:build
    rm -rf apps/web/.next/cache node_modules/.cache
  )
}

prepare_release_with_docker() {
  need_cmd docker
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but the daemon is unavailable; cannot use docker release prep." >&2
    exit 1
  fi
  docker run --rm \
    --platform "$release_platform" \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e NEXT_TELEMETRY_DISABLED=1 \
    -e npm_config_cache=/tmp/npm-cache \
    -v "$stage_dir:/workspace" \
    -v "$npm_cache_dir:/tmp/npm-cache" \
    -w /workspace \
    "$release_build_image" \
    bash -lc 'npm ci && npm run db:generate && npm run web:build && rm -rf apps/web/.next/cache node_modules/.cache'
}

case "$release_build_mode" in
  docker)
    prepare_release_with_docker
    ;;
  local)
    prepare_release_with_host_node
    ;;
  auto)
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      prepare_release_with_docker
    else
      prepare_release_with_host_node
    fi
    ;;
  *)
    echo "Unsupported SPECLENS_RELEASE_BUILD_MODE: $release_build_mode" >&2
    exit 1
    ;;
esac

assert_prepared_release
tar -czf "$archive_path" -C "$stage_dir" .
