# Issue: TagTwo-first pipeline

## Status

In progress

## Milestone / Iteration

`docs/iteration-2-architecture.md`

## Summary

Track the Iteration 2 migration that makes TagTwo the primary SpecLens path through a
profile-aware CLI, deterministic repo analyzers, and project-scoped reports while keeping client
available only as archived legacy evidence.

## Scope

- In scope:
  - profile-aware CLI/config and report routing
  - TagTwo repo inventory, local spec-check, and license-policy analysis
  - project-aware results rendering and supporting docs/spec updates
- Out of scope:
  - new client feature work or modernization
  - AI-assisted TagTwo visual analysis
  - automatic mutation beyond explicit human-approved drafts

## Context

- Relevant specs:
  - `specs/speclens/speclens-cli.md`
  - `specs/speclens/speclens-spec-checker.md`
  - `specs/speclens/speclens-results-viewer.md`
  - `specs/speclens/speclens-license-checker.md`
  - `specs/tagtwo/tagtwo-architecture.md`
  - `specs/tagtwo/tagtwo-dependency-policy.md`
- Relevant files:
  - `speclens.config.json`
  - `tools/speclens-cli.mjs`
  - `tools/repo-inventory.mjs`
  - `tools/spec-checker.mjs`
  - `tools/license-checker.mjs`
  - `tools/results-viewer.mjs`
  - `README.md`
- Related ADRs:
  - `docs/adr/ADR-0001-tagtwo-local-selfcheck-bootstrap.md`
  - `docs/adr/ADR-0002-tagtwo-profile-aware-adapter-analyzer-architecture.md`

## Plan

- [x] Introduce profile-aware routing and project-scoped report locations.
- [x] Add the deterministic TagTwo inventory, spec-check, and license-policy path.
- [x] Update specs and docs for the TagTwo-first workflow and archived client baseline.
- [ ] Decide whether to keep the fixture's intentional `left-pad` policy violation as the active
      demonstration baseline before archiving this issue.

## Validation

- Command: `npm run validate:local`
  Result: Passed on 2026-04-08.
- Command: `npm run speclens:tagtwo:analyze`
  Result: Passed on 2026-04-08 and regenerated TagTwo reports. The run reported one medium
  policy finding from the fixture's intentional `left-pad` dependency.

## Notes

- The code path is currently green for the default local validation and the primary TagTwo
  analysis path.
- The remaining open question is process-oriented rather than technical: whether the fixture
  should continue demonstrating one deterministic policy failure or move to a fully clean baseline.
