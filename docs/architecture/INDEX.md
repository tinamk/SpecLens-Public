# Architecture Index

SpecLens architecture docs are living documentation.

If a change affects service boundaries, auth, queues, workers, storage, deployment shape, or the core data model, update the relevant files in `docs/architecture/` in the same change set.

## Overview

| Doc | Purpose |
|---|---|
| `docs/architecture/system-overview.md` | Top-level product and service architecture |
| `docs/architecture/auth-and-access.md` | Identity, session, and admin auth flows |
| `docs/architecture/job-execution.md` | Queueing, dispatch, and job lifecycle |
| `docs/architecture/ai-agent-runtime.md` | AI worker, Codex execution, and role pipeline |
| `docs/architecture/data-model.md` | Core domain entities and persistence model |
| `docs/architecture/local-dev-stack.md` | Local Docker Compose topology and request routing |
| `docs/architecture/governance-and-delivery-cycle.md` | How iterations, issues, ADRs, runbooks, playbooks, and validation fit together |

## Maintenance Rules

- Update these docs when adding or removing a runtime service.
- Update these docs when changing auth providers, public URLs, or callback flows.
- Update these docs when changing queue names, job routing, or worker ownership.
- Update these docs when changing the report schema or major database entities.
- Update these docs when changing the local or production deployment topology.

## Suggested Reading Order

1. `docs/architecture/system-overview.md`
2. `docs/architecture/job-execution.md`
3. `docs/architecture/ai-agent-runtime.md`
4. `docs/architecture/auth-and-access.md`
5. `docs/architecture/data-model.md`
6. `docs/architecture/local-dev-stack.md`
7. `docs/architecture/governance-and-delivery-cycle.md`
