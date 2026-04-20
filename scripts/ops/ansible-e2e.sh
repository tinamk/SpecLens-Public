#!/usr/bin/env bash
set -euo pipefail

ansible-playbook deploy/digitalocean/ansible/playbooks/e2e.yml "$@"
