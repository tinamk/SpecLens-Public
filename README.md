# SpecLens

SpecLens is a spec-driven development toolkit. Iteration 2 is TagTwo-first: the primary workflow analyses a repo through explicit specs, deterministic repo checks, and npm license-policy compliance reports without needing a live UI or credentials. Archived client reports remain in the repo as iteration-1 evidence, and TagTwo now also has an optional local-only self-check bootstrap path for browser-visible smoke findings without any external API.

## Current focus

- Primary profile: `tagtwo`
- Archived legacy profile: `client-legacy`
- Active data reports: `reports/projects/tagtwo/`
- TagTwo dashboard: `reports/TagTwo/ai-results.html`
- Archived iteration-1 evidence: `reports/client/`

## Stack

- Frontend demo: React + TypeScript + Vite
- CLI: Node.js ESM scripts in `tools/`
- Legacy AI tooling: Anthropic Claude (`@anthropic-ai/sdk`) for older visual/spec flows
- Legacy browser tooling: Playwright for older client visual workflows

## Quick start

```bash
npm install
npm run validate:local
npm run speclens:tagtwo:analyze
npm run speclens:tagtwo:results
```

This default path runs against `fixtures/tagtwo-mini/`, writes report data to `reports/projects/tagtwo/`, and writes the standalone TagTwo dashboard to `reports/TagTwo/ai-results.html`.

## Commands

### TagTwo

| Command | Description |
|---|---|
| `npm run speclens:tagtwo` | Open the TagTwo dashboard |
| `npm run speclens:tagtwo:inventory` | Build the TagTwo repo inventory |
| `npm run speclens:tagtwo:spec-check` | Run deterministic TagTwo repo-policy checks |
| `npm run speclens:tagtwo:license` | Run the TagTwo license-policy checker |
| `npm run speclens:tagtwo:selfcheck` | Crawl a local TagTwo URL, capture deterministic browser findings, and refresh the dashboard |
| `npm run speclens:tagtwo:analyze` | Run inventory -> spec-check -> license -> results |
| `npm run speclens:tagtwo:results` | Open the TagTwo HTML dashboard |
| `npm run speclens:tagtwo:results:serve` | Serve the TagTwo dashboard over HTTP |

### client

| Command | Description |
|---|---|
| `npm run speclens:client` | Open the archived client dashboard |
| `npm run speclens:client:results` | Open the client HTML dashboard |
| `npm run speclens:client:results:serve` | Serve the client dashboard over HTTP |
| `npm run speclens:client:discover` | Run the legacy component discovery flow |
| `npm run speclens:client:spec-check` | Run the legacy client spec-check flow |
| `npm run speclens:client:visual` | Run the legacy visual workflow |
| `npm run speclens:client:visual-filter` | Post-process client visual findings |
| `npm run speclens:client:chaos` | Run the client chaos-advisor phase |
| `npm run speclens:client:interaction` | Run the client interaction test flow |
| `npm run speclens:client:interaction:defence` | Run defence interaction tests |
| `npm run speclens:client:interaction:monitoring` | Run monitoring interaction tests |
| `npm run speclens:client:interaction:quality` | Run quality interaction tests |
| `npm run speclens:client:analyze` | Run the defence analyze flow |
| `npm run speclens:client:analyze:defence` | Run defence spec-check + visual -> results |
| `npm run speclens:client:analyze:monitoring` | Run monitoring spec-check + visual -> results |
| `npm run speclens:client:analyze:quality` | Run quality spec-check + visual -> results |
| `npm run speclens:client:analyze:metadata` | Run metadata spec-check -> results |
| `npm run speclens:client:pipeline` | Run the full defence pipeline |
| `npm run speclens:client:pipeline:defence` | Run the full defence pipeline |
| `npm run speclens:client:pipeline:monitoring` | Run the full monitoring pipeline |
| `npm run speclens:client:pipeline:quality` | Run the full quality pipeline |

### Shared

| Command | Description |
|---|---|
| `npm run validate:local` | Lint + spec lint + task extraction + build |

## How iteration 2 works

### 1. Repo inventory

`tools/repo-inventory.mjs` scans repo files and npm manifests and writes:

- `reports/projects/tagtwo/repo-inventory.json`
- `reports/projects/tagtwo/repo-inventory.md`

### 2. Local spec-check

`tools/spec-checker.mjs` now supports a deterministic local mode for `repo-json` profiles. TagTwo specs in `specs/tagtwo/` define binary, auditable checks evaluated from the repo inventory.

### 3. License-policy checker

`tools/license-checker.mjs` reads npm-style manifests and evaluates:

