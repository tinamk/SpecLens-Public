# Iteration 3: Generic SpecLens Productization

## Status

Active

## Problem Framing

SpecLens had become too tightly coupled to repo-local profiles, tracked report artifacts, and historical TagTwo/client paths. That made the repo harder to maintain and made the product story weaker for arbitrary repositories.

## Objectives

- Ship a reusable analysis engine with a first-class JS API.
- Expose the same product capabilities through a source-centric CLI and HTTP management API.
- Move runtime state into a managed workspace and keep target repos read-only by default.
- Reframe TagTwo/client artifacts as archive/reference rather than the primary product surface.

## Artifact Changes

- Introduce `packages/core`, `packages/cli`, and `packages/http`
- Add `.speclens-workspace/` for runtime cache, runs, generated spec packs, and exports
- Replace the old top-level script sprawl with a smaller source-centric command surface
- Add new stable product specs for the core API, CLI, and HTTP API
- Update governance docs and archive the old active issues

## Related Issues

- `docs/issues/generic-productization-platform.md`

## Related ADRs

- `docs/adr/ADR-0003-generic-productization-architecture.md`

## Demonstration Plan

- Analyze an arbitrary local repo without a repo-local SpecLens config file.
- Analyze a cached git source through the same public API.
- Export a patch bundle from a selected finding without mutating the target repo.
- Inspect the same run via CLI and HTTP.

## Evaluation Plan

- Metrics:
  - local-path analysis succeeds without repo-local config
  - git-source analysis reuses the managed workspace cache
  - runtime outputs no longer touch tracked source files
  - patch export stays read-only for the target repo
- Validation commands:
  - `npm run validate:local`
  - `npm run speclens -- analyze --source ./fixtures/tagtwo-mini --workspace local-smoke`
- Evidence locations:
  - `.speclens-workspace/workspaces/<name>/runs/`
  - `.speclens-workspace/workspaces/<name>/exports/`

## Results

- `npm run validate:local` passed on 2026-04-13.
- `npm run speclens -- analyze --source ./fixtures/tagtwo-mini --workspace local-smoke` passed on 2026-04-13.
- Runtime outputs now land under `.speclens-workspace/` instead of tracked `reports/` artifacts.

## Reflection

Iteration 3 trades backward compatibility for a clearer, more reusable product boundary. The next learning step is how deep the built-in analyzer presets should go beyond the generic baseline and Node/npm-first defaults.

## Next Iteration Trigger

Start the next iteration when SpecLens needs richer background job orchestration, more ecosystems, or a stronger preset/plugin authoring model than the current built-in defaults.
