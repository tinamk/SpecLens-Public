# File Map

This map reflects the Iteration 5 hosted SaaS + behavioral parity layout.

## Apps

| Path | Purpose |
|---|---|
| `apps/web/` | Next.js marketing site, portal, pricing, legal pages, and report UI |
| `apps/api/` | Fastify control plane, API routes, webhooks, and hosted service integrations |
| `apps/runner/` | Runner process for queued Docker sandbox jobs |
| `apps/ai-worker/` | Hosted AI job controller, sandbox orchestration, role execution core, and remediation worker |

## Packages

| Path | Purpose |
|---|---|
| `packages/core/` | Shared strict-TypeScript analysis engine |
| `packages/contracts/` | Zod schemas and typed contracts for hosted jobs, reports, code review, remediation, and secrets |
| `packages/db/` | Prisma schema and typed database access |
| `packages/ui/` | Shared React components for hosted pages |

## Deployment

| Path | Purpose |
|---|---|
| `deploy/digitalocean/` | App Platform and runner deployment scaffolding |
| `apps/runner/docker/` | Runner image scaffolding |
| `apps/ai-worker/docker/` | Long-lived AI worker and one-shot hosted agent sandbox image scaffolding |
| `deploy/observability/` | Prometheus scrape + alerting starter config |

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
| `docs/architecture/` | Living architecture diagrams and system structure docs |
| `docs/iterations/ITERATION-004-hosted-saas.md` | Archived hosted SaaS pivot iteration |
| `docs/iterations/ITERATION-005-behavioral-parity-migration.md` | Current iteration doc |
| `docs/issues/behavioral-parity-migration.md` | Active parity migration tracker |
| `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md` | Iteration 5 architecture ADR |
| `docs/thesis/ITERATIONS-001-005-thesis-foundation.md` | Cross-iteration thesis foundation document covering Iterations 1-5 |
| `docs/ops/production-readiness.md` | Production readiness checklist and operator expectations |
| `docs/ops/incident-runbooks.md` | Incident response runbooks for hosted operations |
| `docs/ops/production-smoke-checklist.md` | Go-live smoke checklist for hosted deployments |
| `docs/ops/scaling-guidelines.md` | Scaling guidance for API, runner, and queue |
| `docs/ops/provider-rotation.md` | Provider secret rotation procedures |
| `docs/archive/` | Archived root planning docs |

## Archive

| Path | Purpose |
|---|---|
| `archive/` | Archive guide and legacy material index |
| `archive/legacy-local-first/` | Archived TagTwo/client tooling, reports, JS package surfaces, and earlier specs |
| `archive/legacy-vite-demo/` | Archived Vite demo app, browser-test scaffolding, and placeholder backend |
