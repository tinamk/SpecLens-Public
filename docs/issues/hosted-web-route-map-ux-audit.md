# Issue: Hosted web route map, UX flow, and IA audit

## Status

Done

## Milestone / Iteration

[Iteration 5](../iterations/ITERATION-005-behavioral-parity-migration.md)

## Summary

This audit maps the full Next.js `apps/web` surface as one hosted product, diagnoses the main IA/UX fragmentation points, and proposes a cleaner owner-first route structure. It covers 22 navigable page routes plus 6 supporting route handlers, with auth, proxy, callback, and contact transport treated as support flows rather than primary destinations.

## Scope

- In scope:
  - All `apps/web/app/**` pages and route handlers.
  - Current-state route inventory and route-responsibility audit.
  - Spec reconciliation against `specs/speclens/speclens-hosted-web.md`.
  - One owner-centric UX flow for the hosted product.
  - A target IA proposal and prioritized cleanup backlog.
- Out of scope:
  - Runtime code or route changes.
  - Fastify API route inventory in `apps/api`.
  - Final updates to `specs/speclens/speclens-hosted-web.md`.

## Context

- Relevant specs:
  - `specs/speclens/speclens-hosted-web.md`
- Relevant files:
  - `apps/web/app/**`
  - `apps/web/lib/portal.ts`
  - `apps/web/components/site-header.tsx`
  - `apps/web/components/site-footer.tsx`
  - `apps/web/components/admin-ai-actions.tsx`
- Related ADRs:
  - `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md`
  - `docs/adr/ADR-0006-keycloak-provider-registry-and-portable-dev-stack.md`
- Related architecture docs:
  - `docs/architecture/system-overview.md`
  - `docs/architecture/auth-and-access.md`
  - `docs/architecture/job-execution.md`

## Plan

- [x] Inventory every page and route handler in `apps/web/app`.
- [x] Reconcile the inventory against the hosted web spec.
- [x] Map what users see and do on every route group.
- [x] Diagnose fragmentation, overlap, and boundary problems.
- [x] Define an owner-centric end-to-end UX flow.
- [x] Propose a cleaner target IA and prioritized cleanup backlog.

## Validation

- Command:
  - `find apps/web/app -maxdepth 8 \( -name 'page.tsx' -o -name 'layout.tsx' -o -name 'route.ts' \) | sort`
- Result:
  - Verified the complete Next.js web surface and captured 28 file-backed route/page entries.
- Command:
  - `sed -n '1,220p' specs/speclens/speclens-hosted-web.md`
- Result:
  - Reconciled the inventory against the current hosted web spec and recorded implementation drift below.
- Command:
  - `rg -n "buildPortalPrimaryNav|buildWorkspaceNav|buildAdminNav" apps/web/lib/portal.ts`
- Result:
  - Confirmed the actual primary, workspace, and admin navigation contracts used by the portal.

## Full route inventory

