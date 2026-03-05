# SpecLens Results Viewer — HTML Dashboard

## Goal
`tools/results-viewer.mjs` reads all SpecLens analysis reports from `reports/` and generates a
single interactive HTML file (`reports/ai-results.html`) that developers use to review findings.
It can also serve the file via a local HTTP server.

## Scope (IN)
- Reading and merging: `visual-report.json`, `spec-check-report.json`, `labels-violations.json`
- Generating the HTML dashboard with tabbed sections: Visual, Spec Check, Labels
- Rendering issue cards: severity badges, screenshots, zoom screenshots, comparison screenshots,
  code snippets with line numbers and highlighted match
- Full-screen zoom overlay (`#zoom-overlay`) with keyboard/click-to-close
- `--serve` mode: local HTTP server on port 4888
- Dark theme styling matching the client-frontend design language

## Scope (OUT)
- Running analysis tools (visual-inspector, spec-checker) — the viewer is read-only
- Writing or modifying reports (the viewer is a consumer, not a producer)
- Authentication or multi-user access

## Definitions (Source of truth)
- **Issue card**: An `<article>` element representing one finding with severity badge, description,
  file reference, screenshot, zoom screenshot, comparison screenshot, and code snippet
- **Zoom screenshot**: A cropped PNG showing the exact UI region where a finding was detected (80px padded)
- **Comparison screenshot**: A second cropped PNG for the "other element" in a discrepancy finding,
  shown side-by-side with the zoom screenshot
- **Code block**: A `<pre>` element showing ±5 lines of source code around the match line,
  with line numbers in the gutter and the match line highlighted in amber
- **Route fallback badge**: An amber-coloured badge shown when the code location is a route component
  rather than an exact text match (i.e., `isRouteFallback: true`)
- **Tab**: A section of the dashboard selectable by clicking a tab button; only one tab is visible at a time
- **Severity order**: High (red) → Medium (amber) → Low (blue); issues are sorted in this order within each section

## Rules

### R1 — Input report loading
1. The viewer must read these files if they exist (missing files are silently skipped, not errors):
   - `reports/visual/visual-report.json`
   - `reports/spec-check-report.json`
   - `reports/labels-violations.json`
2. Each file is read with `JSON.parse`; a parse error must produce a warning and treat the file as missing
3. The viewer must never require all three files to be present — it renders whatever is available

### R2 — Output file
1. The HTML file must be written to `reports/ai-results.html`
2. The HTML must be a single self-contained file (all CSS and JS inline, no external requests)
3. All user-visible strings must be HTML-escaped before insertion
4. Screenshot images must be embedded as `<img src="...">` with paths relative to `reports/` so
   they resolve correctly when the HTML is opened from the `reports/` directory

### R3 — Tab structure
1. The dashboard must have tabs: at minimum "Visual" and "Spec Check"; "Labels" is shown if label data exists
2. Tabs must be selectable by clicking — only the active tab's content is visible
3. The tab with the most findings must be the default active tab on load
4. Each tab heading must show a count of total findings in that section: `Visual (12)`, `Spec Check (7)`

### R4 — Issue card layout
1. Each issue card must display: severity badge, finding description, file reference (if available),
   screenshot thumbnail (if available), zoom screenshot (if available), code block (if available)
2. Severity badge: `HIGH` (red), `MED` (amber), `LOW` (blue)
3. Issue cards must be sorted: high severity first, then medium, then low
4. The screenshot thumbnail must be an `<img>` tag linking to the full screenshot relative path
5. If both `zoomScreenshot` and `comparisonScreenshot` exist, they must be rendered side-by-side
   in a two-column grid labelled "Element A" and "Element B"
6. If only `zoomScreenshot` exists (no comparison), it is rendered alone labelled "Error area"

### R5 — Zoom overlay
1. The page must include a hidden `<div id="zoom-overlay">` that covers the full viewport
2. Clicking any zoom screenshot image must call `openZoomOverlay(src)` which: makes the overlay
   visible, sets the overlay `<img>` src to the clicked image's src, and prevents page scroll
3. The overlay must close when: the user clicks outside the image, presses the Escape key, or
   clicks an explicit close button
4. The overlay must use `position: fixed; inset: 0; z-index: 9999` to cover everything
5. The overlay must NOT use CSS `max-height` transitions for show/hide — use JS `display` toggling

### R6 — Code block
1. Code blocks must be rendered as `<pre>` elements with monospace font
2. Each line of context must be a `<span class="code-row">` containing:
   - A `<span class="code-row-num">` with the 1-based line number
   - A `<span class="code-row-text">` with the HTML-escaped line content
3. The match line (where `isMatch: true`) must have the additional class `code-row-match`:
   - Background: `rgba(255, 200, 80, 0.10)` (subtle amber)
   - Left border: `3px solid #f0b429` (amber)
4. When `isRouteFallback: true`, show an amber "Route component (fallback)" badge instead of the
   normal file badge, to signal the code location is approximate

### R7 — Serve mode
1. `--serve` flag starts an HTTP server on port 4888 serving `reports/` as the document root
2. The server must send correct `Content-Type` headers for `.html`, `.json`, `.png`, `.css` files
3. The HTML file must be regenerated before the server starts
4. On server start, print: `Results server running at http://localhost:4888/ai-results.html`
5. The server must handle requests for screenshot files at their full relative path from `reports/`

### R8 — Styling conventions
1. The dashboard background and card colors must use the client-frontend dark-theme palette:
   - Page background: `#191c1c`
   - Card background: `#242828`
   - Accent/primary: `#6da478`
2. Typography: `Inter` for body text, monospace stack for code blocks
3. Severity colours: high = `#ea6f80` (red), medium = `#e4b266` (amber), low = `#6daa9c` (teal/blue)
4. All CSS must be inline in a `<style>` tag — no external stylesheet links
5. All JS must be inline in `<script>` tags — no external script sources

## Acceptance checks
1. `reports/ai-results.html` is written after running `node tools/results-viewer.mjs`
2. The HTML file opens in a browser without network requests (fully self-contained)
3. Missing report files (e.g., no `visual-report.json`) are handled gracefully — the relevant tab shows "No data"
4. Issue cards are sorted high → medium → low within each section
5. Clicking a zoom screenshot image opens the full-screen `#zoom-overlay`
6. Pressing Escape closes the zoom overlay
7. Zoom and comparison screenshots are shown side-by-side when both are present
8. Code blocks show ±5 lines with line numbers; the match line has an amber left border
9. `isRouteFallback: true` findings show the amber "Route component (fallback)" badge
10. `--serve` starts an HTTP server at port 4888 that serves screenshot images correctly
11. Tab counts reflect the actual number of findings in each section

## Scenarios
### Scenario A — Developer reviews defence findings
Given a completed `analyze:defence` run has written `visual-report.json` and `spec-check-report.json`
When the developer runs `npm run speclens:results`
Then `ai-results.html` is generated with a Visual tab (showing defence issues with zoom thumbnails
and code snippets) and a Spec Check tab (showing rule violations), and the browser opens the file

### Scenario B — Zoom overlay used
Given the dashboard is open in a browser and a finding has a zoom screenshot thumbnail
When the developer clicks the thumbnail
Then the `#zoom-overlay` appears full-screen, showing the enlarged screenshot; pressing Escape closes it

### Scenario C — Route fallback code location
Given a finding's `search_text` was not found in any source file and a route fallback was used
When the developer reviews the issue card
Then the code block shows the `+page.svelte` file with an amber "Route component (fallback)" badge,
making it clear this is an approximate location rather than an exact match
