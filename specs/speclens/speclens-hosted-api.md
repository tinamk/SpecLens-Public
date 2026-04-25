# SpecLens Hosted API

## Goal

Define the hosted API control plane surface for the active hosted product in Iteration 5.

## Scope (IN)

- user, workspace, source, job, report, billing, and integration routes
- analysis-task, role, and workspace-secret routes

## Scope (OUT)

- legacy local-only HTTP API

## Definitions (Source of truth)

- **Hosted API**: `apps/api`

## Rules

### R1 - Core routes
1. The API must expose `/health`, `/api/me`, workspace routes, workspace code-review routes, job routes, report routes, remediation/export routes, billing routes, and integration routes.
2. The API must expose a log streaming route for job output.
3. The API must expose analysis-task and role discovery routes for the normal hosted product path.
4. The API must allow workspace secret registration for parity runs that need protected browser auth material.
5. Analysis job submission must accept only agent-task-aligned inputs.
6. Browser-oriented runs created through the hosted API must be able to use stored workspace secrets to reach protected routes during sandbox execution.
7. Analysis job submission must return a queued job envelope immediately and expose later completion through the job/report routes.
8. Billing and GitHub integration routes must update hosted app state rather than returning fixed placeholder payloads.
9. Source intake must accept only Git-backed sources.
10. Source intake must support public Git repository URLs over `https` from approved hosted providers (`github.com`, `gitlab.com`, `bitbucket.org`, `codeberg.org`), private GitHub repository URLs through the GitHub App, and uploaded Git repository archives that retain `.git` metadata. Local filesystem paths, arbitrary remote Git hosts, and raw source archive URLs are not part of the hosted product surface.
11. Completed reports must support queued bounded remediation that works from a Git-backed source in an isolated temp clone/worktree and returns a remediation job immediately while later persisting a reviewable changeset manifest plus patch artifacts.
12. The API must expose cached Git review reads for source refs, tree/file/diff inspection, remediation changesets, and GitHub pull requests when the source provider supports them.
13. Workspace member, source, secret, repository, and job list routes may expose query-driven filtering and pagination using `q`, `page`, `pageSize`, and surface-specific filters while preserving the existing hosted route map.

## Acceptance checks
1. `/health` returns success.
2. workspace creation and job submission routes exist.
3. the log stream route exists.
4. analysis-task and role discovery routes exist.
5. a hosted browser-oriented job can be submitted with a workspace credential secret and return browser self-check sections in the report.
6. a queued job can be polled until it reaches a terminal status.
7. billing checkout plus Stripe/GitHub webhook routes mutate hosted app state in local validation.
8. a public Git repository URL can be added as a source and queued for analysis.
9. a non-Git website URL or raw source archive URL is rejected during source intake.
10. a queued analysis job can optionally pair a primary source with a companion source for one combined run.
11. a completed report can queue a bounded remediation job and later expose changed files, validation output, stop reason, artifacts, and pull instructions without mutating the source repository in place.
12. a Git-backed source can be inspected through the workspace code-review API for refs, tree/file/diff content, remediation changesets, and GitHub PR metadata when applicable.
