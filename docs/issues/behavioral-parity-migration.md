# Issue: Behavioral parity migration

## Status

Implemented

## Milestone / Iteration

`docs/iterations/ITERATION-005-behavioral-parity-migration.md`

## Summary

Restore the analysis breadth of the archived SpecLens system inside the active hosted TypeScript architecture so the product regains the same practical analysis families without reviving the old JS runtime shape.

## Scope

- In scope:
  - parity-oriented contracts for presets, capabilities, runtime mode, secrets, findings, and report sections
  - migrated static capability families in the active core
  - hosted API support for presets, capabilities, and workspace secrets
  - normalized report output and export updates for parity runs
  - live sandbox browser execution with runtime boot, protected-route auth support, crawl evidence, screenshots, and interaction passes
- Out of scope:
  - restoring the archived JS CLI or report schemas as the live product interface

## Context

- Relevant specs:
  - `specs/speclens/speclens-core-api.md`
  - `specs/speclens/speclens-hosted-api.md`
  - `specs/speclens/speclens-hosted-web.md`
- Relevant files:
  - `packages/contracts/`
  - `packages/core/`
  - `apps/api/`
  - `apps/web/`
- Related ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`

## Plan

- [x] Add parity-oriented contracts and capability registry.
- [x] Migrate core static capability families into the active TypeScript core.
- [x] Extend hosted API inputs/outputs for presets, capabilities, runtime mode, and workspace secrets.
- [x] Update hosted report rendering/export to use normalized parity sections.
- [x] Add tests that prove parity metadata and capability families flow through the hosted surface.
- [x] Harden browser/runtime execution beyond planned parity sections.

## Validation

- Command: `npm run typecheck`
- Result: Passed on 2026-04-19.
- Command: `npm run test`
- Result: Passed on 2026-04-19.
- Command: `npm run validate:local`
- Result: Passed on 2026-04-19.

## Notes

- This pass restores behavioral breadth and public interfaces first.
- Browser-heavy archived workflows now execute through the active hosted core using a sandbox copy of the target repo, runtime boot detection, secret-backed browser auth, crawl evidence, screenshots, and interaction probes.
- The hosted workspace lifecycle is now closed through the existing portal routes: secret-backed run queueing, owner-managed member add/remove by email, source rename/delete with provenance protection, run cancel/retry, durable report export artifacts, Stripe billing portal entry, and GitHub installation unlink/reconnect.
- Linked GitHub repository inventory is aggregated across all workspace installations, and private-source creation now preserves the selected installation instead of inferring from the first linked installation.
