#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_MAIN="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
SERVICE_SOURCE="$REPO_MAIN/.hermes/systemd/speclens-pr-autopilot.service"
SERVICE_TARGET_DIR="$HOME/.config/systemd/user"
SERVICE_TARGET="$SERVICE_TARGET_DIR/speclens-pr-autopilot.service"

mkdir -p "$SERVICE_TARGET_DIR"
python3 - <<'PY' "$SERVICE_SOURCE" "$SERVICE_TARGET" "$REPO_MAIN"
from pathlib import Path
import sys
source, target, repo = map(Path, sys.argv[1:4])
content = source.read_text(encoding='utf-8').replace('__REPO_MAIN__', str(repo))
Path(target).write_text(content, encoding='utf-8')
PY

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze --user verify "$SERVICE_TARGET"
fi

systemctl --user daemon-reload
printf 'Installed %s from %s\n' "$SERVICE_TARGET" "$SERVICE_SOURCE"
