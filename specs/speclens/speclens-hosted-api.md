# SpecLens Hosted API

## Goal

Define the hosted API control plane surface for Iteration 4.

## Scope (IN)

- user, workspace, source, job, report, billing, and integration routes
- preset, capability, and workspace-secret routes

## Scope (OUT)

- legacy local-only HTTP API

## Definitions (Source of truth)

- **Hosted API**: `apps/api`

## Rules

### R1 - Core routes
1. The API must expose `/health`, `/api/me`, workspace routes, job routes, report routes, billing routes, and integration routes.
2. The API must expose a log streaming route for job output.
3. The API must expose preset and capability discovery routes.
4. The API must allow workspace secret registration for parity runs that need protected browser auth material.
5. Analysis job submission must accept preset, capability, runtime-mode, and secret-reference inputs and pass them through to the hosted analysis core.
6. Browser-oriented runs created through the hosted API must be able to use stored workspace secrets to reach protected routes during sandbox execution.
7. Analysis job submission must return a queued job envelope immediately and expose later completion through the job/report routes.
8. Billing and GitHub integration routes must update hosted app state rather than returning fixed placeholder payloads.

## Acceptance checks
1. `/health` returns success.
2. workspace creation and job submission routes exist.
3. the log stream route exists.
4. preset/capability discovery routes exist.
5. a hosted browser-oriented job can be submitted with a workspace credential secret and return browser self-check sections in the report.
6. a queued job can be polled until it reaches a terminal status.
7. billing checkout plus Stripe/GitHub webhook routes mutate hosted app state in local validation.