| Path | Kind | File | Current responsibility |
|---|---|---|---|
| `/` | page | `apps/web/app/page.tsx` | Public landing page and hosted-vs-commercial split |
| `/pricing` | page | `apps/web/app/pricing/page.tsx` | Hosted plan comparison |
| `/license` | page | `apps/web/app/license/page.tsx` | Dual-license explanation |
| `/commercial` | page | `apps/web/app/commercial/page.tsx` | Commercial contact and procurement path |
| `/privacy` | page | `apps/web/app/privacy/page.tsx` | Privacy policy |
| `/terms` | page | `apps/web/app/terms/page.tsx` | Hosted service terms |
| `/portal` | page | `apps/web/app/portal/page.tsx` | Stable redirect into the signed-in portal |
| `/portal/workspaces` | page | `apps/web/app/portal/workspaces/page.tsx` | Workspace directory and workspace creation |
| `/portal/settings` | page | `apps/web/app/portal/settings/page.tsx` | Personal account/session view and user Codex auth |
| `/portal/workspaces/[workspaceId]` | page | `apps/web/app/portal/workspaces/[workspaceId]/page.tsx` | Workspace summary hub |
| `/portal/workspaces/[workspaceId]/sources` | page | `apps/web/app/portal/workspaces/[workspaceId]/sources/page.tsx` | Source intake, verification, and source inventory |
| `/portal/workspaces/[workspaceId]/code` | page | `apps/web/app/portal/workspaces/[workspaceId]/code/page.tsx` | Repository tree, ref review, diff/code view, PR context, finding-driven code inspection |
| `/portal/workspaces/[workspaceId]/runs` | page | `apps/web/app/portal/workspaces/[workspaceId]/runs/page.tsx` | Queueing, run history, auth-scope selection, and run secret selection |
| `/portal/workspaces/[workspaceId]/runs/[jobId]` | page | `apps/web/app/portal/workspaces/[workspaceId]/runs/[jobId]/page.tsx` | Live/terminal execution view for one job |
| `/portal/workspaces/[workspaceId]/reports` | page | `apps/web/app/portal/workspaces/[workspaceId]/reports/page.tsx` | Report directory |
| `/portal/workspaces/[workspaceId]/reports/[reportId]` | page | `apps/web/app/portal/workspaces/[workspaceId]/reports/[reportId]/page.tsx` | Report review, release gate, remediation, export, and code drill-in |
| `/portal/workspaces/[workspaceId]/access` | page | `apps/web/app/portal/workspaces/[workspaceId]/access/page.tsx` | Membership and access control |
| `/portal/workspaces/[workspaceId]/settings` | page | `apps/web/app/portal/workspaces/[workspaceId]/settings/page.tsx` | Billing, GitHub installation state, workspace auth, and repo inventory |
| `/portal/admin/ai/auth` | page | `apps/web/app/portal/admin/ai/auth/page.tsx` | Global Codex auth and fallback controls |
| `/portal/admin/ai/skills` | page | `apps/web/app/portal/admin/ai/skills/page.tsx` | AI skill catalog CRUD |
| `/portal/admin/ai/roles` | page | `apps/web/app/portal/admin/ai/roles/page.tsx` | AI role graph CRUD |
| `/portal/admin/ai/agents` | page | `apps/web/app/portal/admin/ai/agents/page.tsx` | Agent catalog CRUD and manual agent-run queueing |
| `/api/auth/login` | route | `apps/web/app/api/auth/login/route.ts` | Auth redirect entrypoint |
| `/api/auth/callback` | route | `apps/web/app/api/auth/callback/route.ts` | Auth code exchange and session establishment |
| `/api/auth/logout` | route | `apps/web/app/api/auth/logout/route.ts` | Session teardown and IdP logout |
| `/api/proxy/[...path]` | route | `apps/web/app/api/proxy/[...path]/route.ts` | Browser-to-internal API bridge with auth/CSRF forwarding |
| `/api/commercial-contact` | route | `apps/web/app/api/commercial-contact/route.ts` | Public contact-form transport to the internal API |
| `/auth/github/callback` | route | `apps/web/app/auth/github/callback/route.ts` | GitHub App installation callback and workspace-link redirect |

## Current-state route map

### `/`

- **Route / path:** `/`
- **Audience / role:** Prospects and returning users evaluating the hosted product.
- **Purpose:** Explain SpecLens as specification-driven QA and split hosted SaaS versus commercial rights.
- **Primary entry points:** Public home URL, brand link, footer brand.
- **Key content / actions:** Hero CTA to `/api/auth/login`, pricing CTA, story section, and a hosted-vs-commercial decision banner.
- **Dependencies / required prior state:** None.
- **Problems / friction:** Repeats the hosted-versus-commercial split that also appears on `/pricing`, `/license`, and `/commercial`.
- **Recommended future home / responsibility:** Keep as the product narrative and first decision point only; avoid deep pricing/legal repetition here.

### `/pricing`

- **Route / path:** `/pricing`
- **Audience / role:** Prospects deciding whether hosted Free or Pro fits.
- **Purpose:** Compare hosted plans and route code-rights questions to commercial.
- **Primary entry points:** Public header, footer CTA, home-page decision panels, portal pricing links.
- **Key content / actions:** Hosted-versus-commercial banner, Free/Pro/Commercial pricing cards, hosted comparison table, login/checkout/contact CTAs.
- **Dependencies / required prior state:** None; Pro checkout later requires authenticated billing state.
- **Problems / friction:** The page mixes hosted plan comparison with another commercial-rights pitch, which duplicates `/license` and `/commercial`.
- **Recommended future home / responsibility:** Keep as the canonical hosted pricing page, with only a light callout that rights/self-hosting live on `/commercial`.

### `/license`

