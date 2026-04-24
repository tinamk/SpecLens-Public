# Issue Index

Issue docs live here while work is active, closing out, or retained as implementation history.

## Current

| Issue | Status | Summary |
|---|---|---|
| `behavioral-parity-migration.md` | Implemented | Tracks the Iteration 5 migration of archived analysis breadth into the hosted TypeScript product |
| `ai-agent-role-contract-hardening.md` | Implemented | Makes seeded AI roles deterministic with prompt contracts, contract audit data, and contract-aware quality scoring |
| `ai-playwright-execution-hardening.md` | Implemented | Hardens Playwright role detection, run-scoped artifact capture, and optional artifact handling for hosted AI runs |
| `job-execution-artifact-hardening.md` | Implemented | Hardens AI-worker failure/cancellation finalization with durable execution logs and diagnostics artifacts |
| `self-improvement-loop-skill.md` | Implemented | Adds a repo-local skill and helper script for repeated SpecLens-on-SpecLens analysis and remediation cycles |
| `unified-agent-job-sandboxing.md` | Implemented | Moves hosted unified-agent jobs into one-shot Docker sandboxes behind the ai-worker controller and shared nested Docker daemon |
| `hosted-saas-platform.md` | Done | Tracks the Iteration 4 hosted SaaS scaffold, runner plane, pricing/legal pages, and dual-license integration |
| `hosted-web-route-map-ux-audit.md` | Done | Maps the full `apps/web` route surface, diagnoses current IA fragmentation, and proposes a cleaner owner-first route structure |
| `platform-long-task-queue.md` | Done | Long-form backlog of remaining production, integration, UI, and operations work after the hosted parity implementation |
| `keycloak-provider-storage-dev-mode.md` | Done | Tracks the Keycloak-first auth shift, ordered AI providers, S3 portability, and full Docker Compose dev mode |

## Conventions

- Use one issue doc per objective or root cause.
- Update this file when work starts, changes status, or moves to archive.
