#!/usr/bin/env bash
set -euo pipefail

: "${CODEX_VERSION:?CODEX_VERSION is required}"
: "${TARGETARCH:?TARGETARCH is required}"

case "${TARGETARCH}" in
  amd64)
    CODEX_PLATFORM_PACKAGE="@openai/codex-linux-x64@npm:@openai/codex@${CODEX_VERSION}-linux-x64"
    ;;
  arm64)
    CODEX_PLATFORM_PACKAGE="@openai/codex-linux-arm64@npm:@openai/codex@${CODEX_VERSION}-linux-arm64"
    ;;
  *)
    echo "Unsupported Docker target architecture: ${TARGETARCH}" >&2
    exit 1
    ;;
esac

apt-get update
apt-get install -y --no-install-recommends \
  bash \
  bubblewrap \
  ca-certificates \
  coreutils \
  curl \
  docker.io \
  docker-compose \
  git \
  less \
  openssh-client \
  procps \
  python3 \
  python3-pip \
  ripgrep \
  unzip
npm install -g "@openai/codex@${CODEX_VERSION}" "${CODEX_PLATFORM_PACKAGE}"
npm cache clean --force
rm -rf /var/lib/apt/lists/*
