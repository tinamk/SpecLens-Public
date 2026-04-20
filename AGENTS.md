# AGENTS.md

## Purpose

SpecLens is now a hosted SaaS product with a dual-license codebase.

Current milestone context:

- Iteration 5 / current path: behavioral parity migration on the hosted TypeScript product
- Iteration 4 / archived transition: hosted SaaS, dual licensing, DigitalOcean deployment shape
- Iteration 3 / archived path: generic local-first productization
- Iteration 2 / archived path: TagTwo-first repo analysis
- Iteration 1 / archived baseline: client visual evidence

## Start Here

- `README.md`
- `docs/FILE_MAP.md`
- `docs/iterations/INDEX.md`
- `docs/issues/INDEX.md`
- `docs/adr/INDEX.md`
- `docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Repo Map

- `apps/web/`: Next.js marketing site, portal, pricing, legal pages, and report views
- `apps/api/`: Fastify API control plane and integration/webhook surface
- `apps/runner/`: queued Docker-runner plane
- `packages/core/`: strict-TypeScript analysis engine
- `packages/contracts/`: shared Zod schemas and product DTOs
- `packages/db/`: Prisma schema and typed DB access
- `packages/ui/`: shared React UI
- `deploy/digitalocean/`: deployment scaffolding
- `archive/legacy-local-first/`: archived reference implementation used for behavior comparison during parity migration
- `archive/legacy-vite-demo/`: archived Vite/React demo app and related browser-test scaffolding

## Core Rules

- Before changing `apps/web`, read the hosted web specs under `specs/speclens/`.
- Before changing `apps/api`, read the hosted API specs under `specs/speclens/`.
- Before changing `apps/runner`, preserve the sandbox isolation model and the queued runner-plane shape.
- Before changing migrated parity behavior, prefer the active TypeScript core and use the archive only as a behavioral reference, not as a runtime dependency.
- Do not add new legacy or compatibility layers to the active hosted product path; prefer replacing transitional fallbacks instead of extending them.
- Before changing licensing or pricing copy, update both the repo legal files and the hosted legal/pricing pages together.
- Treat `.speclens-workspace/` and generated build outputs as runtime data, not source.
- Prefer strict TypeScript for all active product code.
- Keep legacy archive areas isolated unless the task explicitly targets migration or historical evidence.
- Prefer the compact active root over reintroducing new top-level product folders unless they clearly belong beside `apps/`, `packages/`, `deploy/`, or `docs/`.

## Validation

- Safe default: `npm run validate:local`
- Web/API/runner structure: `npm run typecheck`
- API tests: `npm run test`

## Governance

- Use iteration docs for milestone shifts.
- Use issue docs for non-trivial work.
- Use ADRs for architecture, deployment, or licensing rules that are meant to last.
- Repo-owner preference: do not raise tracked `.env` or deployment env credential values as review findings or cleanup tasks unless the user explicitly asks for secret rotation or credential cleanup.

## Git

- Do not commit or push unless the user explicitly asks.
- Keep one commit per logical change set.
