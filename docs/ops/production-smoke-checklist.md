# Production Smoke Checklist

Use this after each deployment before declaring the release healthy.

1. Login via Keycloak succeeds and redirects to `/portal/workspaces`.
2. Create a workspace and confirm it appears in `/portal/workspaces`.
3. Open the workspace overview, sources, runs, reports, access, and settings routes.
4. Add a public Git source from `/portal/workspaces/<id>/sources`.
5. Queue a run from `/portal/workspaces/<id>/runs` and confirm `queued -> running -> succeeded`.
6. Open `/portal/workspaces/<id>/runs/<jobId>` and confirm concise and verbose log modes render.
7. Open `/portal/workspaces/<id>/reports/<reportId>` and confirm report sections, findings, and artifact download links render.
8. Open `/portal/workspaces/<id>/settings` and confirm entitlement, checkout entrypoint, GitHub installation state, and repository inventory render.
9. If dedicated admin credentials exist, open `/portal/admin/ai/auth`, `/skills`, `/roles`, and `/agents`.
10. Verify `/ready` and `/metrics` are reachable for API and runner.
11. Trigger a test Stripe webhook (signed) and confirm entitlement change.
12. Trigger a GitHub webhook (signed) and confirm installation status.
13. Confirm audit logs are written and exportable (`npm run audit:export`).
