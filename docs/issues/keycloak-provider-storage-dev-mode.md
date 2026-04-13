# Issue: Keycloak, provider registry, storage portability, and full dev mode

## Status

In progress

## Milestone / Iteration

- `docs/iterations/ITERATION-004-hosted-saas.md`
- `docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Replace Auth0-specific assumptions with Keycloak-first identity, introduce an ordered AI-provider registry with OpenAI Codex support, make object storage portable across hosted and self-hosted S3-compatible endpoints, and add a full Docker Compose development mode.

## Scope

- In scope:
  - Keycloak-first env/config, login/callback flow, and local dev support
  - ordered AI-provider registry and OpenAI Codex support
  - self-hosted S3-compatible storage config and local dev MinIO support
  - Docker Compose development stack for web, API, runner, Postgres, Keycloak, and MinIO
- Out of scope:
  - production-ready third-party deployment credentials
  - complete live migration from local persisted state to PostgreSQL-backed auth/session state

## Context

- Relevant specs:
  - `specs/speclens/speclens-core-api.md`
  - `specs/speclens/speclens-hosted-api.md`
  - `specs/speclens/speclens-hosted-web.md`
  - `specs/speclens/speclens-runner-plane.md`
- Related ADRs:
  - `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Plan

- [x] Replace Auth0-specific config and terminology with generic identity subject fields plus Keycloak-first settings.
- [x] Add Keycloak-aware web login/callback/logout flow and local dev realm bootstrap.
- [x] Add ordered AI-provider configuration and execution path with OpenAI and OpenAI Codex entries.
- [x] Add object-storage portability for S3-compatible endpoints and local MinIO dev mode.
- [x] Add a full Docker Compose development stack and docs.

## Validation

- Command: `npm run validate:local`
- Result: Passed on 2026-04-13.

## Notes

- The goal is to make the hosted stack portable rather than tied to one identity provider, one AI path, or one storage vendor.
- The hosted web path now includes a same-origin API proxy so browser requests can forward a Keycloak bearer token and keep auth on the active hosted path instead of relying on cross-origin cookies.
- The local development stack was added at `docker-compose.yml` plus `docker/`, but it could not be boot-verified in this execution environment because neither `docker compose` nor `docker-compose` was installed on the machine.
