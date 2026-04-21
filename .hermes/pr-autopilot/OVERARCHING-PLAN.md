# SpecLens PR Autopilot Overarching Plan

Updated: 2026-04-21T05:50:27+00:00
Branch: autopilot/speclens
Worktree: /home/tina/SpecLens-autopilot
Head: 643b5f944f2bc4bb333f3be484063db071411c73

## Validated bottlenecks
- Final gate remains `env -u NODE_OPTIONS npm run validate:local`; run it once per pass only after targeted checks are green.
- In this repo terminal environment, `NODE_OPTIONS` can break direct Node/tsx commands; unset it for targeted validation.
- Hosted-web workspace routes still offer high-leverage auth-scope hardening opportunities via static comparison of route payload guards.
- Public-site and portal copy still trends too abstract and advanced in places; future UX passes should simplify wording without removing technical accuracy.

## Completed fixes this branch
- Fail-closed cross-workspace payload drift on workspace overview, sources, access, settings, runs, reports, run detail, report detail, and code review routes.
- Hardened auth return/callback origin handling and checkout URL origin handling.
- Restricted workspace secret attachment to owners and required a dedicated workspace-secret encryption key.
- Preserved remediation diff context in report-to-code links and clarified multiple public-site decision paths.
- Hardened DigitalOcean release packaging to archive committed HEAD only from clean repos.
- Fail-closed workspace code page rendering when either the code-review payload or the supporting workspace console context drifts across workspaces.

## Most recent completed pass
- Weakness class: correctness/auth-scope.
- Evidence: `apps/web/app/portal/workspaces/[workspaceId]/code/page.tsx` computed mutation policy and rendered source-selection UI from `workspaceConsole` without first proving that console payload belonged to the active workspace; the later code-review check only verified the review payload plus source ids.
- Fix: added `isWorkspaceScopedCodePageContext(...)` in `apps/web/lib/portal.ts`, guarded the code page with `isWorkspaceScopedWorkspaceConsoleContext(...)` before rendering owner/source-derived UI, and used the combined helper after loading the review payload.
- Regression coverage: added positive and negative helper tests in `tests/web.test.ts` for code-page context scope validation.
- Validation: `env -u NODE_OPTIONS node --import tsx --test tests/web.test.ts --test-name-pattern 'workspace-scoped code page context helper|workspace-scoped code-review context helper|workspace-scoped console context helper'`; `env -u NODE_OPTIONS ./node_modules/.bin/eslint apps/web/lib/portal.ts 'apps/web/app/portal/workspaces/[workspaceId]/code/page.tsx' tests/web.test.ts`; `env -u NODE_OPTIONS npm run validate:local` (background session `proc_8e8fb1a15dee`, passed).

## Next queued weaknesses
1. Audit user-facing copy for advanced or ambiguous language, especially pricing/license/commercial pages plus portal/report surfaces, and simplify it so technically accurate text is still easy to understand on first read.
2. Audit other workspace routes that derive owner/mutation UI from `workspaceConsole` before or without combined page-level scope guards, especially any route with early returns before secondary payload validation.
3. Review remaining shared portal helpers for least-privilege overfetch or missing scope validation, especially overview/helper code paths that fetch more workspace data than the route renders.
4. Audit report-detail/run-detail adjacent payloads for any remaining cross-workspace or cross-source trust assumptions not covered by helper guards.
5. Revisit remediation E2E coverage once local app endpoints are reliably available; prior `e2e:remediation:local` run failed fast with connection refused rather than product assertions.
6. Continue targeting correctness/security issues ahead of validation-cost-only work unless `validate:local` turns red.

## Production/deployment follow-ups
- Keep DigitalOcean deployment/archive hardening in place; revisit only if release packaging or operator recovery surfaces regress.
- Preserve runtime-state-only changes under `/home/tina/SpecLens/.hermes/pr-autopilot/`; do not let them contaminate clean-repo checks.