- **Route / path:** `/license`
- **Audience / role:** Legal, procurement, and technical buyers clarifying SaaS versus codebase rights.
- **Purpose:** Explain the dual-license model and route users to hosted pricing or commercial licensing.
- **Primary entry points:** Public header/footer, pricing/commercial callouts.
- **Key content / actions:** Rights explainer hero, hosted-versus-commercial split, scenario list, and CTA links to `/pricing` and `/commercial`.
- **Dependencies / required prior state:** None.
- **Problems / friction:** Re-explains the same hosted-versus-commercial decision already covered on home, pricing, and commercial.
- **Recommended future home / responsibility:** Keep as the canonical rights model explainer and reduce sales repetition elsewhere.

### `/commercial`

- **Route / path:** `/commercial`
- **Audience / role:** Buyers needing commercial rights, self-hosting, or procurement review.
- **Purpose:** Qualify and capture commercial licensing demand.
- **Primary entry points:** Public header/footer, pricing/license callouts, portal commercial links.
- **Key content / actions:** Commercial hero, hosted-versus-commercial split, scope checklist, contact email, and submission form posting to `/api/commercial-contact`.
- **Dependencies / required prior state:** None.
- **Problems / friction:** Still spends meaningful space re-selling hosted Pro instead of focusing on qualification and contract intake.
- **Recommended future home / responsibility:** Keep as the only commercial contract path and focus it on qualification, procurement, and contact flow.

### `/privacy` and `/terms`

- **Route / path:** `/privacy`, `/terms`
- **Audience / role:** Buyers, legal reviewers, and compliance-sensitive users.
- **Purpose:** Publish trust, policy, and hosted service legal terms.
- **Primary entry points:** Public header and footer.
- **Key content / actions:** Static policy/legal copy with page-level readiness markers.
- **Dependencies / required prior state:** None.
- **Problems / friction:** These policy routes are promoted in the public header alongside pricing and product decisions, which makes policy feel like a primary product branch.
- **Recommended future home / responsibility:** Keep them public, but demote them to footer-level trust navigation.

### `/portal`

- **Route / path:** `/portal`
- **Audience / role:** Signed-in users and deep links into the portal root.
- **Purpose:** Provide a stable portal entrypoint and redirect to the workspace directory.
- **Primary entry points:** Direct visits to `/portal`.
- **Key content / actions:** No persistent content; preserves query params and redirects to `/portal/workspaces`.
- **Dependencies / required prior state:** A portal session if the redirect target requires auth.
- **Problems / friction:** None structurally; this is a good stable alias.
- **Recommended future home / responsibility:** Keep as the canonical portal entry redirect.

### `/portal/workspaces`

- **Route / path:** `/portal/workspaces`
- **Audience / role:** All signed-in users; especially workspace owners starting work.
- **Purpose:** Act as the signed-in home for creating, finding, and opening workspaces.
- **Primary entry points:** `/portal` redirect, portal primary nav, footer portal CTA, post-auth landing.
- **Key content / actions:** Workspace stats, create-workspace form, search/filter directory, open-workspace and open-runs actions, plus links to portal settings, pricing, and admin.
- **Dependencies / required prior state:** Authenticated session.
- **Problems / friction:** The portal home mixes its core job with pricing/admin/account jumps, so the first signed-in surface still leaks marketing and operator concerns.
- **Recommended future home / responsibility:** Keep as the portal directory and creation hub only; move marketing/admin promotion out of the main account panel.

### `/portal/settings`

- **Route / path:** `/portal/settings`
- **Audience / role:** Any signed-in user managing their own account.
- **Purpose:** Show personal account/session state and let the user register their own Codex auth.
- **Primary entry points:** Portal primary nav, workspace directory/settings jump cards.
- **Key content / actions:** Session/account metadata, role/access summary, personal Codex auth registration, and jump cards to workspaces, pricing, commercial, and admin.
- **Dependencies / required prior state:** Authenticated session.
- **Problems / friction:** The page is both an account screen and a cross-app switchboard, which weakens its identity as the home for personal settings.
- **Recommended future home / responsibility:** Keep account/session/personal auth here and trim non-account route promotion to contextual links only.

### `/portal/workspaces/[workspaceId]`

- **Route / path:** `/portal/workspaces/[workspaceId]`
- **Audience / role:** Workspace members and owners.
- **Purpose:** Provide a summary hub for one workspace.
- **Primary entry points:** Workspace directory open button, lateral workspace navigation.
- **Key content / actions:** Workspace stats, jump cards to all workspace subroutes, recent runs preview, and member preview.
- **Dependencies / required prior state:** Authenticated session and workspace access.
- **Problems / friction:** The page goes beyond “summary + navigation” by owning recent-run and member previews, which duplicates responsibility already held by Runs and Access.
- **Recommended future home / responsibility:** Keep as a summary-only hub with lightweight activity context, not as a parallel operational surface.

