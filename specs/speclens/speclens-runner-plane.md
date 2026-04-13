# SpecLens Runner Plane

## Goal

Define the isolated hosted runner-plane shape for Iteration 4.

## Scope (IN)

- queued runner process
- Docker sandbox execution model
- artifact handoff expectations

## Scope (OUT)

- App Platform control plane

## Definitions (Source of truth)

- **Runner plane**: `apps/runner`

## Rules

### R1 - Separation
1. The runner plane must remain separate from the web/API control plane.
2. The runner plane must preserve a Docker sandbox execution model.
3. The system must support queued job claiming semantics even when local validation uses an in-process queue fallback.

## Acceptance checks
1. A dedicated runner process exists in `apps/runner`.
2. The runner plane has container-image scaffolding.
3. The hosted product can validate queued job execution semantics without requiring the archived runtime.
