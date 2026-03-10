# SpecLens Interaction Tester — Phase 5 Exploratory Testing

## Goal
`tools/interaction-tester.mjs` is the Phase 5 exploratory interaction testing step.
It uses Playwright to discover all visible interactive elements on each page of the target
application, performs interactions (click / fill / select), captures before+after screenshots
for each interaction, and sends the pairs to Claude Vision to judge whether each interaction
produced a visually correct result. Findings are written to `reports/interaction-report.json`
and displayed in the "🎮 Interaction Tests" tab of the HTML dashboard.

The tool is **read-only with respect to the target app** — it observes interactions but never
submits forms or applies changes.

## Scope (IN)
- Form-based login using credentials from CLI flags or environment variables
- Page-discovery: finding all visible interactive elements via Playwright DOM queries
- Interaction types: click (buttons, links, role-button, checkboxes), fill (text/email inputs), select (dropdowns)
- Multi-step modal flows: after a click opens a modal, fill visible inputs, click submit/save/confirm if present, and take a "modal-submitted" screenshot
- Before+after screenshot pairs for every interaction
- Cross-section link detection and filtering (links leaving the tested section are skipped)
- Claude Vision analysis of before+after pairs in batches of 3 (6 images per call)
- Writing `reports/interaction-report.json` and `reports/interaction-report.md`
- Dashboard integration: findings displayed as cards with before/after screenshots in the "🎮 Interaction Tests" tab

## Scope (OUT)
- Functional correctness testing (checking data accuracy or API responses)
- Closed shadow DOM elements
- Accessibility testing (covered by Phase 2 spec-checker with client-accessibility spec)
- Modifying source files, spec files, or configuration

## Definitions
- **ElementDescriptor**: `{ handle, box, action, label, text, ariaLabel, tagName, href, inputType }` — describes one discovered interactive element
- **InteractionResult**: `{ index, element, label, action, tagName, beforeShot, afterShot, modalShots, navigated, error }` — result of one interaction
- **Bounding-box deduplication**: Round (x,y) to 4px grid; keep first match per cell (most specific selector wins)
- **Cross-section link**: An `a[href]` whose href resolves to a path outside the current section's root paths (e.g., `/defense/` for client-defence)
- **Modal flow**: After a click, if a modal/dialog is detected, fill up to 3 inputs, click submit/save/confirm if present, and take a "modal-submitted" screenshot

## Rules

### R1 — SECTIONS map
1. The `SECTIONS` constant must be kept in sync with `visual-inspector.mjs`.
2. All URLs must end with `/` (client-frontend uses `trailingSlash = 'always'`).
3. `SECTION_PATHS` must map each section key to its root URL paths for cross-section link detection.
4. When `--section` is passed, only that section's pages are tested. If the section key is unknown, exit with code 1 and list valid keys.
5. Default section when `--section` is omitted: `client-defence`.

### R2 — Authentication
1. Credentials MUST be read from `--url`, `--username`, `--password` CLI flags first, then `client_USERNAME`/`client_PASSWORD` env vars.
2. If username or password is missing, exit with code 1 and a clear message.
3. If ANTHROPIC_API_KEY or CLAUDE_API_KEY is not set, exit with code 1.
4. `createContext(browser)` MUST use form-based login (navigate to `/login/?next=/`, fill username and password fields, click submit button).
5. If login fails, log a warning and continue without auth (same pattern as visual-inspector.mjs).

### R3 — Element discovery
1. `discoverInteractiveElements(page, sectionPaths, maxPerPage)` MUST query the 10 selector categories in this exact order (specific → general):
   1. `[aria-haspopup]` (not disabled)
   2. `[aria-expanded="false"]` (not disabled)
   3. `button:not([type="submit"])` (not disabled)
   4. `button[type="submit"]` (not disabled)
   5. `[role="button"]` (not disabled)
   6. `a[href]` (not `#` or `javascript:` hrefs)
   7. `input[type="text"/"search"]` (not disabled/readonly)
   8. `input[type="email"]` (not disabled)
   9. `select` (not disabled)
   10. `input[type="checkbox"/"radio"]` (not disabled)