### `/portal/workspaces/[workspaceId]/sources`

- **Route / path:** `/portal/workspaces/[workspaceId]/sources`
- **Audience / role:** Primarily workspace owners; members can inspect inventory.
- **Purpose:** Own source intake, verification, and source inventory.
- **Primary entry points:** Workspace overview, settings, and runs-related navigation.
- **Key content / actions:** Add-source form, source filters, verification controls, source edit/delete actions, learnable previews, and readiness summary.
- **Dependencies / required prior state:** Authenticated session, workspace access, and ownership for mutations.
- **Problems / friction:** The route is broad but coherent; the main noise is the extra guide/status panel and repeated jump cards.
- **Recommended future home / responsibility:** Keep all source lifecycle ownership here, including add, verify, rename, delete, and source-level learnable visibility.

### `/portal/workspaces/[workspaceId]/code`

- **Route / path:** `/portal/workspaces/[workspaceId]/code`
- **Audience / role:** Members and owners reviewing repository context, findings, or remediation changes.
- **Purpose:** Inspect source trees, refs, file content, diffs, changesets, PR context, and finding-linked code evidence.
- **Primary entry points:** Workspace overview, report detail links, run detail links, direct deep links with source/report/finding params.
- **Key content / actions:** Source selection, ref selection, file tree, code/diff viewer, latest remediation jobs, findings guidance, and optional PR panel.
- **Dependencies / required prior state:** Authenticated session, workspace access, and usually a selected source or report/finding context.
- **Problems / friction:** This route mixes a source-picker state with a deep review state, repeats “mutation policy” context, and carries some remediation context that also belongs to Reports.
- **Recommended future home / responsibility:** Keep it as the deep inspection and code-review surface only, with a clearer distinction between “choose a source” and “review a specific path/finding/change”.

### `/portal/workspaces/[workspaceId]/runs`

- **Route / path:** `/portal/workspaces/[workspaceId]/runs`
- **Audience / role:** Primarily workspace owners queueing work; members inspecting run history.
- **Purpose:** Queue AI tasks and review run history.
- **Primary entry points:** Workspace overview, sources/status flows, report and settings jumps.
- **Key content / actions:** Auth-scope notices, queue form, task/source/companion selection, selectable workspace run secrets, run history, run filtering, and links to related routes.
- **Dependencies / required prior state:** Authenticated session, workspace access, sources already connected, and selectable Codex auth scope for execution.
- **Problems / friction:** This route is still dense because queueing, auth education, auth-scope selection, and recent-run history are bundled together.
- **Recommended future home / responsibility:** Keep queueing, auth-scope selection, run secret selection, and run history here; keep durable reusable secret management in workspace settings.

### `/portal/workspaces/[workspaceId]/runs/[jobId]`

- **Route / path:** `/portal/workspaces/[workspaceId]/runs/[jobId]`
- **Audience / role:** Members and owners following one job.
- **Purpose:** Show live or terminal execution state for a single job.
- **Primary entry points:** Run history, overview previews, remediation links, report back-links.
- **Key content / actions:** Execution console, step timeline, status/timing, metadata, lifecycle actions, learnables, artifacts, and report/code/remediation links.
- **Dependencies / required prior state:** Authenticated session, workspace access, and an existing job.
- **Problems / friction:** The route title is the raw job id, which undersells the task/source context even though the rest of the page has it.
- **Recommended future home / responsibility:** Keep this as the execution-monitoring surface and make the task/source identity more prominent than the opaque id.

### `/portal/workspaces/[workspaceId]/reports`

- **Route / path:** `/portal/workspaces/[workspaceId]/reports`
- **Audience / role:** Members and owners reviewing durable outcomes.
- **Purpose:** List and search generated reports.
- **Primary entry points:** Workspace overview, runs page, report-side back links.
- **Key content / actions:** Report search, report cards, open-report links, open-job links, and empty states explaining when users should go back to Runs.
- **Dependencies / required prior state:** Authenticated session, workspace access, and completed jobs with reports.
- **Problems / friction:** This route is relatively clean; the main friction is that it is downstream of Runs but not visually positioned as the natural next step in the workspace nav.
- **Recommended future home / responsibility:** Keep it as the report directory and handoff point into one report detail.

### `/portal/workspaces/[workspaceId]/reports/[reportId]`

