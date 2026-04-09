# SpecLens TagTwo Self-Check

## Goal
`tools/tagtwo-selfcheck.mjs` provides a local-only bootstrap loop for TagTwo. It crawls a running
same-origin TagTwo web app with Playwright, can optionally reuse a locally saved authenticated
browser session, records deterministic browser-visible failures, writes structured report output,
and can refresh the TagTwo web bootstrap spec after explicit approval.

## Scope (IN)
- Base URL and optional start-path handling for a live local TagTwo app
- Same-origin route discovery from page links
- Optional route seeding from configured paths and accessible local-dev router source modules
- Optional env-driven Auth0 password-realm bootstrap for local bot credentials
- Optional reuse of a local Playwright storage-state file for authenticated protected-route coverage
- Optional attachment to an already-running Chrome session over CDP for reusing a real logged-in browser
- Optional interactive auth capture that lets a developer complete the normal Google login manually
- Deterministic finding types: navigation failures, HTTP failures, uncaught page errors, console
  errors, failed same-origin requests, missing title, missing main landmark, missing primary heading
- Full-page screenshot capture for each visited page
- JSON and Markdown report output under `reports/projects/tagtwo/`
- Proposal output including an approval-gated spec-draft refresh path
- Optional `--write-spec-draft` support for `specs/tagtwo/tagtwo-web-bootstrap.md`

## Scope (OUT)
- Any AI or external model API calls
- Automatic code patches to the target application
- Deep visual-quality judgment beyond deterministic smoke checks
- Credential harvesting or arbitrary third-party login form automation

## Definitions (Source of truth)
- **Self-check page**: One visited same-origin page in the crawl result
- **Finding**: A deterministic browser-visible problem captured during a page visit
- **Proposal**: A suggested next change, always requiring explicit approval before any write
- **Bootstrap spec draft**: `specs/tagtwo/tagtwo-web-bootstrap.md`, refreshed from observed routes
- **Same-origin route**: A URL sharing the configured origin; fragments are ignored for deduplication
- **Auth state**: A local Playwright storage-state file that captures cookies and browser storage for
  later authenticated self-check runs
- **Credential auth bootstrap**: A local-only flow that exchanges env-provided TagTwo bot credentials
  for real Auth0 tokens, passes them through the app's `/auth-callback` route, and saves the
  resulting browser storage state for later self-check runs

## Rules

### R1 - CLI inputs
1. The tool MUST accept `--profile`, `--url`, `--start-path`, `--max-pages`, `--seed-paths`, `--auth-state`, `--browser-channel`, `--connect-cdp`, `--capture-auth`, `--anonymous`, and `--write-spec-draft`.
2. The tool MUST accept both `--flag value` and `--flag=value` forms for those named flags.
3. When a script runner forwards named flags through `npm_config_*` environment variables, the tool
   MUST treat those values the same as explicit CLI flags.
4. The base URL MUST resolve in this order: `--url`, `SPECLENS_TAGTWO_URL`, profile config default.
5. The default profile is `tagtwo`.
6. The default start path is `/`.
7. The default max-pages value is 12.
8. `--seed-paths` MUST accept a comma-separated list of additional route paths to seed before crawling.
9. The auth-state path MUST resolve in this order: `--auth-state`, `SPECLENS_TAGTWO_AUTH_STATE`,
   profile config default, then `.speclens/<profile>-auth-state.json`.
10. The browser channel MUST resolve in this order: `--browser-channel`,
    `SPECLENS_TAGTWO_BROWSER_CHANNEL`, profile config default, then `chrome`.
11. The CDP connection URL MUST resolve in this order: `--connect-cdp`,
    `SPECLENS_TAGTWO_CONNECT_CDP`, profile config default, then `null`.
12. Local credential auth MUST read username/password from `SPECLENS_TAGTWO_USERNAME` and
    `SPECLENS_TAGTWO_PASSWORD` when both are present.
