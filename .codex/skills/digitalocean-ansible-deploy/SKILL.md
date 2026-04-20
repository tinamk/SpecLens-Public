---
name: digitalocean-ansible-deploy
description: Use this skill when working on SpecLens DigitalOcean deployment, single-node hosted environments, or Ansible/doctl operational tasks. It is for provisioning, bootstrapping, deploying, verifying, and destroying the current SpecLens architecture on DigitalOcean with Ansible as the primary control surface and doctl as a support/fallback tool.
---

# DigitalOcean Ansible Deploy

## Overview

Use this skill for the committed SpecLens deployment workflow in `deploy/digitalocean/`. The default target is the cheapest viable hosted profile for the current repo: one `ams3` Droplet sized `s-2vcpu-4gb` running web, api, runner, postgres, keycloak, minio, and caddy in Docker Compose.

This is a practical hosted deployment of the current architecture, not a claim that every production-hardening item is complete. Keep the separate runner service/container shape, but remember the repo still has prototype-era queue/runtime gaps documented in `docs/issues/platform-long-task-queue.md`.

## Use This Workflow

1. Check local prerequisites.
2. Install Ansible collections.
3. Validate DigitalOcean auth.
4. Provision cloud resources.
5. Bootstrap the host.
6. Deploy the stack.
7. Verify the stack.
8. Destroy resources when requested.

Prefer the wrapper scripts in `scripts/` over retyping long commands.

## Required Inputs

- A DigitalOcean API token in `DIGITALOCEAN_ACCESS_TOKEN`, `DO_API_TOKEN`, or `DO_SECRET`
- A trusted SSH public key on the controller machine
- A runtime env file at `deploy/digitalocean/env.single-node` or `SPECLENS_ENV_FILE`
- Real domain values for app/api/auth/object storage
- `speclens_ssh_allowed_cidrs` overridden from the empty default before provisioning

## Commands

### 1. Prerequisites

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/check-prereqs.sh
```

### 2. Install collections

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/ansible-install-deps.sh
```

### 3. Optional doctl sanity check

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/doctl-check.sh
```

Use `doctl` for account inspection, fallback cleanup, and operator sanity checks. Do not make it the primary deployment engine if the Ansible module exists.

### 4. Provision

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/provision.sh
```

This should create or reuse:

- the DO project
- the controller SSH key
- the deployment tag
- the firewall
- the single Droplet
- optional DNS records

It also writes `deploy/digitalocean/ansible/inventories/generated/hosts.yml`.

### 5. Bootstrap

Run:

```bash
ansible-playbook deploy/digitalocean/ansible/playbooks/bootstrap.yml
```

### 6. Deploy

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/deploy.sh
```

This syncs the repo to the host, copies the runtime env file, and starts the single-node Compose stack.

### 7. Verify

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/verify.sh
```

Verify both internal ports and public HTTPS routes.

### 8. Destroy

Run:

```bash
.codex/skills/digitalocean-ansible-deploy/scripts/destroy.sh
```

Use this when the user explicitly wants teardown or cost cleanup.
Add `-e speclens_destroy_project=true` if the DO project itself should also be deleted.

## References

- Deployment architecture and current-state caveats: `references/architecture.md`
- Cost posture and default profile: `references/digitalocean-costs.md`
- End-to-end command flow: `references/ansible-workflow.md`