- **Route / path:** `/portal/workspaces/[workspaceId]/reports/[reportId]`
- **Audience / role:** Members and owners making review and remediation decisions.
- **Purpose:** Act as the primary decision surface for one analysis result.
- **Primary entry points:** Report directory, run-detail report links, direct remediation links.
- **Key content / actions:** Release-gate summary, findings summary, remediation launch/readiness, changed-file links, normalized sections, findings list, artifact list, export, and jumps into Code and Runs.
- **Dependencies / required prior state:** Authenticated session, workspace access, report, backing job, and optional remediation state.
- **Problems / friction:** Dense, but the density is mostly aligned with the job-to-be-done; this is the right place for release-gate, finding, export, and remediation decisions.
- **Recommended future home / responsibility:** Keep this as the primary review and remediation-launch surface.

### `/portal/workspaces/[workspaceId]/access`

- **Route / path:** `/portal/workspaces/[workspaceId]/access`
- **Audience / role:** Primarily workspace owners; members can inspect who has access.
- **Purpose:** Manage workspace membership.
- **Primary entry points:** Workspace overview, settings, and summary links.
- **Key content / actions:** Add-member form, member filters, member list, remove-member actions, owner summary, and cross-links back to overview/settings/runs/reports.
- **Dependencies / required prior state:** Authenticated session, workspace access, and owner role for mutations.
- **Problems / friction:** The core membership job is clear, but the summary/jump-card panel adds more cross-navigation noise than necessary.
- **Recommended future home / responsibility:** Keep this as the sole owner of membership management and trim secondary navigation clutter.

### `/portal/workspaces/[workspaceId]/settings`

- **Route / path:** `/portal/workspaces/[workspaceId]/settings`
- **Audience / role:** Primarily workspace owners; members inspect status in read-only form.
- **Purpose:** Own workspace-level billing, GitHub integration state, workspace Codex auth, reusable run secrets, and visible GitHub repository inventory.
- **Primary entry points:** Workspace overview, sources, access, and GitHub callback redirects.
- **Key content / actions:** Billing and checkout, billing portal, GitHub connect/unlink, workspace Codex auth registration, reusable run secret create/update/delete, installation inventory, repository search, and portal-settings link.
- **Dependencies / required prior state:** Authenticated session, workspace access, and owner role for mutations.
- **Problems / friction:** The page is busy, but the responsibilities are mostly legitimate and related because durable workspace configuration now lands in one place.
- **Recommended future home / responsibility:** Keep this as the workspace configuration and integration surface, and expand it only with other durable workspace-level settings.

### `/portal/admin/ai/auth`

- **Route / path:** `/portal/admin/ai/auth`
- **Audience / role:** Administrators only.
- **Purpose:** Manage the global Codex auth session and global fallback availability.
- **Primary entry points:** Portal admin nav, admin links from portal/workspace pages.
- **Key content / actions:** Start device flow, import local auth, check auth status, disable/enable global fallback, and logout global auth.
- **Dependencies / required prior state:** Authenticated admin session.
- **Problems / friction:** This is not fragmented internally, but it is a distinctly operator-only surface and should not be promoted from ordinary owner workflows except when needed.
- **Recommended future home / responsibility:** Keep as the global operator auth control surface only.

### `/portal/admin/ai/skills`

- **Route / path:** `/portal/admin/ai/skills`
- **Audience / role:** Administrators only.
- **Purpose:** Manage the AI skill library.
- **Primary entry points:** Admin secondary nav.
- **Key content / actions:** Skill creation, editing, deletion, tool-capability assignment, and skill inventory browsing.
- **Dependencies / required prior state:** Authenticated admin session.
- **Problems / friction:** Dense CRUD is expected here; the main IA requirement is simply to keep it out of standard user workflows.
- **Recommended future home / responsibility:** Keep as admin-only AI catalog configuration.

### `/portal/admin/ai/roles`

- **Route / path:** `/portal/admin/ai/roles`
- **Audience / role:** Administrators only.
- **Purpose:** Manage AI roles, prompts, dependencies, skills, and executor configuration.
- **Primary entry points:** Admin secondary nav.
- **Key content / actions:** Role creation, editing, deletion, prompt definition, dependency graph management, and executor settings.
- **Dependencies / required prior state:** Authenticated admin session.
- **Problems / friction:** Dense CRUD is expected; the route is conceptually clear even if operationally heavy.
- **Recommended future home / responsibility:** Keep as admin-only role-graph configuration.

### `/portal/admin/ai/agents`