13. Local credential auth MUST resolve optional Auth0 settings from:
    `SPECLENS_TAGTWO_AUTH0_DOMAIN`, `SPECLENS_TAGTWO_AUTH0_CLIENT_ID`,
    `SPECLENS_TAGTWO_AUTH0_CLIENT_SECRET`, `SPECLENS_TAGTWO_AUTH0_AUDIENCE`,
    `SPECLENS_TAGTWO_AUTH0_REALM`, `SPECLENS_TAGTWO_AUTH0_SCOPE`, and
    `SPECLENS_TAGTWO_FROM_APP`, falling back to the current TagTwo local-dev defaults when unset.

### R2 - Crawl behaviour
1. The crawl MUST start from `new URL(startPath, baseUrl)`.
2. Before page visits begin, the tool MAY enqueue additional same-origin seed paths from:
   - configured `seedPaths`
   - `--seed-paths`
   - accessible local-dev router source modules exposed by the running app
3. Only same-origin links and same-origin seed paths may be enqueued for later visits.
4. Query strings and hash fragments MUST be ignored for deduplication to avoid state explosion.
5. The crawl MUST stop when the queue is empty or `max-pages` pages have been visited.
6. Each visited page MUST attempt `goto(..., waitUntil: "domcontentloaded")` and then try
   `networkidle` with a bounded timeout before continuing.
7. Router-based seed discovery SHOULD enqueue only static paths; parameterized or wildcard routes
   such as `:id` or `*` MUST NOT be auto-enqueued as crawl targets.
8. Unless `--anonymous` is provided, the tool MUST prefer authenticated coverage for protected
   routes instead of silently falling back to an anonymous crawl.
9. When a CDP connection URL is resolved, the tool MUST attach to that existing Chromium browser
   session and reuse its available browser context for the crawl instead of opening a fresh browser.
10. When the resolved auth-state file exists, and no CDP connection URL is being used, the tool
    MUST load it into the Playwright browser context before crawling unless an explicit auth refresh
    is requested.
11. When no auth-state file is available, or when `--capture-auth` is provided, and no CDP
    connection URL is being used, and `SPECLENS_TAGTWO_USERNAME` plus
    `SPECLENS_TAGTWO_PASSWORD` are present, the tool MUST:
    - exchange those credentials for real Auth0 tokens
    - verify the resulting access token against a protected TagTwo API route
    - drive the app's `/auth-callback` route with the returned tokens
    - save the resulting Playwright storage state to the resolved auth-state path
    - continue the crawl in that authenticated context
12. When no auth-state file is available, or when `--capture-auth` is provided, and no CDP
    connection URL is being used, and env credentials are not available, the tool MUST open a
    headed browser, let the developer complete the login flow manually, save the resulting auth
    state to the resolved path, and then continue the crawl in that authenticated context.
13. When `--anonymous` is provided, the crawl MUST skip auth-state loading and run anonymously.
14. The Playwright browser launch MUST use the resolved Chromium browser channel so the login step
    can target installed Chrome by default instead of Edge.

### R3 - Per-page evidence
1. Each visited page MUST record: URL, final URL, status code when available, title, first `h1`
   text when present, whether a `main` landmark exists, load duration, screenshot path, and
   discovered same-origin links.
2. Each page MUST capture a full-page screenshot unless page creation itself fails.
3. The tool MUST collect page errors, console messages, request failures, and HTTP responses with
   status code `>= 400` during each page visit.

### R4 - Finding generation
1. Navigation exceptions MUST produce a high-severity `navigation-failed` finding.
2. A main document response with status `>= 400` MUST produce a high-severity `http-failure` finding.
3. Uncaught `pageerror` events MUST produce a high-severity `page-error` finding.
4. Console `error` messages MUST produce a medium-severity `console-error` finding.
5. Failed same-origin document, script, stylesheet, fetch, or xhr requests MUST produce a
   medium-severity `request-failed` finding.
6. Missing document title, missing `main`, and missing `h1` MUST produce low-severity findings.
7. Findings MUST include a suggestion string and reference the page screenshot when available.

