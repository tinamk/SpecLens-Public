#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
env_file="${SPECLENS_ENV_FILE:-$root_dir/deploy/digitalocean/env.single-node}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd ansible-playbook
need_cmd ansible-galaxy
need_cmd python3
need_cmd rsync
need_cmd ssh

if [ -n "${DOCTL_OPTIONAL_CHECK:-1}" ] && ! command -v doctl >/dev/null 2>&1; then
  echo "Note: doctl is not installed. That is allowed, but it is recommended for inspection and fallback cleanup." >&2
fi

if [ ! -f "$env_file" ]; then
  echo "Missing runtime env file: $env_file" >&2
  echo "Start from deploy/digitalocean/env.single-node.example" >&2
  exit 1
fi

if [ -z "${DIGITALOCEAN_ACCESS_TOKEN:-${DO_API_TOKEN:-${DO_SECRET:-}}}" ]; then
  echo "Set DIGITALOCEAN_ACCESS_TOKEN, DO_API_TOKEN, or DO_SECRET before deploying." >&2
  exit 1
fi

echo "Prerequisites look good."
