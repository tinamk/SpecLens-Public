#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root_dir"

ansible-galaxy collection install -r deploy/digitalocean/ansible/requirements.yml

echo "Installed required Ansible collections."
