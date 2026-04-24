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

RUNNER_HOST_TEMP_ROOT="${RUNNER_HOST_TEMP_ROOT:-/opt/speclens/runtime/host-temp/runner}"
JOB_DIND_NAME="${JOB_DIND_NAME:-speclens-job-dind}"
JOB_NETWORK="${JOB_NETWORK:-speclens-job}"

mkdir -p "$RUNNER_HOST_TEMP_ROOT"
docker network create "$JOB_NETWORK" >/dev/null 2>&1 || true

docker rm -f "$JOB_DIND_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$JOB_DIND_NAME" \
  --restart unless-stopped \
  --privileged \
  --network "$JOB_NETWORK" \
  -e DOCKER_TLS_CERTDIR="" \
  -v speclens-job-dind-data:/var/lib/docker \
  -v "$RUNNER_HOST_TEMP_ROOT:$RUNNER_HOST_TEMP_ROOT" \
  docker:27-dind \
  dockerd --host=tcp://0.0.0.0:2375 --tls=false

until docker run --rm --network "container:$JOB_DIND_NAME" docker:27-cli sh -lc 'DOCKER_HOST=tcp://127.0.0.1:2375 docker info >/dev/null 2>&1'; do
  sleep 2
done

docker run --rm \
  --network "container:$JOB_DIND_NAME" \
  -v "$REPO_DIR:/workspace" \
  -w /workspace \
  docker:27-cli \
  sh -lc 'DOCKER_HOST=tcp://127.0.0.1:2375 docker build -t speclens/analysis-runner:local -f apps/runner/docker/Dockerfile .'

docker rm -f speclens-runner || true
docker run -d \
  --name speclens-runner \
  --restart unless-stopped \
  --network "$JOB_NETWORK" \
  --env-file "$ENV_FILE" \
  -e RUNNER_ID="runner-$(hostname)" \
  -e DOCKER_HOST="tcp://$JOB_DIND_NAME:2375" \
  -e SANDBOX_IMAGE="speclens/analysis-runner:local" \
  -e RUNNER_TEMP_ROOT="$RUNNER_HOST_TEMP_ROOT" \
  -v "$RUNNER_HOST_TEMP_ROOT:$RUNNER_HOST_TEMP_ROOT" \
  speclens/analysis-runner:local
