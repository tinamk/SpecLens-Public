# Issue: Hosted SaaS platform

## Status

Done

## Milestone / Iteration

`docs/iterations/ITERATION-004-hosted-saas.md`

## Summary

Build the hosted SpecLens SaaS surface, runner-plane architecture, pricing/legal pages, and dual-license repository/legal posture on top of the existing local-first analysis engine.

## Scope

- In scope:
  - hosted web app, API, and runner scaffolding
  - strict-TypeScript monorepo structure
  - pricing, portal, report, and legal pages
  - dual-license repo files and commercial contact path
  - deployment scaffolding for DigitalOcean
- Out of scope:
  - fully production-ready third-party secrets and infrastructure wiring
  - replacing every local scaffold with live managed-service integrations in one pass

## Context

- Relevant specs:
  - `specs/speclens/speclens-hosted-web.md`
  - `specs/speclens/speclens-hosted-api.md`
  - `specs/speclens/speclens-runner-plane.md`
- Relevant files:
  - `apps/web/`
  - `apps/api/`
  - `apps/runner/`
  - `LICENSE`
  - `LICENSE-COMMERCIAL.md`
- Related ADRs:
  - `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`

## Plan

- [x] Add hosted web, API, and runner app scaffolding.
- [x] Add strict-TypeScript shared contracts, DB schema, and shared UI package.
- [x] Add pricing, legal, commercial, portal, and report experience scaffolding.
- [x] Add dual-license repository files and hosted legal messaging.
- [x] Finish validation and note the remaining production-integration gaps.
- [x] Compact the repo by archiving legacy local-first and Vite-demo surfaces out of the active root.

## Validation

- Command: `npm run validate:local`
- Result: Passed on 2026-04-13 after the hosted SaaS scaffold cleanup and root-structure compaction.
- Command: `npm run db:generate`
- Result: Passed on 2026-04-13.
- Command: `npm run typecheck`
- Result: Passed on 2026-04-13.
- Command: `npm run test`
- Result: Passed on 2026-04-13.

## Notes

- The hosted SaaS scaffold is now production-shaped for Local + Compose, with durable queueing, runner isolation, billing, and integration flows wired behind provider configuration.
- Legacy Vite/demo assets, earlier JS package surfaces, archived reports, and old TagTwo/client tooling were moved under `archive/legacy-vite-demo/` and `archive/legacy-local-first/` so the live root now reflects the current hosted product shape.
