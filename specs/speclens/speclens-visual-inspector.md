# SpecLens Visual Inspector — Screenshot & Vision Analysis Tool

## Goal
`tools/visual-inspector.mjs` uses Playwright to navigate a running web application, capture
screenshots of every page and interactive state, and then uses Claude's vision API to identify
visual consistency problems — grouped by section. It outputs zoom screenshots of each finding's
exact location and maps findings back to source code.

## Scope (IN)
- Section map: which URLs belong to each section (`client-defence`, `client-monitoring`, `client-quality`)
- Authentication strategy: form-based login for all URLs (localhost and remote)
- Screenshot capture strategy: full page, sidebar interactions, dropdowns, time filters, filter panels, pagination, scroll
- Claude vision analysis: per-section batch calls and cross-section analysis
- Zoom screenshot capture: re-navigate and crop to finding's region with padding
- Code location: 4-level search strategy to map findings to source files
- Output: `reports/visual/screenshots/`, `visual-report.json`, `visual-report.md`
- Section filtering via `--section` flag

## Scope (OUT)
- The HTML dashboard (see `speclens-results-viewer.md`)
- Spec-text-based rule checking (see `speclens-spec-checker.md`)
- Network request interception or API mocking

## Definitions (Source of truth)
- **Section**: A named group of pages (e.g., `client-defence`) with its own set of URLs to visit
- **Page entry**: An object `{ name, url }` inside a section's page list
- **Region**: A `{ x, y, w, h }` object where all values are fractions 0–1 of the viewport dimensions,
  describing the bounding box of a visual finding
- **Zoom screenshot**: A cropped screenshot of the region where a finding was detected, with 80px padding
- **Comparison region**: A second `region` object pointing to the other element in a discrepancy
  finding (e.g., "button A vs button B")
- **Code location**: The source file, line number, and context lines (±5) where the violating string appears
- **Route fallback**: When no exact code match is found, the `+page.svelte` or `+page.ts` file for
  the current page URL is returned as a fallback location
- **BATCH_SIZE**: Number of screenshots sent to Claude in one vision call (currently 4)
- **Viewport**: Fixed at 1280×900 pixels for all screenshots

## Rules

### R1 — Section map
1. The `SECTIONS` constant must map each section name to an array of `{ name, url }` page entries
2. All page URLs must end with a trailing slash (SvelteKit uses `trailingSlash = 'always'`)
3. Sections currently defined: `client-defence` (5 pages), `client-monitoring` (2 pages), `client-quality` (1 page)
4. The `--section` CLI flag must filter `SECTIONS` to the named section only; if the section name is
   not found, the tool must exit with a clear error listing valid section names
5. When no `--section` flag is given, all sections are processed

### R2 — Authentication
1. The client-frontend app uses session-based form login for all URLs (localhost and remote alike) —
   HTTP Basic Auth does not work because protected routes redirect to `/login/?next=<url>`
2. For all base URLs: create a bare browser context (no `httpCredentials`), navigate to
   `{BASE_URL}/login/?next=/` with `waitUntil: "domcontentloaded"` and a 30-second timeout,
   fill the username and password fields using accessible role selectors, submit, and wait for the
   URL to leave the login page (10-second timeout)
3. Credentials are read from CLI flags `--username` / `--password` or from env vars `client_USERNAME` / `client_PASSWORD`
4. If `waitForURL` times out after submit, log a warning and continue — never abort the whole run
5. If the login navigation itself throws, log a warning and continue without auth — never crash
6. If a page navigation redirects to a login page (URL contains `/login` or `/auth`), attempt a retry
   with the trailing-slash variant of the URL before giving up
7. If auth fails and the page still shows a login form, take a screenshot and note "page may require
   additional authentication" — never abort the whole run

### R3 — Screenshot capture strategy
1. For each page entry, the tool must: navigate, wait for network idle, take a full-viewport screenshot,
   then attempt interaction screenshots
2. Navigation must use `waitUntil: "domcontentloaded"` with a 30-second timeout
3. After navigation, wait for network idle with an 8-second timeout; on timeout, wait an additional
   1 second and continue
4. Interaction attempts (in order): sidebar nav items, dropdown triggers, time filter buttons,
   filter panel buttons, then pagination
5. For pagination: find ALL `[class*="page-selector"]` containers (up to 4), walk 2 extra pages each,
   reset to page 1 when done — capture a screenshot after each page change
6. After interactions, scroll down 600px and take a second screenshot to capture below-fold content
7. Before taking any screenshot, hide all `<table>` and `<tbody>` elements via
   `element.style.visibility = "hidden"` — this prevents heavy data tables from blocking
   the screenshot renderer; the surrounding layout is preserved (no layout shift)
8. Maximum 8 screenshots per page to bound API cost
9. Each screenshot call must use a 30-second timeout; on timeout, wait 2.5 seconds and retry once;
   if the retry also times out, skip the screenshot and log a warning — never crash

### R4 — Claude vision analysis
1. Screenshots must be sent to Claude in batches of at most 4 (BATCH_SIZE)
2. Each Claude call must request findings as a JSON array with these fields per finding:
   - `type`: one of `"button"`, `"typography"`, `"color"`, `"spacing"`, `"component"`, `"icon"`, `"content"`, `"data-mismatch"`
   - `severity`: `"high"` | `"medium"` | `"low"`
   - `description`: plain-text description of the inconsistency
   - `location`: which screenshot label (e.g., `"Fraud Overview - screenshot 1"`)
   - `suggestion`: specific fix recommendation
   - `region`: `{ x, y, w, h }` fractions of viewport bounding the issue (optional but strongly requested)
   - `comparison_region`: second `{ x, y, w, h }` for the other element in a discrepancy (optional)
   - `search_text`: a short verbatim string from the UI that identifies the exact element (optional)
