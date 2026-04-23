# Issue: AI agent role contract hardening

## Status

Implemented

## Milestone / Iteration

`docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Make seeded AI-agent roles more deterministic by giving every role an explicit output contract and making report quality reflect whether the expected role section and required structured data were produced.

## Scope

- In scope:
  - define canonical output contracts for seeded roles
  - inject the role contract into Codex prompts
  - canonicalize simple single-section role outputs to the expected section title
  - add report-level role contract audit data
  - score roles against contract readiness instead of any arbitrary section
- Out of scope:
  - changing the queue ownership model
  - replacing the current Codex CLI execution provider

## Context

- Relevant files:
  - `apps/ai-worker/src/services/worker.ts`
  - `tests/ai-worker.test.ts`
  - `docs/architecture/ai-agent-runtime.md`
- Related ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Plan

- [x] Add canonical role output contracts for every seeded role.
- [x] Include the contract in each role prompt.
- [x] Preserve deterministic report shape by canonicalizing obvious single-section outputs.
- [x] Add `Role contract audit` report section data.
- [x] Make quality role scores use contract readiness.
- [x] Cover prompt contract injection and contract audit output in AI-worker tests.

## Validation

- Command: `npm run lint`
- Result: Passed on 2026-04-23.
- Command: `node --import tsx --test tests/ai-worker.test.ts`
- Result: Passed on 2026-04-23.
- Command: `npm run typecheck`
- Result: Passed on 2026-04-23.
- Command: `npm run build`
- Result: Passed on 2026-04-23.

## Notes

- A role is no longer considered fully ready just because it emitted any section.
- The worker records missing required data keys in contract audit data and quality scorecard warnings.
