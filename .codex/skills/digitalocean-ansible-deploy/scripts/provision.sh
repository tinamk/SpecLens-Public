#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root_dir"

export ANSIBLE_CONFIG="$root_dir/deploy/digitalocean/ansible/ansible.cfg"
ansible-playbook deploy/digitalocean/ansible/playbooks/provision.yml "$@"
