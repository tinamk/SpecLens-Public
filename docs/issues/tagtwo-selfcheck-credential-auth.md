# Issue: TagTwo self-check credential auth bootstrap

## Status

In progress

## Milestone / Iteration

`docs/iteration-2-architecture.md`

## Summary

Allow the TagTwo self-check to use local env-provided bot credentials to obtain a real authenticated
browser session automatically, so Playwright can crawl protected routes without requiring manual
login or an already-running Chrome session.

## Scope

- In scope:
  - env-driven TagTwo credential login for the self-check
  - saving the resulting authenticated Playwright storage state for reuse
  - self-check spec and README updates for the new auth path
- Out of scope:
  - credential discovery or harvesting
  - changing the legacy client auth flow
  - introducing a general OAuth toolkit across SpecLens

## Context

- Relevant specs:
  - `specs/speclens/speclens-tagtwo-selfcheck.md`
- Relevant files:
  - `tools/tagtwo-selfcheck.mjs`
  - `README.md`
  - `.env`
- Related ADRs:
  - none

## Plan

- [ ] Add credential-auth behavior to the TagTwo self-check spec.
- [ ] Implement env-driven credential login and auth-state persistence in `tools/tagtwo-selfcheck.mjs`.
- [ ] Document the supported local env variables in `README.md`.
- [ ] Validate the updated flow and record the outcome.

## Validation

- Command:
- Result:

## Notes

- The current TagTwo self-check only supports saved auth state, manual browser login capture, or
  CDP attachment to an existing browser.
- The requested change should prefer real user/bot tokens over dummy local-storage seeding so
  protected-route API calls stay authenticated during the crawl.
