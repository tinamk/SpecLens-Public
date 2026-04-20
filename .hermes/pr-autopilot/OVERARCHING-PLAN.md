# SpecLens PR Autopilot Overarching Plan

Last updated: 2026-04-20T22:15:14+02:00
Branch: `autopilot/speclens`
Worktree: `/home/tina/SpecLens-autopilot`

## Mission bias
- Primary objective: remove real product weaknesses in code, UX, security, deployment reliability, and hosted-SaaS behavioral parity.
- Validation-speed or test-framework work is support work only; it should be chosen when it directly unblocks product weakness reduction or a red `npm run validate:local` result.
- A strong pass should normally improve shipped behavior, operational safety, or a user-visible product surface.
- If confidence is limited by missing validation, add the narrowest missing automated test or browser check needed to prove behavior in dev or prod.

## Validated bottlenecks
- `npm run test` remains the dominant cost inside `npm run validate:local`; the integration-heavy hosted/API and ai-worker tests are the main throughput sink.
- `tests/api.test.ts` still contains several long-running browser-oriented flows where over-bundled seeded agents add avoidable latency.
- The stored-credentials browser parity regression specifically spends most of its time on the full exhaustive universal agent even though the assertion surface only needs authenticated browser readiness.

## Validated product/deployment weaknesses
- Auth redirect handling in `apps/web/app/api/auth/login/route.ts` and `apps/web/app/api/auth/callback/route.ts` should be constrained to safe internal destinations; current `returnTo` handling is too permissive.
- Billing and checkout fallbacks in `apps/api/src/routes/durable.ts` and `packages/db/src/repositories.ts` still need a correctness pass so non-live and fallback checkout flows build safe, valid return URLs.
- Secret separation in `packages/db/src/repositories.ts` remains weaker than desired because workspace-state encryption can still fall back to session/CSRF secrets.
- Deployment packaging in `deploy/digitalocean/ansible/roles/speclens_stack/tasks/main.yml` should be hardened so dirty controller working-tree state cannot accidentally leak into a production deploy archive.
- Report export/download handling in `apps/api/src/routes/durable.ts` needs a fail-closed pass so missing newly-created artifacts do not fall back to the wrong artifact index.

## Completed fixes
- Runtime-state filtering now keeps `/home/tina/SpecLens/.hermes/pr-autopilot/` bookkeeping from tripping the main-repo clean guard.
- API test-only access logging was quieted during `NODE_ENV=test` runs while preserving opt-in request logging.
- ai-worker learnables follow-up coverage now uses a minimal runtime-scout probe, and non-Windows runtime shutdown now uses a detached process group to avoid the fallback timeout path.
- Queued job cancellation/retry coverage now uses a minimal runtime-scout probe agent plus the smaller `tagtwo-mini` upload fixture.
- Default polling slack in `tests/api.test.ts` was reduced from 1000ms to 100ms.

## UX and visual quality objectives
- Make every important hosted page feel product-grade: visually clean, calm, consistent, and immediately understandable without clutter or ambiguous controls.
- Improve end-to-end UX flow across sign-in, workspace entry, repository/remediation setup, findings review, reports, billing, and settings so the next action is always obvious.
- Improve data visualization quality in report views and analysis surfaces so findings, severity, remediation progress, and report structure are easier to scan and compare.
- Prefer focused page-family audits with concrete fixes: marketing/pricing trust surfaces, auth entry points, dashboard/workspace flow, findings/report views, billing, and settings.
- Treat confusing copy, weak hierarchy, poor empty/loading/error states, unclear CTAs, and visually flat or noisy layouts as real product weaknesses, not cosmetic extras.
- Use Playwright-driven browser review as a standard evidence source for UX work: navigate real pages, capture screenshots for the affected states, and compare before/after visuals instead of relying only on code inspection.
- When a page or flow is under review, include visual evidence for happy path plus the most relevant empty, loading, error, or permission-denied state when feasible.
- Treat weak visual hierarchy, hard-to-scan tables, unclear charts, poor responsive behavior, and misleading screenshot-level affordances as concrete weaknesses to fix.
- Prefer image-based review of screenshots and rendered report pages when judging whether layouts, charts, and findings presentation are actually understandable.

