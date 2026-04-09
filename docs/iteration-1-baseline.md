# Iteration 1 Baseline

## What Worked
- The client-focused pipeline demonstrated SpecLens as a spec-driven analysis tool with report generation, screenshot evidence, and archived runs.
- The repo already included reusable CLI primitives such as spec linting, task extraction, run archiving, and dashboard generation.
- Archived client reports in `reports/client/` provide concrete evidence from the first artifact iteration.

## What Was client-Specific
- The main analysis flow assumed a live Svelte application, known routes, and optional credentials for protected pages.
- `component-scanner.mjs`, `spec-checker.mjs`, `visual-inspector.mjs`, and `interaction-tester.mjs` were oriented around Svelte/UI flows rather than generic repo analysis.
- The results viewer and README framed SpecLens primarily as a frontend/visual tool.

## What Became Unusable
- Loss of access to the real client system made credential-dependent and live-app-dependent flows unreliable as the primary demonstration path.
- Route-specific assumptions and browser-driven checks do not generalize well to a repo-first evaluation case like TagTwo.

## What Remains as Archived Evidence
- `reports/client/` remains unchanged as iteration-1 demonstration material.
- Existing client specs and legacy commands remain part of the historical artifact, but they no longer define the default iteration-2 workflow.

## Why Iteration 2 Pivots
- Access loss exposed external dependency risk in the original demonstration case.
- The bachelor artifact needs a broader, repo-oriented demonstration that does not depend on a live frontend.
- Iteration 2 therefore treats TagTwo as the primary case and repositions client as archived evidence from the previous iteration.
