# ADR-0005: Behavioral parity on hosted TypeScript architecture

## Status

Accepted

## Context

The archived SpecLens implementation contained a wider set of practical analyzers and browser-driven workflows than the new hosted TypeScript product. Reintroducing those capabilities by reviving the archived JS runtime would undermine the hosted architecture and keep the product split between two execution models.

## Decision

SpecLens will restore archived analysis breadth through behavioral parity, not architectural rollback.

The active hosted product remains the source of truth:

- `apps/web` for portal and report UX
- `apps/api` for orchestration and product API
- `apps/runner` for sandbox execution
- `packages/core` for migrated analyzers and capability registry
- `packages/contracts` for normalized job/report/public-interface types

Archived behaviors are reintroduced as presets and capabilities on the new core:

- generic and node-repo presets for default static analysis
- svelte-web, tagtwo, and client-legacy presets for domain-heavy historical behavior
- normalized report sections rather than old per-tool report schemas
- workspace secrets for protected browser analysis
- sandbox browser execution against repo copies rather than mutating the original target checkout

Hosted parity takes priority over local CLI parity.

## Consequences

Positive:

- one active architecture for future product work
- capability growth without reviving the archived JS toolchain
- clearer API/report model for hosted workflows

Negative:

- parity must be validated behaviorally, not by simple file-for-file reuse
- production queue/container orchestration still needs hardening around the now-live browser execution path

## Iteration

Adopted in `docs/iterations/ITERATION-005-behavioral-parity-migration.md`.
