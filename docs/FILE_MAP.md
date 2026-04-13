# File Map

This map reflects the Iteration 5 hosted SaaS + behavioral parity layout.

## Apps

| Path | Purpose |
|---|---|
| `apps/web/` | Next.js marketing site, portal, pricing, legal pages, and report UI |
| `apps/api/` | Fastify control plane, API routes, webhooks, and hosted service integrations |
| `apps/runner/` | Runner process for queued Docker sandbox jobs |

## Packages

| Path | Purpose |
|---|---|
| `packages/core/` | Shared strict-TypeScript analysis engine |
| `packages/contracts/` | Zod schemas and typed contracts for presets, capabilities, jobs, secrets, and reports |
| `packages/db/` | Prisma schema and typed database access |
| `packages/ui/` | Shared React components for hosted pages |

## Deployment

| Path | Purpose |
|---|---|
| `deploy/digitalocean/` | App Platform and runner deployment scaffolding |
| `apps/runner/docker/` | Runner image scaffolding |

## Legal and pricing

| Path | Purpose |
|---|---|
| `LICENSE` | Source-available non-commercial code license |
| `LICENSE-COMMERCIAL.md` | Commercial licensing overview and contact path |
| `apps/web/app/license/` | Hosted legal explanation of the dual-license model |
| `apps/web/app/commercial/` | Commercial-license contact path |
| `apps/web/app/pricing/` | Hosted SaaS pricing |

## Docs and governance

| Path | Purpose |
|---|---|
| `docs/iterations/ITERATION-004-hosted-saas.md` | Archived hosted SaaS pivot iteration |
| `docs/iterations/ITERATION-005-behavioral-parity-migration.md` | Current iteration doc |
| `docs/issues/behavioral-parity-migration.md` | Active parity migration tracker |
| `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md` | Iteration 5 architecture ADR |
| `docs/archive/` | Archived root planning docs |

## Archive

| Path | Purpose |
|---|---|
| `archive/` | Archive guide and legacy material index |
| `archive/legacy-local-first/` | Archived TagTwo/client tooling, reports, JS package surfaces, and earlier specs |
| `archive/legacy-vite-demo/` | Archived Vite demo app, browser-test scaffolding, and placeholder backend |
