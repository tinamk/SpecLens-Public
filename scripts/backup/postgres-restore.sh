#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [ -z "${1:-}" ]; then
  echo "Usage: postgres-restore.sh <backup.sql>" >&2
  exit 1
fi

psql "$DATABASE_URL" < "$1"
echo "Restored $1"