- **Route / path:** `/portal/admin/ai/agents`
- **Audience / role:** Administrators only.
- **Purpose:** Manage agent composition and run ad-hoc admin-controlled agent jobs.
- **Primary entry points:** Admin secondary nav.
- **Key content / actions:** Agent CRUD, role-link ordering, manual queue-an-agent-run form, and workspaces/sources selection for admin runs.
- **Dependencies / required prior state:** Authenticated admin session plus existing workspaces, sources, and AI catalog records.
- **Problems / friction:** This route legitimately mixes configuration and execution because the product spec keeps agent-run controls here; it is still an operator surface rather than a normal owner flow.
- **Recommended future home / responsibility:** Keep agent configuration and admin-triggered agent execution together here, but avoid promoting this route into normal workspace navigation.

### `/api/auth/*`

- **Route / path:** `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`
- **Audience / role:** Browser session support flow; not an intentional IA destination except for login/logout actions.
- **Purpose:** Handle login redirect, code exchange, session establishment, and logout teardown.
- **Primary entry points:** Public login CTA, portal auth guards, logout actions.
- **Key content / actions:** Redirect to Keycloak or local-dev session, verify callback state, set cookies, clear cookies, and redirect back to the portal or pricing.
- **Dependencies / required prior state:** Browser session state, configured IdP in non-local mode, valid callback state for code exchange.
- **Problems / friction:** These support routes are currently used directly in visible CTAs, which exposes implementation paths rather than product language.
- **Recommended future home / responsibility:** Keep as support-only transport routes behind product-labelled buttons such as “Log in” or “Log out”.

### `/api/proxy/*`

- **Route / path:** `/api/proxy/[...path]`
- **Audience / role:** Browser support flow only.
- **Purpose:** Bridge the Next app to the internal API while forwarding session, bearer, CSRF, and SSE traffic.
- **Primary entry points:** Client components and browser fetches inside portal actions.
- **Key content / actions:** Forward request headers/body to the internal API, preserve SSE, and normalize upstream errors.
- **Dependencies / required prior state:** Browser session or token state and a reachable internal API.
- **Problems / friction:** The route is essential but invisible to product IA, and it is not covered by the current hosted web spec.
- **Recommended future home / responsibility:** Keep as infrastructure-only support, documented outside the user-facing route map after IA acceptance.

### `/auth/github/callback`

- **Route / path:** `/auth/github/callback`
- **Audience / role:** GitHub App installation handoff only.
- **Purpose:** Finish GitHub App linking and redirect the user back to the correct workspace settings page.
- **Primary entry points:** GitHub App installation/update callback.
- **Key content / actions:** Read callback params, call the internal link endpoint, then redirect to workspace settings with success/failure query state.
- **Dependencies / required prior state:** GitHub installation callback, session cookies or bearer token, workspace-link state.
- **Problems / friction:** Invisible to users, but critical to workspace settings ownership; it is also not represented in the current hosted web spec.
- **Recommended future home / responsibility:** Keep as a support route owned by workspace settings and GitHub integration flows.

### `/api/commercial-contact`

- **Route / path:** `/api/commercial-contact`
- **Audience / role:** Commercial contact form transport only.
- **Purpose:** Forward public commercial inquiries to the internal API.
- **Primary entry points:** `/commercial` form submission.
- **Key content / actions:** Accept JSON payload from the form and proxy it to the internal API.
- **Dependencies / required prior state:** Public form submission and reachable internal API.
- **Problems / friction:** None structurally; it is a clean support route.
- **Recommended future home / responsibility:** Keep as the transport endpoint behind the commercial form, not a navigable route.

## Spec Reconciliation

- The hosted web spec now documents support routes such as `/api/auth/*`, `/api/proxy/*`, `/auth/github/callback`, and `/api/commercial-contact`.
- The portal primary nav now matches the target product shell: `workspaces`, `settings`, and admin-only `admin`, without `pricing` or `commercial`.
- The spec now captures the three-scope Codex auth model. The implementation spreads auth ownership across:
  - `/portal/settings` for user auth
  - `/portal/workspaces/[workspaceId]/settings` for workspace auth
  - `/portal/admin/ai/auth` for global fallback
  - `/portal/workspaces/[workspaceId]/runs` for per-run scope selection
