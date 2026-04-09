# Iteration 2 Evaluation Baseline

## Fixed Metrics
- Onboarding time for a new repo profile
- Number of analyzers reused unchanged from iteration 1
- Number of hard-coded project-specific edits required for TagTwo onboarding
- Number of findings produced per TagTwo analysis run
- Manual validation accuracy for a small reviewed finding sample
- Fresh-clone reproducibility using the local validation and fixture-backed pipeline

## Formative Checkpoints
- After stabilization: confirm `npm run validate:local` passes on a fresh clone after `npm ci`
- After profile and adapter work: confirm TagTwo inventory/spec-check can run without browser access
- After license checker delivery: confirm JSON + Markdown reports and severity classification output
- After local self-check bootstrap: confirm a live local TagTwo URL can be crawled without any API
  key and that findings plus screenshots are written under `reports/projects/tagtwo/`
- After dashboard integration: confirm TagTwo findings and archived client evidence are both visible
- After patch-draft loop: confirm before/after evidence is stored after explicit approval

## Current Baseline
- `npm run build` initially failed on the modal ref typing until iteration-2 stabilization work fixed it.
- `npm run lint`, `npm run speclens:lint`, `npm run speclens:extract`, and `npm run labels:lint` already passed before new analyzer work.

## Evidence Collection
- Store generated reports under `reports/projects/tagtwo/`
- Store local self-check screenshots and reports under `reports/projects/tagtwo/selfcheck/`
- Keep `reports/client/` untouched as archived iteration-1 evidence
- Use `fixtures/tagtwo-mini/` for reproducible CI and local smoke runs
