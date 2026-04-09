# AGENTS.md

## Purpose

SpecLens is a spec-driven development toolkit.

This repo follows an iterative Design Science workflow.

Use three planning layers:

- Milestones / iterations for Design Science cycles and evaluation checkpoints
- Issue docs for active implementation or investigation work
- ADRs for durable architecture and design decisions

Current milestone context:

- Iteration 2 / primary path: TagTwo-first repo analysis
- Iteration 1 / archived baseline: client visual analysis evidence

Agents should prefer explicit specs, existing validation commands, and current iteration docs over
guessing behavior.

---

## Start Here

- `README.md` for the current product shape, supported commands, and active profiles
- `docs/FILE_MAP.md` for repo navigation
- `docs/iterations/INDEX.md` for milestone and iteration history
- `docs/iteration-2-architecture.md` for the current adapter/analyzer split
- `docs/issues/INDEX.md` for active work items
- `docs/adr/INDEX.md` for architecture decisions

---

## Repo Map

- `tools/`: the CLI and analysis pipeline implementation
- `specs/speclens/`: self-specs for SpecLens tools
- `specs/tagtwo/`: deterministic repo-analysis specs for the primary iteration-2 flow
- `specs/client/`: legacy client specs kept as archived evidence and optional legacy capability
- `src/`: small React demo app used by the local starter flow
- `tests/`: Playwright tests for browser-visible demo behavior
- `policies/`: policy inputs such as license-policy configuration
- `reports/`: generated artifacts; do not hand-edit unless the task is specifically about report output

---

## Core Rules

- Before changing a tool in `tools/`, read the matching spec in `specs/speclens/` first.
- Before changing TagTwo analysis behavior, read the relevant files in `specs/tagtwo/` and any
  policy/config inputs it depends on.
- Before changing the demo app in `src/`, read the relevant feature spec in `specs/` and the
  matching browser test in `tests/` when one exists.
- Treat `reports/`, `dist/`, `test-results/`, and generated dashboard artifacts as outputs, not
  source files. Regenerate them instead of editing them manually.
- Keep legacy client work isolated. Do not extend or modernize the client path unless the task is
  explicitly about the archived workflow.
- If behavior changes, update spec, implementation, and validation artifacts together in the same
  change.

---

## Spec Lookup

Use these pairings instead of searching blindly:

- `tools/speclens-cli.mjs` -> `specs/speclens/speclens-cli.md`
- `tools/spec-checker.mjs` -> `specs/speclens/speclens-spec-checker.md`
- `tools/results-viewer.mjs` -> `specs/speclens/speclens-results-viewer.md`
- `tools/spec-generator.mjs` -> `specs/speclens/speclens-spec-generator.md`
- `tools/visual-inspector.mjs` -> `specs/speclens/speclens-visual-inspector.md`
- `tools/visual-filter.mjs` -> `specs/speclens/speclens-visual-filter.md`
- `tools/interaction-tester.mjs` -> `specs/speclens/speclens-interaction-tester.md`
- `tools/license-checker.mjs` -> `specs/speclens/speclens-license-checker.md`
- React demo modal and label behavior -> `specs/feature-001-modal-consistency.md` and
  `specs/feature-001-ui-label-consistency.md`

If a tool changes and no matching spec exists yet, add one before or alongside the implementation
change.

---

## Validation

Prefer the cheapest proof that matches the area you changed:

- General safe default: `npm run validate:local`
- CLI or TagTwo flow: `npm run speclens:tagtwo:analyze`
- Deterministic TagTwo checks only: `npm run speclens:tagtwo:spec-check`
- License policy changes: `npm run speclens:tagtwo:license`
- Demo UI/browser behavior: `npm run test:e2e`
- Dashboard/result rendering changes: `npm run speclens:tagtwo:results`

Avoid running the full legacy client pipeline unless the task is explicitly in the client path.

---

## Milestone-Driven Workflow

Use milestone docs to track Design Science iterations.

- Treat each iteration as a milestone with a clear problem statement, artifact goal, evaluation
  plan, evidence, and reflection.
- Before substantial work, identify which iteration the task belongs to.
- If the work meaningfully changes the research direction, artifact scope, or evaluation criteria,
  update the current iteration doc before or alongside code changes.
- If the work starts a new cycle of design, demonstration, and evaluation, create a new iteration
  doc and add it to `docs/iterations/INDEX.md`.
- Link issue docs and ADRs back to the relevant iteration so implementation work stays connected to
  the milestone outcome.

Use this Design Science shape for each iteration:

1. Problem framing: what limitation or opportunity the iteration addresses
2. Objectives: what the artifact should achieve in this cycle
3. Design/change plan: what analyzers, specs, policies, or UX flows will change
4. Demonstration: how the artifact will be exercised
5. Evaluation: what evidence or metrics will be collected
6. Reflection: what was learned and what the next iteration should do

Use `docs/iterations/ITERATION-000-template.md` as the starting shape.

---

## Issue-Driven Workflow

Use issue docs for non-trivial work.

- Create or update one active doc in `docs/issues/` for bug fixes, feature work, investigations,
  or changes that take more than a small single-file edit.
- Link the issue to its parent milestone / iteration.
- Add the issue doc to `docs/issues/INDEX.md` when work starts.
- Keep the doc current with status, scope, affected files, validation, and any unresolved questions.
- Move completed issue docs to `docs/issues/archive/` and update the archive index.
- Small typo fixes, narrow doc edits, and other low-risk one-shot changes do not need an issue doc.

Use `docs/issues/0000-template.md` as the starting shape.

---

## ADR Workflow

Use an ADR when a change affects architecture or long-lived project rules.

Common triggers in this repo:

- adding or replacing a major analyzer, adapter, or pipeline phase
- changing spec format or report schema used by multiple tools
- changing profile structure, config shape, or output layout conventions
- changing how policy files are interpreted across the project
- promoting legacy client behavior into the primary TagTwo flow

ADR rules:

- Create new ADRs in `docs/adr/` using `ADR-XXXX-short-title.md`
- Add each new ADR to `docs/adr/INDEX.md`
- Link the ADR to the milestone / iteration that introduced or adopted the decision
- Keep `Status` separate from rollout notes or implementation checklist
- Link the active ADR from the related issue doc when both exist

Use `docs/adr/ADR-0000-template.md` as the starting shape.

---

## Change Discipline

- Keep diffs focused on the requested goal.
- Do not mix generated output churn with source changes unless the generated artifact is part of
  the requested deliverable.
- Do not add compatibility paths or preserve legacy behavior by default. This repo is small enough
  to prefer clear current behavior over fallback logic.
- If spec and implementation disagree, decide intended behavior and align both. If tests also need
  to change, update spec first, then tests, then implementation.

---

## Git

- Do not commit or push unless the user explicitly asks.
- Keep one commit per logical change set.
- When a change spans code, spec, issue docs, and ADRs for the same decision, keep them together.
