# Docker Compose Dev Stack

This repo ships a full local hosted-development stack via `docker-compose.yml`.

Services:

- `caddy`: browser-facing entry point on `http://localhost:18080`
- `web`: Next.js marketing site and portal on `http://localhost:13000`
- `api`: Fastify API on `http://localhost:14000`
- `runner`: runner health endpoint on `http://localhost:14510`
- `ai-worker`: AI worker health endpoint on `http://localhost:14520`
- `postgres`: app and Keycloak database host on `localhost:15433`
- `keycloak`: direct OIDC provider access on `http://localhost:18081`
- `minio`: S3-compatible object storage on `http://localhost:19000`
- `minio` console: `http://localhost:19001`

Default local credentials:

- Keycloak admin: `admin` / `admin`
- Keycloak owner user: `owner` / `owner-password`
- Keycloak member user: `member` / `member-password`
- Keycloak outsider user: `outsider` / `outsider-password`
- MinIO: `minioadmin` / `minioadmin`
- PostgreSQL: `postgres` / `postgres`

Quick start:

```bash
cp .env.example .env
npm run dev:compose
```

If you keep multiple SpecLens checkouts on the same machine, let Docker Compose scope the stack by directory name, or set an explicit project name:

```bash
COMPOSE_PROJECT_NAME=speclens-redesign npm run dev:compose
```

To keep local auth working on both `localhost` and a LAN/Tailscale IP at the same time, set `HOST_IP` in `.env` and refresh the dual-host overrides:

```bash
HOST_IP_OVERRIDE=100.69.199.78 ./scripts/local/update-host-ip.sh
docker compose up -d --force-recreate keycloak keycloak-seed api web caddy
```

Notes:

- The local stack now defaults to a distinct host-port profile so it can run alongside `SpecLens-frontend-redesign` without container-name or port collisions.
- The local stack is designed to stay `localhost`-first while also allowing browser access through `http://$HOST_IP:18080` when `HOST_IP` is set.
- The Compose stack uses a public Keycloak issuer URL for browser redirects and an internal issuer URL for server-to-server token exchange.
- The local dev stack intentionally avoids fixed Docker container names so separate checkouts can run side by side without name collisions.
- The Compose stack uses MinIO as a self-hosted S3-compatible backend by default. To use an external S3-compatible provider, update the `OBJECT_STORAGE_*` variables in `.env` (bucket, endpoint, region, access keys).
- To mirror uploads/artifacts to a second provider in parallel, set `OBJECT_STORAGE_MIRROR_*`. Downloads race both providers and take the first success. Optionally require the mirror with `OBJECT_STORAGE_MIRROR_REQUIRED=true`.
- The hosted API now persists jobs in PostgreSQL, publishes them through `pg-boss`, and the runner claims them from the queue.
- The API seeds stable local E2E users on startup so the browser suite can cover owner/member/outsider ACL behavior without a billing prerequisite.
- The runner service is built from the sandbox image and mounts the host Docker socket so it can launch one-shot analysis containers locally.
