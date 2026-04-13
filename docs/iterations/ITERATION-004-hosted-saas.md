# Iteration 4: Hosted SpecLens SaaS + Dual Licensing

## Status

Active

## Problem Framing

SpecLens had a local-first architecture but no real hosted product surface, no persistent product state, no multi-user auth model, and no pricing/legal separation between hosted SaaS usage and code licensing. That prevented the project from becoming a deployable product.

## Objectives

- Introduce hosted web, API, and runner apps in strict TypeScript.
- Define the DigitalOcean-hosted control plane and runner plane.
- Add pricing, auth, billing, GitHub App, and portal/report product scaffolding.
- Add a formal dual-license model with a non-commercial source-available license and a commercial contact path.

## Artifact Changes

- `apps/web`, `apps/api`, `apps/runner`
- `packages/contracts`, `packages/db`, `packages/ui`
- deployment scaffolding for DigitalOcean
- legal and pricing pages
- top-level dual-license files

## Related Issues

- `docs/issues/hosted-saas-platform.md`

## Related ADRs

- `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`

## Demonstration Plan

- Open the landing page and review pricing/legal separation.
- Start the Fastify API and inspect hosted service endpoints.
- Start the runner process and verify the queued runner-plane skeleton.
- Create a workspace and trigger an analysis flow through the API or portal.

## Evaluation Plan

- Metrics:
  - strict TypeScript compiles across active apps/packages
  - hosted landing page, portal, and legal pages exist
  - API routes exist for workspaces, jobs, reports, billing, and integrations
  - runner plane is scaffolded separately from the control plane
  - dual-license wording is present in repo legal files and product pages
- Validation commands:
  - `npm run validate:local`
  - `npm run typecheck`
  - `npm run test`
- Evidence locations:
  - `.speclens-workspace/`
  - `apps/web/`
  - `apps/api/`
  - `apps/runner/`

## Results

Capture local validation outcomes, demo routes, and deployment follow-up notes here.

## Reflection

Iteration 4 is the product-hosting pivot: the next likely milestone is hardening real Keycloak, Stripe, GitHub App, PostgreSQL, portable S3-compatible object storage, and pg-boss integrations beyond the local scaffold.

## Next Iteration Trigger

Start the next iteration when the hosted scaffold needs production-grade persistence, real webhook handling, or hardened runner orchestration.
