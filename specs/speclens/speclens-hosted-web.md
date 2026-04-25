# SpecLens Hosted Web

## Goal

Define the current hosted marketing, portal, workspace, settings, admin, job, and report surfaces for the active hosted product.

## Definitions

- **Hosted web app**: `apps/web`
- **Public site**: marketing, pricing, and legal routes
- **Portal primary areas**: `workspaces`, account-level `settings`, and admin-only `admin`
- **Workspace-owned settings**: entitlement, billing entrypoints, GitHub installation state, installation inventory, installation repositories, workspace-level Codex auth, and reusable run secrets across all linked workspace installations
- **Supporting routes**: API handlers, auth callbacks, proxy handlers, and contact handlers that support user-facing routes but are not direct product destinations

## Route Map

### Public routes

- `/`
- `/login`
- `/pricing`
- `/license`
- `/commercial`
- `/privacy`
- `/terms`

### Portal entry

- `/portal` redirects to `/portal/workspaces`

### Authenticated portal routes

- `/portal/workspaces`
- `/portal/workspaces/[workspaceId]`
- `/portal/workspaces/[workspaceId]/sources`
- `/portal/workspaces/[workspaceId]/code`
- `/portal/workspaces/[workspaceId]/runs`
- `/portal/workspaces/[workspaceId]/runs/[jobId]`
- `/portal/workspaces/[workspaceId]/reports`
- `/portal/workspaces/[workspaceId]/reports/[reportId]`
- `/portal/workspaces/[workspaceId]/access`
- `/portal/workspaces/[workspaceId]/settings`
- `/portal/settings`
- `/portal/admin/ai/auth`
- `/portal/admin/ai/skills`
- `/portal/admin/ai/roles`
- `/portal/admin/ai/agents`

### Supporting system routes

- `/api/auth/*`
- `/api/proxy/*`
- `/auth/github/callback`
- `/api/commercial-contact`

## Rules

### R1 - Public site

1. The public site must keep the hosted SaaS and code-license distinction explicit.
2. Public pages must share one stable navigation contract and stable CTA test IDs.
3. Every public route must expose one page-level readiness marker for E2E coverage.

### R2 - Portal IA

1. Workspace overview must show summary state and navigation only, not the full operational surface.
2. Source intake must live only in the workspace sources route.
3. Run queueing and recent job history must live only in the workspace runs route.
4. Git tree, diff, changeset, and PR review must live only in the workspace code route.
5. Report history and report review must live only in the workspace reports routes.
6. Membership and access state must live only in the workspace access route.
7. Billing, GitHub installation state, workspace-level Codex auth, and reusable workspace run secrets must live only in the workspace settings route.
8. Global portal settings must stay separate from workspace-owned settings and must own user-level Codex auth.
9. Authenticated portal primary navigation must not mix public marketing routes into the product shell; marketing pages remain reachable from public navigation and explicit page CTAs.
10. Workspace navigation order must follow the owner workflow: overview, sources, runs, reports, code, access, settings.

### R3 - Queueing and reports

1. The queue form must present AI-task selection, source selection, optional companion-source selection, scoped Codex auth selection, and optional workspace run secret selection.
2. The job route must present terminal/log styling and explicit verbosity switching.
3. The report route must render normalized sections, findings, artifacts, release gate state, and remediation summary from the hosted report payload.
4. The code route must render Git tree, file or diff content, changeset inventory, and GitHub PR metadata when available.
5. Report-side remediation launch must create a queued remediation run and redirect users to the run detail instead of doing synchronous work in the browser request.
6. Report-to-code navigation must stay source-correct: the UI must not silently guess the wrong repository when a report references more than one Git source.

### R4 - Admin AI

1. Admin AI must be split into focused auth, skills, roles, and agents routes.
2. Agent execution controls must stay with the agents route.
3. `/portal/admin/**` and `/api/admin/ai/**` must require explicit admin authorization.
4. Global Codex auth must expose an admin-controlled disable flag and must never override user-level or workspace-level auth when a run explicitly selects either scoped source.

### R5 - Browser testability

1. User-interactable surfaces must expose stable, semantic `data-testid` values.
2. Test IDs must be namespaced by surface area:
   `public-*`, `portal-settings-*`, `workspace-index-*`, `workspace-overview-*`, `workspace-sources-*`, `workspace-runs-*`, `workspace-settings-*`, `workspace-access-*`, `report-*`, and `admin-ai-*`.
3. Deterministic GitHub E2E must request the real install URL from SpecLens, assert its shape, simulate the callback with a real installation id, and avoid the GitHub browser UI flow.

## Acceptance Checks

1. `/`, `/login`, `/pricing`, `/license`, `/commercial`, `/privacy`, and `/terms` render with shared public navigation and page-level readiness markers.
2. `/portal` lands on `/portal/workspaces`.
3. `/portal/workspaces` renders workspace creation and workspace directory state.
4. Workspace overview links into dedicated sources, runs, reports, access, and settings routes.
5. The workspace sources route supports only Git-backed `git-public`, `upload-archive`, and `github-private` source flows. Public Git source entry must be constrained to approved hosted providers over `https`, and the UI must not offer local-path, arbitrary-host Git, non-Git website, or raw-archive source intake.
6. The workspace runs route allows AI-task queueing with an optional companion source, scoped Codex auth selection, optional workspace run secret selection, and recent job history. It must not own durable secret management.
7. The workspace code route exposes source selection, ref selection, tree browsing, code or diff viewing, changesets, and GitHub PR metadata when supported.
8. The workspace runs job route exposes concise and verbose log modes.
9. The workspace reports routes expose report history, report review, and queued remediation launch/readiness summary for the active report.
10. The workspace settings route exposes entitlement, billing entrypoints, GitHub link state, installations, installation repositories grouped across linked workspace installations, workspace-level Codex auth, and reusable workspace run secret management.
11. Workspace list surfaces may use query-driven search and pagination inside the existing routes as long as the hosted route map stays unchanged.
12. Admin auth, skills, roles, and agents routes exist and are admin-only.
13. User-level, workspace-level, and global Codex auth surfaces are documented as separate scopes, and each run must use only the selected scoped auth source.
