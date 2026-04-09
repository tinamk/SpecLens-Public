# Issue: TagTwo results viewer UI refresh

## Status

In progress

## Milestone / Iteration

`docs/iteration-2-architecture.md`

## Summary

Refresh the TagTwo dashboard so the HTML feels cleaner, more structured, and easier to review by
introducing clearer visual hierarchy, better grouping, and tabbed navigation between the major
review areas.

## Scope

- In scope:
  - TagTwo dashboard visual design refresh
  - tabbed navigation and cleaner section grouping
  - stronger hierarchy for overview, self-check, policy findings, and run history
- Out of scope:
  - changing archived client dashboard behavior
  - changing underlying report semantics beyond presentation needs
  - adding external assets or network dependencies to the generated HTML

## Context

- Relevant specs:
  - `specs/speclens/speclens-results-viewer.md`
- Relevant files:
  - `tools/results-viewer.mjs`
  - `reports/TagTwo/ai-results.html`
- Related ADRs:
  - `docs/adr/ADR-0002-tagtwo-profile-aware-adapter-analyzer-architecture.md`

## Plan

- [ ] Update the results-viewer spec for the cleaner tabbed dashboard structure.
- [ ] Rework the TagTwo HTML into a more polished, systematic layout.
- [ ] Add tab controls so major review areas are easier to switch between.
- [ ] Regenerate the dashboard and validate the standard TagTwo results flow.

## Validation

- Command:
  Result:

## Notes

- The current dashboard already has stronger self-check cards than before, but the full page still
  reads as a long stacked report.
- The main usability goal is faster navigation and cleaner grouping, not just decorative styling.
