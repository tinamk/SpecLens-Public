# ADR-0004: Hosted SaaS control plane, runner plane, and dual licensing

## Status

Accepted

## Milestone / Iteration

`docs/iterations/ITERATION-004-hosted-saas.md`

## Context

SpecLens needs to evolve from a local-first analysis toolkit into a hosted SaaS with a clear product boundary, isolated analysis execution, persistent storage, user auth, pricing, and explicit licensing terms.

## Decision

SpecLens will adopt:

- a Next.js web app for the hosted product surface
- a Fastify API control plane
- a separate runner plane on DigitalOcean droplets for Docker sandbox execution
- PostgreSQL for product state and pg-boss-compatible job orchestration
- S3-compatible object storage for persistent artifacts
- Keycloak for identity
- Stripe for self-serve Pro billing
- GitHub App integration for private GitHub repositories
- a dual-license model:
  - source-available non-commercial license for the codebase
  - separate commercial license path for companies

## Consequences

- Positive:
  - hosted SaaS pricing and code-license terms become explicit
  - the control plane and runner plane can scale independently
  - product UX, billing, and private-repo flows have a coherent architecture
- Negative:
  - the active product surface becomes significantly larger and more operationally complex
  - true production readiness still depends on wiring real third-party credentials and infrastructure
- Follow-up:
  - replace local/in-memory app state with full PostgreSQL-backed repositories
  - wire real Keycloak, Stripe, GitHub App, S3-compatible object storage, and pg-boss adapters
  - harden deployment configuration for production

## Implementation

- [x] Add hosted `web`, `api`, and `runner` app scaffolding
- [x] Add contracts, DB schema, and shared UI packages
- [x] Add pricing/legal/commercial pages and dual-license files
- [x] Add DigitalOcean deployment scaffolding
- [ ] Finish production-grade persistence and real third-party integrations