- The spec says the workspace overview should show summary state and navigation only. The implementation also includes recent-run and member previews, which is light drift but still a drift.
- The spec now describes reusable workspace secrets as workspace settings responsibility, while Runs only selects saved secrets for a queued run.
- The spec is otherwise directionally aligned on the major workspace route split: Sources, Runs, Code, Reports, Access, and Settings each exist and are distinct.

## Fragmentation diagnosis

- **Portal boundary leak:** Public/commercial choices have been removed from primary portal navigation, but some portal jump-card grids still promote marketing/admin routes.
- **Configuration spread across too many places:** User auth, workspace auth, global auth, and per-run auth selection are intentionally scoped to different owners, but the UI must keep those boundaries explicit.
- **Workspace overview duplicates child-route value:** Overview previews recent runs and members even though Runs and Access are already dedicated routes.
- **Runs is dense:** Queueing, run history, auth education, and auth-scope selection are bundled together, though reusable secret management has moved to settings.
- **Code is overloaded:** It acts both as a workspace-level source selector and as a deep review surface for files, diffs, PRs, and finding-linked remediation inspection.
- **Public decision pages are repetitive:** Home, Pricing, License, and Commercial all restate the same hosted-versus-commercial split with only minor variation.
- **Admin promotion is noisy:** Admin surfaces are correctly isolated, but normal owner routes still surface admin entry points too often.

## Owner-centric UX flow

1. **Discover the product:** Start on `/` to understand SpecLens as specification-driven QA.
2. **Choose the commercial path:** Use `/pricing` if the question is hosted plan access; use `/commercial` if the question is rights, procurement, or self-hosting; use `/license` if the distinction is unclear.
3. **Authenticate:** Use the product-labelled login action, which resolves to `/api/auth/login`, and land in `/portal/workspaces`.
4. **Create or choose a workspace:** Use `/portal/workspaces` as the signed-in home for workspace creation and selection.
5. **Prepare shared workspace configuration when needed:** Use `/portal/workspaces/[workspaceId]/settings` before intake if private GitHub access, billing, GitHub installations, reusable run secrets, or workspace-level auth are needed.
6. **Connect sources:** Use `/portal/workspaces/[workspaceId]/sources` to add and verify repositories or archive uploads.
7. **Queue work:** Use `/portal/workspaces/[workspaceId]/runs` to choose the source, task, optional companion source, and execution auth scope.
8. **Inspect execution:** Use `/portal/workspaces/[workspaceId]/runs/[jobId]` to watch the live plan, logs, artifacts, and terminal status.
9. **Review the result:** Use `/portal/workspaces/[workspaceId]/reports` and `/portal/workspaces/[workspaceId]/reports/[reportId]` to review the release gate, sections, findings, artifacts, and remediation options.
10. **Inspect exact code context:** Follow report or run links into `/portal/workspaces/[workspaceId]/code` with source/report/finding context to inspect files, refs, diffs, and remediation changes.
11. **Manage collaborators and persistent settings:** Use `/portal/workspaces/[workspaceId]/access` for members and `/portal/workspaces/[workspaceId]/settings` for workspace integrations/configuration; use `/portal/settings` for personal session and personal Codex auth.

## Target IA and route responsibility

### Canonical route clusters

| Cluster | Routes | Single responsibility |
|---|---|---|
| Public marketing and legal | `/`, `/pricing`, `/license`, `/commercial`, `/privacy`, `/terms` | Explain the product, hosted plans, rights model, and trust/policy terms |
| Portal home and account | `/portal`, `/portal/workspaces`, `/portal/settings` | Enter the signed-in product, choose workspaces, and manage personal account/auth |
| Workspace operations | `/portal/workspaces/[workspaceId]` and child routes | Operate one workspace end-to-end |
| Admin AI control plane | `/portal/admin/ai/*` | Operator-only AI catalog and global auth control |
| Support/system | `/api/auth/*`, `/api/proxy/*`, `/auth/github/callback`, `/api/commercial-contact` | Session, transport, callback, and form plumbing |

### Target navigation model

- **Public header:** `Home`, `Pricing`, `License model`, and `Commercial licensing`.
- **Public footer:** `Pricing`, `Portal`, `License model`, `Commercial`, `Terms`, and `Privacy`.
- **Portal primary nav:** `Workspaces`, `Settings`, and `Admin` for admins only.
- **Workspace secondary nav:** `Overview`, `Sources`, `Runs`, `Reports`, `Code`, `Access`, `Settings`.
- **Admin secondary nav:** `Auth`, `Skills`, `Roles`, `Agents`.

### Content moves and ownership