## Validation and test-coverage objectives
- Treat missing tests as real weaknesses whenever they leave correctness, security, UX, deployment, or parity behavior insufficiently proven.
- Add the smallest useful regression test for every meaningful bug fix when feasible, especially for auth, billing, report generation/export, GitHub integration, workspace isolation, and deployment behavior.
- Maintain confidence in both local/dev and hosted/prod behavior; do not assume one environment proves the other.
- Allow and encourage focused E2E coverage in both dev and prod when it is the best way to validate a real user flow or deployment-critical behavior.
- Prefer surface-specific Playwright coverage in dev first, then use production E2E selectively for externally exposed flows, deployment verification, auth, billing, admin, and report-delivery checks.
- When a prod issue is fixed or a deploy path changes, ensure there is a durable verification path: targeted prod E2E, stack verification, or a regression test that reduces the need for manual trust.

## Deployment and tooling guidance
- DigitalOcean access and deployment work should use the committed `digitalocean-ansible-deploy` workflow as the primary control surface.
- Preferred operator flow for hosted deployment work:
  1. `.codex/skills/digitalocean-ansible-deploy/scripts/check-prereqs.sh`
  2. `.codex/skills/digitalocean-ansible-deploy/scripts/ansible-install-deps.sh`
  3. `.codex/skills/digitalocean-ansible-deploy/scripts/doctl-check.sh` for sanity checks or fallback inspection
  4. `.codex/skills/digitalocean-ansible-deploy/scripts/provision.sh`
  5. `ansible-playbook deploy/digitalocean/ansible/playbooks/bootstrap.yml`
  6. `.codex/skills/digitalocean-ansible-deploy/scripts/deploy.sh`
  7. `.codex/skills/digitalocean-ansible-deploy/scripts/verify.sh`
- Use Ansible as the primary deployment engine and `doctl` as a support or fallback tool for inspection, account checks, and cleanup.
- Prefer the wrapper scripts under `.codex/skills/digitalocean-ansible-deploy/scripts/` and `deploy/digitalocean/` over ad hoc hand-written command sequences.
- For production verification, remember the repo already supports Playwright-based prod E2E and stack-level verification; deployment-hardening work should keep those paths healthy rather than bypassing them.

## Active investigation
- The main repo is currently clean outside runtime state; only `/home/tina/SpecLens/.hermes/pr-autopilot/status.json` is locally modified as expected autopilot bookkeeping.
- The dedicated worktree remains the only safe place for autonomous source edits and should resume from the highest-leverage queued weakness rather than more test-only optimization.
- Keep the next pass focused on a real product/deployment/UX weakness with targeted validation and add missing regression coverage where current proof is insufficient.

## Next queued weaknesses
1. Fix the auth open-redirect weakness and add the smallest relevant regression coverage.
2. Fix billing/checkout fallback URL correctness so hosted and non-live flows stay valid and safe.
3. Audit one page family in `apps/web` for product-grade UX quality and data presentation, then land focused improvements with targeted validation.
4. Harden deployment packaging and export/download correctness if the next code pass touches production or report-delivery behavior.
5. Fill missing regression tests or focused Playwright coverage when a real weakness is fixed but current validation does not prove dev and prod behavior strongly enough.
6. For each UX-focused pass, use Playwright screenshots and image review to build a concrete backlog of visual/flow issues rather than relying only on static code reading.
7. Return to test/runtime-cost tuning only when it unblocks one of the weaknesses above or a red `validate:local` result.

## Production/deployment follow-ups worth revisiting later
- Keep `HTTP_ACCESS_LOG_ENABLED=true` available for local debugging and production troubleshooting when a future pass needs detailed request traces.
- Capture any later deployment-hardening findings here so future passes can resume without rereading long logs.
- Maintain a running UX backlog here for page-specific visual and flow issues discovered during code passes so the agent steadily improves real product surfaces instead of only validation internals.
- Preserve concrete screenshot-backed UX findings here when they reveal recurring layout, navigation, responsiveness, or visualization problems worth revisiting.
- Keep dev/local and prod verification paths aligned so E2E coverage can be used intentionally in both environments without bespoke one-off operator steps.