3. The prompt must explicitly instruct Claude NOT to report data discrepancies between a summary
   counter and a paginated table — these are not visual inconsistencies
4. JSON extraction from Claude's response must use `extractJsonArray()` (bracket-depth scanner),
   not a simple regex, to handle prose text that may contain bracket characters

### R5 — Zoom screenshots
1. For every finding that has a `region`, the tool must take a zoom screenshot
2. For every finding that has a `comparison_region`, the tool must take a second zoom screenshot
3. Zoom screenshots are taken in a grouped pass: all zoom crops for a given source page are taken
   in a single browser tab (navigate once, take N clips), not one tab per crop — this avoids
   repeatedly re-navigating to the same heavy page
4. Each unique source page is navigated using `waitUntil: "domcontentloaded"` with a 30-second timeout
5. The crop region must add 80px padding on all sides (clamped to viewport boundaries)
6. Zoom screenshots are saved to `reports/visual/screenshots/{section}/zoom-{n}-{slug}.png`
7. The `zoomScreenshot` (and `comparisonScreenshot`) file path must be stored on the finding object

### R6 — Code location (4-level search)
1. Level 1 — Exact match: search all `.svelte`, `.ts`, `.js` files under the source path for the
   exact `search_text` string (case-sensitive)
2. Level 2 — Case-insensitive match: repeat the search ignoring case
3. Level 3 — Word-by-word match: split `search_text` on whitespace, find the first file containing
   all words (case-insensitive)
4. Level 4 — Route fallback: if no match is found, return the `+page.svelte` file for the current
   page URL (map URL segments to route directory path)
5. On a successful match (levels 1–3), return: `{ file, line, preview, context, isRouteFallback: false }`
   where `context` is an array of `{ lineNum, text, isMatch }` objects for lines ±5 around the match
6. On route fallback (level 4), return the same shape with `isRouteFallback: true`
7. If no source path is configured and no files can be searched, set `codeLocations` to `[]`

### R7 — Output format
1. Screenshots saved to: `reports/visual/screenshots/{section}/{n}-{page-slug}-{state}.png`
   where `n` is a zero-padded 2-digit index and `state` is the interaction label (e.g., `dropdown`, `scroll`)
2. `visual-report.json` must be written to `reports/visual/` with this shape:
   ```json
   {
     "generatedAt": "<ISO>",
     "baseUrl": "<url>",
     "section": "<section|null>",
     "totalIssues": 12,
     "severityCounts": { "high": 2, "medium": 5, "low": 5 },
     "crossSectionIssues": [...],
     "sections": {
       "client-defence": {
         "pagesVisited": 5,
         "screenshotsTaken": 18,
         "issues": [{ ...finding, "zoomScreenshot": "...", "comparisonScreenshot": "...", "codeLocations": [...] }]
       }
     }
   }
   ```
3. `visual-report.md` must be written to `reports/visual/` with sections: Summary table,
   Cross-Section Issues, then one `##` heading per section containing issue cards

### R8 — Cross-section analysis
1. After all sections are processed, one representative screenshot per section must be sent to Claude
2. The prompt must ask for inconsistencies BETWEEN sections (different button styles, toolbar heights, etc.)
3. Cross-section findings are stored in `crossSectionIssues` in the JSON report
4. Cross-section analysis is skipped if fewer than 2 sections were processed

### R9 — Error handling and graceful degradation
1. Every interaction attempt (click, scroll, pagination) must be wrapped in try/catch — a failed
   interaction must log a warning and continue, never abort the page or section run
2. A failed screenshot (after retry) returns `null` — null values must be filtered out before
   sending screenshots to Claude
3. The `extractJsonArray()` function must be used (not a simple regex) to parse all Claude responses
4. If a Claude API call fails (network error, rate limit), log a warning and return an empty array —
   never crash the whole run
5. The tool must exit with code 0 even if some pages timed out, as long as it produced a report

## Acceptance checks
1. All SECTIONS URLs end with a trailing slash
2. `--section client-defence` processes only the defence pages (5 pages), skips monitoring and quality
3. An unknown `--section` value prints an error with valid section names and exits with code 1
4. Form-based login is used for all URLs (localhost and remote); credentials are read from env vars if flags not given
5. Each page produces at least one screenshot (unless every attempt times out)
6. Screenshot timeout (30s + retry) produces a warning log, not a crash
7. Findings with a `region` have a `zoomScreenshot` file path on the finding object
8. Findings with a `comparison_region` have both `zoomScreenshot` and `comparisonScreenshot`
9. Code locations use 4-level search; `isRouteFallback: true` is set when using level-4 fallback
10. `visual-report.json` is written with the correct shape after every run
11. `extractJsonArray()` is used for all Claude response parsing — no bare `text.match(/\[[\s\S]*\]/)` calls
12. A Claude API error produces a warning and an empty findings array, not a crash

## Scenarios
### Scenario A — Full defence section run
Given the client-frontend dev server is running at `http://localhost:5173`
When the developer runs `node tools/visual-inspector.mjs --section client-defence`
Then screenshots are captured for all 5 defence pages, Claude analyses each batch,
zoom screenshots are generated for findings with regions, and `visual-report.json` is written

### Scenario B — Events page times out
Given the Events page in monitoring takes more than 30 seconds to respond
When the visual inspector navigates to it
Then a warning is logged, that screenshot is skipped, and the rest of the monitoring run continues normally

### Scenario C — Cross-section inconsistency detected
Given defence and monitoring sections are both processed
When the cross-section analysis step runs
Then one representative screenshot per section is sent to Claude and cross-section findings appear
in `crossSectionIssues` in the report
