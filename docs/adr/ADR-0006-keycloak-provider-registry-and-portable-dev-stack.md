# ADR-0006: Keycloak identity, ordered AI providers, and portable dev stack

## Status

Accepted

## Context

The hosted product was originally framed around Auth0, DigitalOcean Spaces, and a single implicit AI path. That made the implementation less portable for self-hosted or local development, and it conflicted with the product goal of running SpecLens flexibly across environments.

## Decision

SpecLens will become:

- Keycloak-first for hosted identity in the active product docs and configuration
- provider-ordered for AI execution, with an explicit list of candidates rather than a single hard-coded path
- portable across S3-compatible object storage backends, including self-hosted endpoints
- runnable in a full local Docker Compose stack for web, API, runner, Postgres, Keycloak, and MinIO

Supporting implications:

- user identity fields move away from Auth0-specific naming
- environment/config names become generic where the implementation no longer depends on one vendor
- OpenAI and OpenAI Codex are configured as ordered provider entries rather than mutually exclusive hard-coded modes
- local development favors realistic service composition over isolated single-process assumptions

## Consequences

Positive:

- less vendor lock-in for identity and object storage
- clearer future path for adding more AI providers
- much stronger local development realism

Negative:

- more configuration surface
- additional local-dev operational complexity
- some remaining production integrations still depend on real provider credentials

## Iteration

Adopted alongside Iteration 5 continuation work and the hosted-platform hardening backlog.
