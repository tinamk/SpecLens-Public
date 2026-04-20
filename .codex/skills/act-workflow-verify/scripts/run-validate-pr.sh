#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root_dir"

act pull_request -W .github/workflows/speclens-e2e.yml -j validate -e .github/act/pull_request.json "$@"
