#!/usr/bin/env bash
set -euo pipefail

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

npx playwright install --with-deps chromium
npm cache clean --force
chmod -R 755 "${PLAYWRIGHT_BROWSERS_PATH}"
