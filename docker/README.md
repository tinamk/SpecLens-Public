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
- Keycloak demo user: `demo` / `demo-password`
- MinIO: `minioadmin` / `minioadmin`
- PostgreSQL: `postgres` / `postgres`

Quick start:

```bash
cp .env.example .env
npm run dev:compose
```

Notes:

- The Compose stack uses a public Keycloak issuer URL for browser redirects and an internal issuer URL for server-to-server token exchange.
- The Compose stack uses MinIO as a self-hosted S3-compatible backend, which exercises the same API surface used for DigitalOcean Spaces or other S3-compatible providers.
- The hosted API still runs the local queue inline today; the runner is included so health and future external-queue work can be developed in the same stack.
