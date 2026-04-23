# Issue: Job execution artifact hardening

## Status

Implemented

## Milestone / Iteration

`docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Harden hosted AI-agent execution so role failures, cancellation, and artifact persistence leave durable evidence for the portal and downstream remediation workflows.

## Scope

- In scope:
  - preserve the AI-worker execution timeline at finalization
  - persist a diagnostic artifact for failed and cancelled agent jobs
  - keep role and native-executor step ordering stable in failure paths
- Out of scope:
  - changing queue ownership or moving long-running execution back into the API process

## Context

- Relevant files:
  - `apps/ai-worker/src/services/worker.ts`
  - `packages/db/src/repositories.ts`
  - `docs/architecture/job-execution.md`
- Related ADRs:
  - `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Plan

- [x] Replay in-memory agent logs into success, cancellation, and failure finalization.
- [x] Upload `agent-failure.json` as a `runtime-log` artifact for failed and cancelled agent jobs.
- [x] Ensure failed role steps keep the same order as their running step.
- [x] Cover failed role execution with an AI-worker regression test.

## Validation

- Command: `node --import tsx --test tests/ai-worker.test.ts`
- Result: Passed on 2026-04-23.
- Command: `npm run validate:local`
- Result: Passed on 2026-04-23.

## Notes

- DB log insertion is duplicate-safe, so finalization can replay previously streamed logs without creating duplicate rows.
- The diagnostic artifact includes schema version, job status, failure reason, execution steps, and job logs.
