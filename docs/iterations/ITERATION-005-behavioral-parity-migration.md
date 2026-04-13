# Iteration 5: Behavioral Parity Migration

## Status

Active

## Problem Framing

The hosted TypeScript product replaced the old local-first architecture, but a large part of the archived analysis surface was not yet available in the active product. That left SpecLens with a cleaner architecture but weaker practical analysis coverage than the archived system.

## Objectives

- Recreate the archived analysis capabilities on the active TypeScript architecture.
- Preserve behavior and user value rather than old internal tool boundaries.
- Make presets, capabilities, runtime mode, and normalized report sections first-class hosted concepts.
- Keep the hosted product as the primary execution surface.

## Artifact Changes

- parity-oriented contracts for presets, capabilities, runtime mode, secrets, findings, and report sections
- migrated capability registry and parity analyzers in `packages/core`
- hosted API support for presets, capabilities, and workspace secrets
- live browser/runtime execution in `packages/core` using sandbox repo copies, runtime boot detection, protected-route auth, crawl screenshots, and interaction passes
- report export and hosted report rendering updated for normalized parity sections
- iteration, ADR, and issue docs for the migration

## Related Issues

- `docs/issues/behavioral-parity-migration.md`
- `docs/issues/hosted-saas-platform.md`

## Related ADRs

- `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`
- `docs/adr/ADR-0004-hosted-saas-control-plane-runner-and-dual-license.md`

## Demonstration Plan

- Submit hosted analysis jobs with explicit presets and capability sets.
- Inspect normalized parity sections in the report output.
- Verify workspace secret support for browser-oriented parity runs.
- Export a report/patch bundle from a parity run.

## Evaluation Plan

- Metrics:
  - presets and capabilities are exposed through the hosted API
  - parity reports include normalized sections for archived capability families
  - browser-oriented presets switch runs into `browser` runtime mode
  - workspace secrets can be registered and referenced by runs
- Validation commands:
  - `npm run validate:local`
  - `npm run typecheck`
  - `npm run test`
- Evidence locations:
  - `.speclens-workspace/`
  - `packages/core/`
  - `apps/api/`
  - `apps/web/`

## Results

- Hosted parity now covers both static and browser-heavy archived capability families through the active TypeScript core.
- Browser runs boot a sandbox copy of the target repo, preserve read-only treatment of the original source, and can use stored credential/session secrets for protected coverage.
- Validation passed with `npm run validate:local`, including end-to-end browser parity tests against a bootable local fixture app.

## Reflection

Iteration 5 shifts SpecLens from “hosted scaffold” to “hosted product with restored analysis breadth.” The next likely step is AI-provider hardening and production queue/container wiring, because the capability surface itself is now live on the active architecture.