### R5 - Report output
1. JSON output MUST be written to `reports/projects/tagtwo/web-selfcheck-report.json`.
2. Markdown output MUST be written to `reports/projects/tagtwo/web-selfcheck-report.md`.
3. Screenshots MUST be written below `reports/projects/tagtwo/selfcheck/screenshots/`.
4. The JSON report MUST include: metadata, crawl summary, discovery information, `pages[]`, `findings[]`, `proposals[]`,
   `specDraft`, and auth/session metadata.
5. The Markdown report MUST include: Summary, Pages, Findings, Proposals, and Next Steps sections.

### R6 - Proposal handling
1. Every report MUST include a spec bootstrap proposal for `specs/tagtwo/tagtwo-web-bootstrap.md`.
2. The spec bootstrap proposal MUST state that approval is required before any write.
3. When `--write-spec-draft` is not provided, the tool MUST not modify any file under `specs/`.
4. When `--write-spec-draft` is provided, the tool MUST refresh
   `specs/tagtwo/tagtwo-web-bootstrap.md` from observed routes and current finding categories.

## Acceptance checks
1. Running `node tools/tagtwo-selfcheck.mjs --url http://app.localtest.me/` writes JSON and Markdown
   reports without requiring any API key.
2. Running `node tools/tagtwo-selfcheck.mjs` on a machine without an existing auth-state file opens
   the env-driven credential bootstrap when `SPECLENS_TAGTWO_USERNAME` and
   `SPECLENS_TAGTWO_PASSWORD` are set, instead of silently crawling anonymous protected routes.
3. Running `node tools/tagtwo-selfcheck.mjs --capture-auth` refreshes the saved auth state through
   env-driven credential login when those env vars are present.
4. Running with `--connect-cdp=http://127.0.0.1:9222` attaches the crawl to an already-running
   Chrome debugging session and can therefore reuse an already-authenticated app session.
5. If the resolved auth-state file exists, later self-check runs reuse it automatically.
6. Running with `--anonymous` intentionally restores the public-route crawl mode.
7. Running without a browser-channel override uses Chrome by default for the self-check browser.
8. The report records discovered same-origin routes up to `max-pages`.
9. When the running app exposes a readable router source module, the tool may seed additional static
   routes from that router before anchor-based crawling continues.
10. A page load failure appears as a `navigation-failed` or `http-failure` finding.
11. Console errors and request failures appear as deterministic findings with suggestions.
12. Running with `--write-spec-draft` refreshes `specs/tagtwo/tagtwo-web-bootstrap.md`.
13. Running without `--write-spec-draft` never edits the spec file.
14. Running `npm run speclens:tagtwo:selfcheck -- --url=http://127.0.0.1:4174/` uses that override
   instead of falling back to the configured default URL.
15. When env credentials are absent and no auth-state file exists, the tool still falls back to the
    manual login capture flow.

## Scenarios
### Scenario A
Given a local TagTwo app is running
When the developer runs `npm run speclens:tagtwo:selfcheck`
Then SpecLens crawls same-origin pages, stores screenshots, and writes a self-check report

### Scenario B
Given the app contains a route that throws during render
When the self-check visits that route
Then the report includes a high-severity `page-error` finding with the route screenshot

### Scenario C
Given the developer wants to create the first TagTwo web baseline spec
When they re-run the self-check with `--write-spec-draft`
Then `specs/tagtwo/tagtwo-web-bootstrap.md` is refreshed from observed routes and proposal notes

### Scenario D
Given protected TagTwo routes require authentication and local bot credentials are available in env
When the developer runs `npm run speclens:tagtwo:selfcheck`
Then the self-check exchanges those credentials for real tokens, saves a local auth state, and
later runs can reuse that state automatically

### Scenario E
Given protected TagTwo routes require authentication and env credentials are not available
When the developer runs `npm run speclens:tagtwo:selfcheck`
Then the self-check falls back to the manual browser login capture flow and saves the resulting auth
state for later runs

### Scenario F
Given the developer already has a logged-in Chrome session running with remote debugging enabled
When they run `npm run speclens:tagtwo:selfcheck -- --connect-cdp=http://127.0.0.1:9222`
Then the self-check attaches to that existing browser session and crawls protected routes without
trying to automate the Google sign-in form