- missing license fields
- invalid SPDX expressions
- broken `SEE LICENSE IN <filename>` references
- allow / review / block policy outcomes from `policies/license-policy.json`
- human-approved patch drafts for the root manifest only

The wording is intentionally policy-oriented: findings describe potential policy violations or review-needed states, not legal certainty.

Data-source hierarchy:

- use `package-lock.json` to enumerate the dependency tree when available
- use package manifests to read declared license metadata
- if installed package manifests are unavailable, the report marks coverage as reduced instead of implying full certainty

### 4. Results dashboard

`tools/results-viewer.mjs` renders standalone profile dashboards. TagTwo is written to `reports/TagTwo/ai-results.html`, while the archived client dashboard remains preserved at `reports/client/ai-results.html`.

### 5. Optional local TagTwo self-check

`tools/tagtwo-selfcheck.mjs` can crawl a running local TagTwo app, capture screenshots, and report:

- navigation failures
- uncaught page errors
- console errors
- failed same-origin requests
- missing title, `main`, or `h1`

The crawl starts from the configured entry URL, follows same-origin links, and can also seed extra
static routes from the running local router source when the dev server exposes it. You can still cap
coverage with `--max-pages`, or add manual extras with `--seed-paths=/route-a,/route-b`.

Protected routes can also be crawled without storing a Google username/password in an env file.
The self-check now treats logged-in coverage as the normal path. If local TagTwo bot credentials are
available in `.env` as `SPECLENS_TAGTWO_USERNAME` and `SPECLENS_TAGTWO_PASSWORD`, the self-check
will use them first to mint a real authenticated session and save a reusable local Playwright auth
state automatically. If those env vars are not set, it falls back to opening a browser so you can
complete the normal Google login manually:

```bash
npm run speclens:tagtwo:selfcheck
```

That saves the session to `.speclens/tagtwo-auth-state.json`. Later self-check runs reuse that saved
session automatically. If it goes stale, run `npm run speclens:tagtwo:selfcheck -- --capture-auth`
to refresh it. If you intentionally want the old public-route crawl, run
`npm run speclens:tagtwo:selfcheck -- --anonymous`. By default the self-check launches the Chrome
browser channel for this login step; use `--browser-channel=<name>` only if you intentionally want a
different installed Chromium-based browser.

The credential bootstrap also supports optional TagTwo-specific Auth0 overrides through env vars
such as `SPECLENS_TAGTWO_AUTH0_DOMAIN`, `SPECLENS_TAGTWO_AUTH0_CLIENT_ID`,
`SPECLENS_TAGTWO_AUTH0_AUDIENCE`, `SPECLENS_TAGTWO_AUTH0_REALM`, and
`SPECLENS_TAGTWO_AUTH0_SCOPE`, but the current local TagTwo defaults are used automatically when
those are omitted.

If Google blocks login inside the automated browser, attach the self-check to an already-running
logged-in Chrome instead:

```bash
chrome.exe --remote-debugging-port=9222
npm run speclens:tagtwo:selfcheck -- --connect-cdp=http://127.0.0.1:9222
```

That path reuses the existing Chrome session for `app.localtest.me` and avoids trying to automate
the Google sign-in form inside Playwright.

The output is written to:

- `reports/projects/tagtwo/web-selfcheck-report.json`
- `reports/projects/tagtwo/web-selfcheck-report.md`
- `reports/projects/tagtwo/selfcheck/screenshots/`

If you want to refresh the first TagTwo web baseline spec after review, run:

```bash
npm run speclens:tagtwo:selfcheck -- --write-spec-draft
```

## Fixture and reproducibility

- Reproducible fixture repo: `fixtures/tagtwo-mini/`
- Fresh-clone baseline: `npm ci && npm run validate:local`
- Fixture-backed analysis: `npm run speclens:tagtwo:analyze`

## Non-goals for iteration 2

- No legal determinations
- No transitive auto-fixes or patch drafts for third-party dependencies
- No API-backed TagTwo visual judgment or auto-patching yet

## Legacy client workflow

The original client/Svelte/browser-driven workflow is preserved as historical evidence and optional legacy capability. It still depends on legacy visual tooling and, for some flows, Anthropic credentials or a live app.

Useful archived assets:

- `reports/client/ai-results.html`
- `reports/client/index.html`
- `docs/iteration-1-baseline.md`

Useful commands:

- `npm run speclens:client:results`
- `npm run speclens:client:analyze:defence`

## Thesis / iteration docs

- Iteration 1 baseline: `docs/iteration-1-baseline.md`
- Iteration 2 evaluation baseline: `docs/iteration-2-evaluation.md`
- Iteration 2 architecture: `docs/iteration-2-architecture.md`
- Iteration 1 vs 2 comparison: `docs/iteration-1-vs-2.md`