- Keep `/portal/settings` as the only user-level settings route. It should own personal identity/session state and personal Codex auth, not marketing or operator promotion.
- Keep `/portal/workspaces/[workspaceId]/settings` as the workspace-level configuration surface. It should own billing, GitHub installation state, workspace auth, repository visibility, and reusable workspace configuration such as secrets.
- Keep `/portal/workspaces/[workspaceId]/runs` as the execution entrypoint. It should own queueing, task/source/auth-scope selection, and run history, but not durable workspace configuration.
- Keep `/portal/workspaces/[workspaceId]` as a summary and navigation hub only. It should not become a parallel management screen for members, sources, or runs.
- Keep `/portal/workspaces/[workspaceId]/reports/[reportId]` as the primary decision surface for release gate, findings, export, remediation launch, and jumps into code.
- Keep `/portal/workspaces/[workspaceId]/code` as the code-review and evidence-inspection route, usually entered from reports, runs, or an intentional source selection.
- Keep `/portal/workspaces/[workspaceId]/access` as the sole owner of membership management.
- Keep `/portal/admin/ai/*` as a separate operator cluster with no primary-nav promotion inside normal workspace flows.
- Keep `/commercial` and `/api/commercial-contact` as the only commercial contract intake path.

### Recommended route-by-route future responsibility

- **`/`** should introduce SpecLens and route users to either hosted pricing or commercial licensing.
- **`/pricing`** should compare hosted plans only, with a short rights/self-hosting callout.
- **`/license`** should be the canonical rights model explainer.
- **`/commercial`** should focus on qualification, procurement, and contact intake.
- **`/privacy` and `/terms`** should remain policy pages and move out of the header.
- **`/portal/workspaces`** should stay the signed-in home for create/select workspace.
- **`/portal/settings`** should stay the personal account/auth surface.
- **Workspace Overview** should stay the summary hub and stop accumulating more operational ownership.
- **Sources** should remain the only source-lifecycle route.
- **Runs** should remain the only run-queue/history route.
- **Run detail** should remain the only execution-monitoring route.
- **Reports** should remain the only report directory route.
- **Report detail** should remain the only release-gate/remediation decision route.
- **Code** should remain the deep inspection route, not a second workspace dashboard.
- **Access** should remain the only membership route.
- **Workspace Settings** should remain the only workspace configuration/integration route.
- **Admin AI** should remain an operator-only control plane.
- **Support routes** should stay absent from user nav while remaining documented as support infrastructure.

## Prioritized cleanup backlog

### P0 - structural confusion

- Completed: removed `Pricing` and `Commercial` from the portal primary nav.
- Completed: moved reusable workspace secret management off `/portal/workspaces/[workspaceId]/runs` and into workspace settings.
- Completed: kept auth registration ownership strict:
  - user auth in `/portal/settings`
  - workspace auth in `/portal/workspaces/[workspaceId]/settings`
  - global auth in `/portal/admin/ai/auth`
  - auth-scope selection in `/portal/workspaces/[workspaceId]/runs`
- Completed: updated `specs/speclens/speclens-hosted-web.md` to capture support routes, auth-scope ownership, reusable secret ownership, and the cleaned navigation model.

### P1 - UX flow cleanup

- Completed: reordered the workspace secondary nav to the owner journey: `Overview -> Sources -> Runs -> Reports -> Code -> Access -> Settings`.
- Recast the workspace overview as a lighter summary hub and avoid adding more preview/detail ownership there.
- Make the code route’s source-selection state visually distinct from its deep review state.
- Add clearer “next step” cues from Sources to Runs, from Runs to Reports, and from Reports to Code/Remediation.
- Make run-detail titles task-first and source-aware instead of job-id-first.

### P2 - copy and secondary polish

- Reduce repeated hosted-versus-commercial messaging across `/`, `/pricing`, `/license`, and `/commercial`.
- Move `Terms` and `Privacy` out of the public header and keep them in footer trust navigation.
- Trim repetitive jump-card clusters on portal settings, workspace directory, access, and workspace settings.
- Reduce repeated stats blocks where they do not change the user’s next decision.

## Notes

- The primary narrative in this audit is the workspace owner flow. Member/reviewer usage is still supported, but it should ride on top of the same report-and-code review structure rather than define a separate IA.
- Admin/operator routes are intentionally treated as a separate control-plane cluster, not as part of the core owner journey.
- This issue records the analysis and proposed structure only. A follow-up implementation should update the hosted web spec and then refactor routes/navigation to match the accepted target IA.
