# Docker Compose Dev Stack

This repo ships a full local hosted-development stack via `docker-compose.yml`.

Services:

- `web`: Next.js marketing site and portal on `http://localhost:3000`
- `api`: Fastify API on `http://localhost:4000`
- `runner`: runner health endpoint on `http://localhost:4510`
- `postgres`: app and Keycloak database host on `localhost:5432`
- `keycloak`: OIDC provider on `http://localhost:8081`
- `minio`: S3-compatible object storage on `http://localhost:9000`
- `minio` console: `http://localhost:9001`

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

Notes:

- The Compose stack uses a public Keycloak issuer URL for browser redirects and an internal issuer URL for server-to-server token exchange.
- The Compose stack uses MinIO as a self-hosted S3-compatible backend by default. To use an external S3-compatible provider, update the `OBJECT_STORAGE_*` variables in `.env` (bucket, endpoint, region, access keys).
- To mirror uploads/artifacts to a second provider in parallel, set `OBJECT_STORAGE_MIRROR_*`. Downloads race both providers and take the first success. Optionally require the mirror with `OBJECT_STORAGE_MIRROR_REQUIRED=true`.
- The hosted API now persists jobs in PostgreSQL, publishes them through `pg-boss`, and the runner claims them from the queue.
- The API seeds stable local E2E users on startup so the browser suite can cover owner/member/outsider ACL behavior without a billing prerequisite.
- The runner service is built from the sandbox image and mounts the host Docker socket so it can launch one-shot analysis containers locally.
