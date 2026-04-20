# SpecLens Deployment Shape

The active repo shape is:

- `apps/web`: Next.js marketing and portal surface
- `apps/api`: Fastify control plane
- `apps/runner`: queued runner process
- `packages/core`: shared analysis engine
- `deploy/digitalocean`: deployment scaffolding

The hosted architecture documented in `README.md`, `specs/speclens/speclens-hosted-api.md`, and `specs/speclens/speclens-runner-plane.md` expects:

- web and api as the control-plane surface
- a separate runner plane
- PostgreSQL for product state
- S3-compatible object storage
- Keycloak for identity

For the current cheapest viable path, this repo deploys that shape onto one Droplet while preserving service separation inside Docker Compose:

- `web` container
- `api` container
- `runner` container
- `postgres` container
- `keycloak` container
- `minio` container
- `caddy` reverse proxy

Important current-state caveats:

- The runner remains a separate service, but the repo still has documented production gaps around durable queue claims and sandbox hardening.
- `APP_STATE_BACKEND=file` is the default deploy path because it matches the safest clearly validated hosted flow in the current codebase.
- This deployment is intended to be operationally useful and inexpensive, not a final hardened multi-node production topology.
