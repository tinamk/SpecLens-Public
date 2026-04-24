# DigitalOcean Deployment Notes

This folder contains single-node deployment artifacts and runner-plane bootstrap helpers.

## Single-node production (all services on one droplet)

1. Copy `env.single-node.example` or `deploy/digitalocean/.env.single-node` to `.env` on the droplet and fill in secrets.
2. Use `docker-compose.single-node.yml` to boot the full stack (web, api, runner, ai-worker, job-dind, postgres, keycloak, minio, caddy). The current Ansible deploy path prepares the Node release locally on the controller first, including `npm ci`, `prisma generate`, and the production Next.js build, then ships that prepared release to the droplet.
3. Ensure DNS for `APP_DOMAIN`, `API_DOMAIN`, `AUTH_DOMAIN`, and `OBJECTS_DOMAIN` points to the droplet.
4. If you are using the single GitHub App gateway flow, also point `GITHUB_GATEWAY_DOMAIN` at the droplet and configure the GitHub App Setup URL / Webhook URL against that host.
5. Access health endpoints on the droplet:
   - API: `curl http://127.0.0.1:4000/ready`
   - Runner: `curl http://127.0.0.1:4510/ready`
   - AI worker: `curl http://127.0.0.1:4520/ready`

6. Validate the hosted stack before production E2E:

```bash
APP_URL=https://<app-domain> \
API_URL=http://127.0.0.1:4000 \
RUNNER_URL=http://127.0.0.1:4510 \
AI_WORKER_URL=http://127.0.0.1:4520 \
npm run ops:validate
```

7. Deploy from a clean committed controller checkout only. The Ansible release packager now refuses tracked or untracked repo changes so unfinished local edits cannot leak into production archives.
8. The droplet still builds the custom `runner` and `ai-worker` Docker images locally, but the application dependency install and `web` production build happen on the controller to keep deploys more deterministic.

9. Run production E2E via Ansible:

```bash
E2E_OWNER_USERNAME=... E2E_OWNER_PASSWORD=... \
E2E_MEMBER_USERNAME=... E2E_MEMBER_PASSWORD=... \
E2E_OUTSIDER_USERNAME=... E2E_OUTSIDER_PASSWORD=... \
ansible-playbook deploy/digitalocean/ansible/playbooks/e2e.yml
```

10. Verify metrics internally (public `/metrics` is blocked by Caddy):

```bash
curl http://127.0.0.1:4000/metrics
curl http://127.0.0.1:4510/metrics
```

## Runner droplet bootstrap

Use the helper script to install Docker and start the runner container:

```bash
sudo bash deploy/digitalocean/runner-bootstrap.sh
```

Set the following in the `.env` referenced by the script before launching the runner:

- `DATABASE_URL`
- `OBJECT_STORAGE_*`
- `RUNNER_*`
- `SANDBOX_*`

The helper starts a dedicated nested Docker daemon, builds the runner sandbox image into it, and points the runner at `DOCKER_HOST=tcp://speclens-job-dind:2375`. The runner container does not mount the host Docker socket.
