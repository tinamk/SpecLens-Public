# Issue: self-improvement loop skill

## Status

Implemented

## Milestone / Iteration

`docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Add a repo-local skill for repeatedly dogfooding SpecLens on the SpecLens repo itself, with a deterministic helper that creates or reuses a workspace, imports workspace Codex auth, uploads a committed Git archive, queues hosted analysis or remediation jobs, and downloads logs and artifacts for execution-focused review.

## Scope

- In scope:
  - add a repo-local skill for the SpecLens self-improvement loop
  - provide a deterministic helper for local hosted `analyze` and `remediate` cycles
  - enforce the hosted `ai-worker` controller plus Docker sandbox path during dogfood cycles
  - store downloaded evidence in a stable local runtime directory
  - bias the workflow toward role, skill, tool, artifact, and Playwright execution hardening
- Out of scope:
  - automatically applying remediation patches without review
  - replacing the existing hosted job queue or auth model

## Context

- Relevant files:
  - `.codex/skills/speclens-self-improvement-loop/SKILL.md`
  - `.codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs`
  - `apps/api/src/routes/durable.ts`
  - `packages/db/src/repositories.ts`
  - `docs/architecture/ai-agent-runtime.md`
- Related ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Plan

- [x] Add a repo-local skill that explains the self-improvement loop and its review gate.
- [x] Add a helper script for workspace reuse, auth import, archive upload, analysis queueing, waiting, and artifact download.
- [x] Add remediation queue support that can reuse the prior analysis summary.
- [x] Add sandbox preflight checks for local compose, `job-dind`, seeded runner/agent sandbox images, and host Docker socket removal.
- [x] Add post-run sandbox evidence summaries so successful jobs still fail the loop if sandbox launch/result evidence is missing.
- [x] Track the new workflow in the issue index.

## Validation

- Command: `node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs --help`
- Result: Passed on 2026-04-23.
- Command: `node --check .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs`
- Result: Passed on 2026-04-23.
- Command: `node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs --help`
- Result: Passed on 2026-04-23 after sandbox integration.
- Command: `npm run typecheck`
- Result: Passed on 2026-04-23.

## Notes

- The helper intentionally targets the local hosted stack with `API_AUTH_MODE=local-dev` because that is the lowest-friction path for repeated dogfooding runs.
- Analysis uploads a committed Git archive, which keeps the input deterministic and aligned with the archive verification rules already enforced by the hosted API.
- The helper now treats missing sandbox launch, wait/result collection, or stdout/artifact evidence as a dogfood failure by default. Use `--no-strict-sandbox-evidence` only for intentionally inspecting old or external jobs.