2. Each selector must be combined with `:visible` before querying.
3. Over-collect up to `3 × maxPerPage` raw elements, then deduplicate, then slice to `maxPerPage`.
4. `deduplicateByBoundingBox()` rounds (x,y) to a 4px grid and keeps the first match per cell.
5. Elements with bounding box width or height < 4px MUST be skipped (zero-size / hidden).
6. Cross-section `a[href]` links MUST be silently skipped before adding to the queue.
7. Default `maxPerPage` is 15, overridable via `--max-per-page`.

### R4 — Interaction type dispatch
1. Actions are dispatched by the `action` field of the ElementDescriptor:
   - `click`, `submit`, `role-button`, `checkbox`, `expand`, `popup-trigger` → `handle.click({ timeout: 3000 })`
   - `fill` → `handle.fill(TEST_DATA_MAP[inputType] ?? "test-input", { timeout: 3000 })`
   - `select` → `handle.selectOption({ index: 1 }, { timeout: 3000 })`
   - `link` → `handle.click()`, then detect URL change via `page.url()` comparison
2. `waitForStable(page)` MUST be called after every interaction before taking the after-screenshot.
3. If the link caused navigation: take after screenshot, then `page.goBack()`. If goBack fails, navigate directly to `BASE_URL + pageUrl`.
4. All interactions MUST be wrapped in try/catch. Errors are stored in `InteractionResult.error` and never crash the run.

### R5 — Cross-section link filtering
1. Before queuing any `a[href]` element, call `isCrossSectionLink(href, sectionPaths)`.
2. Links are cross-section if: (a) href resolves to a path not starting with any of `sectionPaths`, OR (b) href is an absolute URL to a different host.
3. Filtered links are skipped silently (no log, no error).

### R6 — Modal detection and multi-step flow
1. `isModalVisible(page)` checks these selectors (all with `:visible`):
   `[role="dialog"]`, `[role="alertdialog"]`, `[aria-modal="true"]`, `[class*="modal"]`,
   `[class*="overlay"]`, `[class*="calendar"]`, `[class*="datepicker"]`
2. `handleModalFlow(page, dir, baseIndex)` is called after any `click` action if `isModalVisible()` returns true.
3. The flow MUST:
   - Wait 600ms for animation
   - Take a "modal-open" screenshot
   - Fill up to 3 visible inputs inside the modal using `TEST_DATA_MAP`
   - Select first option in up to 2 `<select>` elements inside the modal
   - Click submit/save/confirm/OK/Apply button if one is visible inside the modal
   - `waitForStable(page)` after submit click
   - Take a "modal-submitted" screenshot
4. All modal flow steps MUST be wrapped in try/catch. Partial completion is acceptable.

### R7 — State reset
1. `resetPageState(page, pageUrl)` MUST be called after every interaction (including after modal flow).
2. Reset steps, in order (all wrapped in try/catch):
   1. `page.keyboard.press("Escape")` + 300ms wait
   2. Try explicit close button selectors: `button[aria-label="Close"]`, `[data-dismiss]`, `button:has-text("Cancel")`, `[class*="close-btn"]`
   3. If modal still visible after step 2: Escape again + 400ms wait
   4. If `page.url()` no longer contains `pageUrl.replace(/\/$/, "")`: navigate to `BASE_URL + pageUrl`
   5. `page.evaluate(() => window.scrollTo(0, 0))`
3. A failed reset MUST NOT prevent the next interaction from starting.

### R8 — Screenshot timing
1. The before-screenshot MUST be taken immediately before the interaction action.
2. The after-screenshot MUST be taken after `waitForStable(page)` completes (post-networkidle or 1s fallback).
3. Screenshots use a 30s timeout + 2.5s retry (identical to visual-inspector.mjs pattern).
4. A null screenshot (both retries failed) MUST be handled gracefully — the interaction result is still recorded with `beforeShot: null` or `afterShot: null`.
5. Screenshot filenames: `{index*2}-{index}-before.png` and `{index*2+1}-{index}-after.png` in `reports/interaction/screenshots/{section-slug}/{page-slug}/`.

### R9 — Claude Vision batching
1. Interaction results are grouped into batches of `BATCH_SIZE = 3` pairs (up to 6 images per call).
2. Images MUST be ordered in the `content` array: before1, after1, before2, after2, before3, after3.
3. Claude model: `claude-sonnet-4-6`, `max_tokens: 2048`.
4. The prompt MUST:
   - Name the section and page under test
   - List each interaction by pair index, label, element description, and action
   - Instruct Claude to return `[]` for passing interactions (only report failures)
   - Define PASS criteria: modal opened, dropdown expanded, value updated, subtle counter change
   - Define FAIL criteria: no visible change, error message appeared, layout broken, corrupted content
