#!/usr/bin/env bash
set -euo pipefail

if ! command -v doctl >/dev/null 2>&1; then
  echo "doctl is not installed." >&2
  exit 1
fi

doctl auth list
doctl account get
