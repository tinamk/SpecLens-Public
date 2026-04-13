# ADR-0001: TagTwo local self-check bootstrap

## Status

Accepted

## Milestone / Iteration

`docs/archive/iteration-2-architecture.md`

## Context

Iteration 2 intentionally shifted TagTwo to a deterministic repo-analysis path so the primary
demonstration no longer depended on a live UI or external credentials. The next requested step is
to recover some browser-visible feedback for TagTwo without reintroducing an external AI provider
or collapsing the profile back into the archived client workflow.

The project also needs a clean seam for later OpenAI integration if API access is approved.

## Decision

Add a new optional TagTwo-specific local self-check phase that:

- uses Playwright only, with no model API dependency
- crawls a running local TagTwo app from a configured base URL
- records deterministic browser findings such as navigation failures, uncaught page errors,
  console errors, failed same-origin requests, and basic document-structure gaps
- writes JSON and Markdown reports under `reports/projects/tagtwo/`
- surfaces findings and approval-gated spec bootstrap proposals in the TagTwo dashboard
- keeps AI-assisted judgment and code patching as a later pluggable analyzer, not a hard
  dependency of the new flow

## Consequences

- Positive:
  - TagTwo gains a browser-visible bootstrap loop without waiting for API approval
  - The workflow stays reproducible and affordable for local development
  - Later OpenAI integration can reuse the same crawl artifacts and report structure
- Negative:
  - The first phase only supports deterministic smoke findings, not nuanced visual judgment
  - App code changes remain manual or Codex-assisted rather than fully automated
  - The TagTwo profile is no longer purely non-visual; docs must distinguish default and optional flows
- Follow-up:
  - Add an AI-assisted analyzer module once Platform API access is approved
  - Expand approval-gated proposal handling from spec drafts to app-code patches

## Implementation

- [x] Add a new `tagtwo-selfcheck.mjs` tool and CLI command
- [x] Add TagTwo dashboard support for self-check findings
- [x] Add a bootstrap spec draft path for the TagTwo web baseline
- [ ] Add an AI-enriched analysis layer on top of the same report inputs
