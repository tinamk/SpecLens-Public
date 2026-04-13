# ADR-0002: TagTwo profile-aware adapter/analyzer architecture

## Status

Accepted

## Milestone / Iteration

`docs/archive/iteration-2-architecture.md`

## Context

Iteration 1 coupled SpecLens to a mostly client-specific, browser-first workflow. Iteration 2
changes the primary demonstration path: TagTwo must run from repo artifacts alone, without a live
UI or external credentials, while archived client evidence remains available for comparison.

That shift affects long-lived project structure rather than a single tool. The CLI now needs to
route by profile, analyzers need a seam between repo-oriented and browser-oriented targets, and
generated output needs stable per-project locations so multiple profiles can coexist without
overwriting each other.

## Decision

Adopt a profile-aware architecture built from target adapters and analyzers:

- define `tagtwo` as the primary Iteration 2 profile and keep `client-legacy` as an explicit legacy
  profile
- route profiles through adapter/analyzer combinations instead of assuming a single browser-first
  pipeline
- make the default TagTwo path use a repo-oriented adapter with deterministic inventory,
  local spec-check, license-policy analysis, and a project-aware results viewer
- isolate generated artifacts under `reports/projects/<profile>/` while keeping stable
  profile-specific dashboards such as `reports/TagTwo/ai-results.html`
- preserve client as archived evidence and optional legacy capability instead of extending it as the
  default compatibility path

## Consequences

- Positive:
  - the primary workflow becomes reproducible on a fresh clone without browser login or model API
    access
  - SpecLens gains a cleaner seam for onboarding more than one target profile
  - report outputs become easier to compare and archive per project
- Negative:
  - CLI/config and docs become more complex because the project now has explicit primary and legacy
    paths
  - result locations and command names change, so old habits and scripts may need updates
  - tools that previously assumed one target shape now need profile-aware branching
- Follow-up:
  - continue extracting shared analyzer logic into reusable modules as new profiles are added
  - decide when the TagTwo fixture should stop carrying its intentional placeholder-policy finding

## Implementation

- [x] Add profile-aware CLI/config routing for TagTwo and client legacy commands
- [x] Add the TagTwo repo inventory, local spec-check, and license-policy analysis path
- [x] Make results rendering project-aware and preserve archived client outputs
- [ ] Expand the adapter/analyzer set only through new profile-specific specs and docs