5. Claude MUST return a JSON array. Each finding includes: `pairIndex`, `severity`, `type`, `title`, `description`, `suggestion`.
6. If the Claude API call fails, log a warning and return `[]` for that batch — do not crash.

### R10 — JSON parsing
1. `extractJsonArray(text)` MUST be used for all Claude response parsing.
2. The implementation MUST use bracket-depth scanning (not bare `text.match(/\[[\s\S]*\]/)`).
3. Code-block extraction is attempted first; bracket-depth scanning is the fallback.

### R11 — Output format
1. `reports/interaction-report.json` structure:
   ```json
   {
     "generatedAt": "<ISO>",
     "baseUrl": "...",
     "section": "client-defence",
     "maxPerPage": 15,
     "summary": {
       "totalInteractions": N,
       "totalFindings": N,
       "pagesVisited": N,
       "severityCounts": { "high": N, "medium": N, "low": N }
     },
     "sections": {
       "<section-name>": {
         "pagesVisited": N,
         "interactionsTested": N,
         "pages": [
           {
             "page": "/defense/",
             "pageName": "Fraud Overview",
             "interactionsTested": N,
             "findings": [ { "type", "severity", "title", "description",
                             "element", "action",
                             "beforeScreenshot", "afterScreenshot", "suggestion" } ]
           }
         ]
       }
     }
   }
   ```
2. Finding `type` MUST be one of: `no-response`, `error-shown`, `layout-broken`, `visual-glitch`, `input-rejected`.
3. Finding `severity` MUST be one of: `high`, `medium`, `low`.
4. `beforeScreenshot` and `afterScreenshot` are relative paths from `reports/`.
5. `reports/interaction-report.md` MUST include a summary table and per-page finding details.
6. The markdown MUST end with: `*Generated by SpecLens Interaction Tester — exploratory testing only, no changes applied automatically.*`

### R12 — Error handling
1. Stale element errors during interaction MUST be caught; store `error: "<message>"` in `InteractionResult` and continue.
2. Claude API failures MUST be caught; log a warning and return `[]` for the affected batch.
3. Page navigation failures (goto timeout) MUST be caught; log a warning and continue with the next page.
4. The tool MUST NOT crash on any single-element or single-page failure — other pages/elements continue normally.

## Acceptance checks
1. Running with missing `--username` or `--password` exits with code 1 and a clear message
2. Running with unknown `--section` exits with code 1 and lists valid sections
3. Element discovery returns at most `maxPerPage` elements per page after deduplication
4. Cross-section links are skipped without crashing
5. After a modal-opening click, `handleModalFlow` is called and "modal-open" screenshot is taken
6. State reset is called after every interaction (including modal flows)
7. `extractJsonArray()` is used for all Claude response parsing
8. Claude API failure returns `[]` for that batch and does not stop the run
9. Both `reports/interaction-report.json` and `reports/interaction-report.md` are written on every successful run
10. The markdown report ends with the read-only disclaimer
11. Dashboard shows "🎮 Interaction Tests" tab with before/after screenshot pairs for each finding
12. Forms are never submitted (no submit/save/delete button clicks inside modals)

## Scenarios

### Scenario A — Successful click opens no modal
Given a button on `/defense/` that filters the data view
When the interaction tester clicks it
Then a before screenshot and after screenshot are taken
The data view updates visually
Claude Vision judges the interaction as PASS (no finding emitted)

### Scenario B — Click opens a modal, inputs are filled
Given a button on `/defense/blocked-calls-summary/` that opens a settings modal with text inputs
When the interaction tester clicks it
Then "modal-open" screenshot is taken
Up to 3 inputs are filled with test data from `TEST_DATA_MAP`
"modal-filled" screenshot is taken
State reset closes the modal via Escape
Claude Vision receives before, after, modal-open, modal-filled images in the batch

### Scenario C — Stale element after page mutation
Given an element handle that becomes stale after a previous interaction mutated the DOM
When `performInteraction` calls `handle.click()`
Then the error is caught, stored as `result.error`, and execution continues with the next element
No crash occurs; all other elements on the page are still tested
