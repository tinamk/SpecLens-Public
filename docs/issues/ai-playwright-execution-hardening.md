# Issue: AI Playwright execution hardening

## Status

Implemented

## Milestone / Iteration

`docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Make the hosted AI worker's Playwright path more deterministic by detecting repo-native wrapper scripts, clearing stale repo-side report outputs before execution, persisting validation logs as artifacts, and treating optional Playwright outputs as advisory rather than release-blocking gaps.

## Scope

- In scope:
  - detect Playwright wrapper scripts that shell out through repo-local helper files
  - keep Playwright preflight/report paths repo-relative in persisted report data
  - clear stale `playwright-report/` and `test-results/` directories before repository-native suite execution
  - persist Playwright preflight/command logs into the hosted artifact pipeline
  - make artifact analysis respect `required: false`
- Out of scope:
  - replacing the Codex-based role execution provider
  - changing the queue ownership model or runner/worker split

## Context

- Relevant files:
  - `apps/ai-worker/src/services/worker.ts`
  - `packages/core/src/reporting.ts`
  - `tests/ai-worker.test.ts`
  - `docs/architecture/ai-agent-runtime.md`
- Related ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Plan

- [x] Detect Playwright wrapper scripts instead of relying only on literal `playwright test` package-script bodies.
- [x] Keep Playwright working-directory/config metadata repo-relative in persisted report sections.
- [x] Clear stale repo-native Playwright outputs before artifact capture so copied reports are run-scoped.
- [x] Persist Playwright validation logs into the artifact pipeline and classify them as validation logs.
- [x] Make artifact-gap scoring ignore optional Playwright outputs.
- [x] Cover wrapper-script detection and optional artifact handling with AI-worker regression tests.

## Validation

- Command: `node --import tsx --test tests/ai-worker.test.ts`
- Result: Passed on 2026-04-23.
- Command: `npm run typecheck`
- Result: Passed on 2026-04-23.
- Command: `npm run validate:local`
- Result: Passed on 2026-04-23.

## Notes

- The worker now captures a deterministic Playwright validation trail even when the repo uses wrapper scripts like `node scripts/e2e/run-*.mjs`.
- Optional artifact expectations such as `playwright-report` and `test-results` no longer degrade report quality when they are not produced.
