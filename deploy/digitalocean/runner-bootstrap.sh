#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tinamk/spec-lens.git}"
REPO_DIR="${REPO_DIR:-/opt/speclens}"
ENV_FILE="${ENV_FILE:-/opt/speclens/.env}"

apt-get update -y
apt-get install -y --no-install-recommends git ca-certificates curl

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

mkdir -p "$(dirname "$REPO_DIR")"
if [ ! -d "$REPO_DIR" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "Populate $ENV_FILE with DATABASE_URL, OBJECT_STORAGE_*, and RUNNER_* before starting."
fi

docker build -t speclens/analysis-runner:local -f apps/runner/docker/Dockerfile .

docker rm -f speclens-runner || true
docker run -d \
  --name speclens-runner \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -e RUNNER_ID="runner-$(hostname)" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ${RUNNER_HOST_TEMP_ROOT:-/opt/speclens/runtime/host-temp/runner}:${RUNNER_HOST_TEMP_ROOT:-/opt/speclens/runtime/host-temp/runner} \
  speclens/analysis-runner:local
