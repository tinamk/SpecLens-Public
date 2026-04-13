# Issue: Platform long task queue

## Status

Active

## Milestone / Iteration

- `docs/iterations/ITERATION-004-hosted-saas.md`
- `docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Track the remaining work needed to move SpecLens from a locally validated hosted prototype into a production-grade multi-user SaaS with durable infrastructure, provider-backed integrations, and a polished portal experience.

## Scope

- In scope:
  - remaining control-plane, runner-plane, data, integration, UI, deployment, security, and operations work
  - explicit split between completed local-product work and still-open production work
- Out of scope:
  - archived local-first runtime restoration

## Context

- Relevant specs:
  - `specs/speclens/speclens-core-api.md`
  - `specs/speclens/speclens-hosted-api.md`
  - `specs/speclens/speclens-hosted-web.md`
  - `specs/speclens/speclens-runner-plane.md`
- Related issues:
  - `docs/issues/hosted-saas-platform.md`
  - `docs/issues/behavioral-parity-migration.md`
- Related ADRs:
  - `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Long task queue

### 1. Control plane and orchestration

- [x] Add queued job lifecycle with `queued` -> `running` -> `succeeded/failed` states in the hosted API.
- [x] Persist lifecycle logs on queued jobs and expose them through `/api/jobs/:id/logs`.
- [ ] Replace the in-memory API queue with PostgreSQL-backed `pg-boss`.
- [x] Add job retry and cancellation handling for the local hosted queue.
- [x] Add artifact metadata persistence for local hosted runs and expose artifact download routes.
- [ ] Add authenticated multi-process-safe SSE log fanout for long-running jobs.

### 2. Runner plane and sandboxing

- [x] Execute browser-capable analysis from the active TypeScript core against sandbox repo copies.
- [ ] Move browser/runtime execution from API-local process state to dedicated runner worker claims.
- [ ] Run analysis inside the actual Docker sandbox image instead of the current local process fallback.
- [ ] Capture and persist full stdout/stderr runner logs per phase.
- [ ] Harden object-storage mirroring for report artifacts and raw logs in production S3-compatible stores.
- [ ] Add runtime resource limits, timeout enforcement, and cleanup guarantees for failed jobs.

### 3. Persistence and storage

- [ ] Replace file-backed local persistence with Prisma-backed persistence for users, workspaces, sources, secrets, jobs, subscriptions, and GitHub installations.
- [x] Encrypt stored workspace secrets at rest in the local persisted state.
- [ ] Add object-storage-backed upload handling for ZIP/TAR source bundles.
- [x] Add local hosted upload handling for ZIP/TAR bundles.
- [x] Add artifact-reference creation from generated reports, screenshots, logs, and exports.
- [ ] Add workspace-scoped retention and cleanup rules.

### 4. Auth and identity

- [ ] Replace demo-user fallback with real Keycloak session/JWT validation.
- [ ] Add user provisioning and mapping from Keycloak identities into the app database.
- [ ] Add owner/member authorization checks on workspace routes.
- [x] Add protected portal pages that require login in the local hosted web path.
- [x] Add logout/session behavior across the local hosted web path.

### 5. Billing and entitlements

- [x] Replace the billing checkout stub with stateful local checkout-session creation.
- [x] Replace the Stripe webhook stub with local entitlement updates in app state.
- [ ] Replace local checkout-session emulation with real Stripe Checkout session creation.
- [ ] Validate Stripe webhook signatures.
- [ ] Persist billing customers/subscriptions in PostgreSQL.
- [ ] Add downgrade/renewal edge-case handling and workspace entitlement propagation from stored subscription state.

### 6. GitHub integration

- [x] Replace the GitHub install URL stub with workspace-scoped install URLs.
- [x] Replace the GitHub webhook stub with local installation-state updates in app state.
- [ ] Implement GitHub App JWT/auth flows and installation-token acquisition.
- [ ] Validate GitHub webhook signatures.
- [ ] Support private repo source creation from stored installations.
- [ ] Add installation removal/re-sync flows and repo listing.

### 7. Hosted web product

- [x] Replace portal mock data with real API-backed workspace, job, and report data, with mock fallback only for local resilience.
- [x] Add workspace creation and source-creation forms in the Next.js portal.
- [x] Add job polling/live log rendering in the job page.
- [x] Add pricing-to-checkout wiring and keep commercial contact visible.
- [x] Add private/public source gating in the UI based on entitlement.
- [x] Add richer report rendering for screenshots, crawl evidence, and artifacts.

### 8. Analysis depth and AI integrations

- [ ] Restore AI-backed visual review and interaction judgment on the new provider path.
- [ ] Add OpenAI-backed synthesis for spec generation and advisor output where intended.
- [ ] Add provider failure handling and budget/rate-limit controls.
- [ ] Expand preset depth beyond current Node/browser-focused coverage.

### 9. Deployment and operations

- [x] Replace App Platform dev commands in deployment config with production build/start commands.
- [ ] Add DigitalOcean runner droplet bootstrap documentation/scripts.
- [x] Add health/readiness endpoint coverage for the local runner process.
- [ ] Add structured operational logging and request/job correlation ids.
- [ ] Add CI coverage for build, API tests, and browser parity tests in hosted mode.
- [ ] Add backup/migration procedures for PostgreSQL and S3-compatible object storage.

### 10. Security and legal hardening

- [ ] Add webhook-signature verification and secret rotation guidance.
- [ ] Add CSRF/session hardening for hosted auth flows.
- [ ] Add audit logging for billing, membership, source, and integration changes.
- [ ] Add formal privacy/terms text review for the actual implemented data flows.
- [ ] Add explicit commercial-contact handling path beyond static page copy.

## Notes

- This queue separates what is already live in local validation from what still needs true production infrastructure.
- The repo now includes an `APP_STATE_BACKEND=file|prisma` path and Prisma snapshot persistence scaffolding, but the hosted API still defaults to file-backed local state and has not yet switched to database-native request flows.
- The largest current architectural gap is not analyzer coverage anymore; it is durable multi-user infrastructure.
