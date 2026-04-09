# Iteration 2 Plan: TagTwo-first SpecLens

## Summary

Iteration 2 turns SpecLens into a TagTwo-first, repo-oriented artifact. The primary path must run without client credentials or a live UI, produce reproducible TagTwo reports, add a generic license-policy checker, and keep client only as archived iteration-1 evidence.

## Engineering backlog

### Epic A - Stabilize and freeze the baseline

1. `ENG-01` `P0` Freeze iteration-1 evidence.
   Targets: `docs/iteration-1-baseline.md`, `reports/client/`
2. `ENG-02` `P0` Fix the current build break and add one local validation command.
   Targets: `src/App.tsx`, `src/Modal.tsx`, `package.json`
3. `ENG-03` `P0` Replace placeholder CI with meaningful validation.
   Targets: `.github/workflows/speclens-e2e.yml`, `package.json`, `speclens.config.json`

### Epic B - Multi-project foundation

4. `ENG-04` `P1` Add profile-aware CLI/config and normalize active report locations.
   Targets: `speclens.config.json`, `tools/speclens-cli.mjs`, `tools/results-viewer.mjs`
5. `ENG-05` `P1` Introduce the adapter/analyzer split and a generic repo inventory step.
   Targets: `tools/lib/adapters/`, `tools/repo-inventory.mjs`, `tools/component-scanner.mjs`
6. `ENG-11` `P1` Create the sanitized TagTwo fixture early and wire it into CI.
   Targets: `fixtures/tagtwo-mini/`, `.github/workflows/speclens-e2e.yml`, `package.json`
   Note: the fixture should exist before or alongside analyzer work so implementation starts from stable, known cases.
7. `ENG-06` `P1` Refactor spec checking to accept generic inventory/file input.
   Targets: `tools/spec-checker.mjs`, `specs/speclens/speclens-spec-checker.md`, `tools/repo-inventory.mjs`

### Epic C - TagTwo-first analysis

8. `ENG-07` `P1` Author the minimal TagTwo spec set and license policy.
   Targets: `specs/tagtwo/`, `policies/license-policy.json`, `specs/speclens/speclens-license-checker.md`
9. `ENG-08A` `P1` Parse and normalize license metadata.
   Targets: `tools/license-checker.mjs`, `tools/lib/license-utils.mjs`, `fixtures/tagtwo-mini/`
   Requirements:
   - use `package-lock.json` to enumerate the dependency tree when present
   - use package manifests to read declared license metadata
   - handle SPDX expressions, `SEE LICENSE IN <filename>`, valid `OR`, and valid `WITH` expressions
   - if installed package manifests are unavailable, report reduced coverage explicitly
10. `ENG-08B` `P1` Apply policy and produce reports.
    Targets: `tools/license-checker.mjs`, `policies/license-policy.json`, `tools/results-viewer.mjs`
    Requirements:
    - classify findings as `high`, `medium`, or `low`
    - use policy-oriented wording only
    - generate JSON and Markdown reports
11. `ENG-09` `P1` Add the non-visual TagTwo pipeline.
    Targets: `package.json`, `tools/speclens-cli.mjs`, `reports/projects/`
12. `ENG-10` `P2` Add a controlled patch-draft loop.
    Targets: `tools/license-checker.mjs`, `tools/speclens-cli.mjs`, `reports/projects/`
    Constraints:
    - only generate patch drafts for the root manifest and other directly owned project files
    - do not generate transitive dependency patch drafts
    - require explicit human approval before any mutation

### Epic D - Review and presentation

13. `ENG-12` `P2` Make the dashboard project-aware and surface TagTwo findings.
    Targets: `tools/results-viewer.mjs`, `specs/speclens/speclens-results-viewer.md`, `reports/client/`

## Thesis/docs track

1. `DOC-01` `P0` Define the iteration-2 evaluation baseline.
   Targets: `docs/iteration-1-baseline.md`, `docs/iteration-2-evaluation.md`
2. `DOC-02` `P1` Maintain the iteration-2 comparison pack in parallel with implementation.
   Targets: `docs/iteration-2-architecture.md`, `docs/iteration-1-vs-2.md`, `README.md`

## Fixture coverage

The fixture should include at least these license cases:

- allowed SPDX license
- review-needed SPDX license
- blocked SPDX license
- missing license metadata
- invalid SPDX expression
- valid `SEE LICENSE IN`
- broken `SEE LICENSE IN`
- valid multi-license `OR` expression
- valid `WITH` exception expression
- custom non-SPDX string that remains review-needed

## Non-goals

- No legal determinations
- No transitive auto-fixes
- No rebuilt TagTwo visual pipeline in iteration 2

## Done criteria

- `npm run build` passes
- `npm ci && npm run validate:local` passes on a fresh clone
- `npm run speclens:analyze:tagtwo` runs without visual tooling
- license reports are generated for TagTwo
- the dashboard shows TagTwo findings and archived client evidence
- at least one owned-file finding can emit a human-approved patch draft
