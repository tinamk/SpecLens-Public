# ADR-0003: Generic productization architecture

## Status

Accepted

## Milestone / Iteration

`docs/iterations/ITERATION-003-generic-productization.md`

## Context

SpecLens had drifted into a repo-local toolkit centered on named profiles, tracked report artifacts, and target-specific flows. That shape made the product harder to apply to arbitrary repositories and kept the repo story split between current intent and historical evidence.

## Decision

SpecLens will use:

- a shared JS analysis core in `packages/core`
- a thin CLI in `packages/cli`
- an HTTP management API in `packages/http`
- a managed `.speclens-workspace/` runtime area for caches, runs, generated spec packs, and exports
- read-only analysis of target repos by default
- explicit patch-bundle export as the v1 write-back path
- archive status for TagTwo/client-first materials

## Consequences

- Positive:
  - repo selection becomes part of the public API
  - runtime outputs stop polluting tracked source
  - the product can analyze arbitrary repos without repo-local config as a prerequisite
- Negative:
  - this is a clean break from the old script surface
  - legacy archive materials remain in the repo and need to stay clearly marked
- Follow-up:
  - deepen analyzer coverage for more ecosystems over future iterations
  - decide whether to expose richer artifact-download endpoints or background job execution later

## Implementation

- [x] Add the three package workspaces and shared runtime workspace model
- [x] Add the new JS API, CLI, and HTTP surfaces
- [x] Update README, AGENTS, iteration docs, and issue docs
- [x] Continue shrinking the active legacy surface and tracked runtime outputs
