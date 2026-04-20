# Ansible Workflow

## Primary entrypoints

- `ansible-playbook deploy/digitalocean/ansible/playbooks/provision.yml`
- `ansible-playbook deploy/digitalocean/ansible/playbooks/bootstrap.yml`
- `ansible-playbook deploy/digitalocean/ansible/playbooks/deploy.yml`
- `ansible-playbook deploy/digitalocean/ansible/playbooks/verify.yml`
- `ansible-playbook deploy/digitalocean/ansible/playbooks/destroy.yml`

## What each playbook owns

- `provision.yml`
  - controller-side DO API work through `digitalocean.cloud`
  - project, tag, SSH key, firewall, droplet, optional DNS, generated inventory
- `bootstrap.yml`
  - remote host package install
  - Docker Engine and Compose plugin
  - base directory layout under `/opt/speclens`
- `deploy.yml`
  - sync repo contents to `/opt/speclens/app/current`
  - copy `deploy/digitalocean/env.single-node`
  - run Docker Compose from `deploy/digitalocean/`
- `verify.yml`
  - confirms the app domain A record points to the deployed droplet public IPv4
  - internal port checks
  - internal health endpoints
  - public HTTPS checks for app/api/auth
- `destroy.yml`
  - firewall teardown
  - droplet teardown
  - optional DNS teardown
  - optional project cleanup via `-e speclens_destroy_project=true`

## Defaults to remember

- region: `ams3`
- size: `s-2vcpu-4gb`
- image: `ubuntu-24-04-x64`
- runtime env file: `deploy/digitalocean/env.single-node`
- inventory output: `deploy/digitalocean/ansible/inventories/generated/hosts.yml`
- default public app domain: `speclens.tinamk.no`

## Support tools

- Use `doctl` for auth sanity checks, inspection, and fallback cleanup.
- Use the committed shell wrappers when the task is straightforward and repo-standard.
