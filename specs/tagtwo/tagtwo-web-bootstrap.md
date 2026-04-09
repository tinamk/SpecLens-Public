# TagTwo Web Bootstrap

## Goal
Establish the first browser-visible baseline for TagTwo so SpecLens can inspect a running local app,
capture deterministic smoke failures, and keep a lightweight route-aware spec in step with that
observed surface area.

## Scope (IN)
- The configured local TagTwo base URL and same-origin pages discovered from it
- Page load success, uncaught runtime failures, failed same-origin requests, and basic document
  structure checks
- Approval-gated refresh of the observed route inventory

## Scope (OUT)
- Business-specific UI correctness rules
- Detailed visual consistency judgments
- Authentication-only or role-specific flows not reachable from the local crawl
- Automatic code changes to the target app

## Definitions (Source of truth)
- **Entry route**: The configured TagTwo base URL combined with the chosen start path
- **Observed route**: A same-origin page discovered by the latest self-check crawl
- **Bootstrap finding**: A deterministic load, runtime, request, or page-structure issue captured
  by the self-check tool

## Rules

### R01 - Entry route must load
1. The entry route MUST respond without a browser navigation failure.
2. The entry route MUST expose a non-empty document title.

### R02 - Observed routes must remain reachable
1. Each observed route MUST load without an uncaught page error.
2. Each observed route MUST avoid failed same-origin document, script, stylesheet, fetch, or xhr
   requests during the initial load window.

### R03 - Pages must expose a basic document structure
1. Each observed route SHOULD expose a `main` landmark.
2. Each observed route SHOULD expose a primary `h1` heading.

### R04 - Spec refresh stays approval-gated
1. Observed routes may be added to this spec only after an explicit self-check approval command.
2. The self-check report MUST remain read-only unless the developer opts in to refreshing the draft.

## Observed routes
- Pending first approved self-check draft refresh.

## Acceptance checks
1. Running `npm run speclens:tagtwo:selfcheck` writes a report for the configured local URL.
2. The report lists observed routes and bootstrap findings.
3. Running `npm run speclens:tagtwo:selfcheck -- --write-spec-draft` refreshes the observed route
   section after explicit approval.

## Scenarios
### Scenario A
Given TagTwo is reachable at the configured local URL
When SpecLens runs the local self-check
Then entry-route and observed-route bootstrap findings are written to the TagTwo report folder

### Scenario B
Given an observed route throws during initial render
When the route is visited during the self-check crawl
Then the route is reported as a bootstrap finding that needs code review before any later patch loop
