# SpecLens Results Viewer - HTML Dashboard

## Goal
`tools/results-viewer.mjs` reads SpecLens analysis reports and generates a standalone HTML dashboard
that developers use to review the current profile output. It can also serve the generated dashboard
and linked artifacts over a local HTTP server.

In iteration 2, the viewer is profile-aware. It foregrounds TagTwo repo analysis results, surfaces
optional TagTwo web self-check findings, links evidence back to repo artifacts, and preserves the
archived client dashboard as iteration-1 evidence.

## Scope (IN)
- Reading project-scoped TagTwo inventory, spec-check, license, and optional self-check reports
- Reading archived run manifests for the active profile
- Generating a standalone HTML dashboard for the active profile
- Rendering a cleaner tabbed review workspace for TagTwo instead of a single long stacked report
- Rendering repo-analysis tables for inventory, spec-check, license findings, patch drafts, and run history
- Rendering the TagTwo self-check view as anomaly groups plus route evidence cards with inline
  screenshots and clear detector-source labelling
- Full-screen zoom overlay for self-check screenshots
- `--serve` mode for local HTTP access to the generated dashboard and linked artifacts

## Scope (OUT)
- Running analysis tools such as inventory, spec-check, license, or self-check
- Mutating any report JSON or Markdown inputs
- Changing archived client report content
- Authentication, multi-user access, or remote hosting concerns

## Definitions (Source of truth)
- **Dashboard section**: A top-level review block in the generated HTML, such as Repo Inventory,
  Web Self-Check, Spec Check, License Findings, Patch Drafts, or Run Archive
- **Workspace tab**: A major review area that can be selected without leaving the page, such as
  Overview, Web Self-Check, Policy Review, or Run Archive
- **Anomaly group card**: A self-check card that groups the same finding kind across one or more routes
- **Route evidence card**: A self-check card that combines a route screenshot, route metadata, and
  its associated findings
- **Detector source**: The mechanism that produced a self-check finding, such as DOM structure,
  navigation, browser runtime, browser console, or same-origin network monitoring
- **Zoom overlay**: A full-screen overlay that opens when a screenshot thumbnail is clicked

## Rules

### R1 - Input report loading
1. The viewer must read these files if they exist, and skip them silently when absent:
   - `reports/projects/tagtwo/repo-inventory.json`
   - `reports/projects/tagtwo/spec-check-report.json`
   - `reports/projects/tagtwo/license-report.json`
   - `reports/projects/tagtwo/web-selfcheck-report.json`
2. Each report file must be read with `JSON.parse`; parse failures must be treated as missing input.
3. The viewer must also read archived run manifests from the active profile's run archive directory
   when that directory exists.
4. For the `client-legacy` profile, the viewer must preserve the archived dashboard instead of
   regenerating it.

### R2 - Output file
1. The active profile dashboard must be written to that profile's configured HTML output path.
2. The generated HTML must be standalone, with inline CSS and inline JavaScript only.
3. All user-visible strings inserted into the HTML must be HTML-escaped.
4. Screenshot and artifact links must be written relative to the output HTML file so they resolve
   when the file is opened directly from disk.
5. When the profile's report directory differs from the primary output location, the viewer must
   write a redirecting compatibility HTML file in the report directory.

### R3 - TagTwo dashboard structure
1. The TagTwo dashboard must show a hero / summary area followed by major review tabs.
2. The tabbed workspace must include at least:
   - Overview
   - Web Self-Check
   - Policy Review
   - Run Archive
3. The Overview tab must surface summary metrics and compact previews for the major report areas.
4. The Policy Review tab must group repo inventory, spec-check, license findings, and patch drafts
   more cleanly than a single flat report stack.
5. The Run Archive tab must surface archived run history and snapshot links.
6. Only one workspace tab should be active at a time.
7. The default active tab should be a high-signal starting point, such as Overview or Web Self-Check.
8. Each section must still render a clear empty state when its input report is absent or has no findings.
9. Summary metrics must include repo-analysis counts plus TagTwo self-check page and finding totals.

### R3A - TagTwo self-check review structure
1. The Web Self-Check section must separate "what was detected" from "where it was observed".
2. The section must start with high-level self-check metadata and a short explainer that clarifies
   screenshots are route context and not always the primary detector.
3. When discovery information exists in the self-check report, the section must show which seed
   sources contributed routes before page-by-page crawling continued.
4. When auth/session metadata exists and protected routes rendered an auth bridge, the section must
   explain that behavior in a session-aware way instead of always assuming an anonymous crawl.
5. When findings exist, the section must render anomaly-group cards that show:
   - severity
   - finding kind
   - detector source
   - affected routes
   - inspect-first guidance
   - suggested change
6. The section must render route evidence cards that show:
   - route metadata
   - inline screenshot thumbnail when present
   - route facts such as title, h1, main-landmark status, and final URL
   - associated findings with evidence, detector-source explanation, and suggested change
7. Screenshot thumbnails in the self-check section must open the zoom overlay.
8. Proposal commands from the self-check report must appear in a follow-up proposals area.
9. If the self-check report is missing, the section must point developers to
   `npm run speclens:tagtwo:selfcheck`.

### R4 - Table sections
1. Repo inventory, spec-check, license findings, patch drafts, and run archive must render as tables
   when data exists.
2. Inventory rows must link to source manifests under the active profile target path.
3. Spec-check rows must link to the relevant source file under the active profile target path.
4. License rows must link to both the source manifest and the evaluated policy file.
5. Run archive rows must link to archived HTML snapshots when those snapshots exist.

### R5 - Zoom overlay
1. The page must include a hidden full-screen zoom overlay.
2. Clicking a route screenshot thumbnail must open the overlay with the clicked image and caption.
3. The overlay must close when:
   - the close button is clicked
   - the user presses Escape
   - the user clicks outside the enlarged image
4. Opening the overlay must disable body scrolling until the overlay closes.

### R5A - Tab interaction
1. Workspace tabs must be switchable without a page reload.
2. The active tab must be visually distinct from inactive tabs.
3. Switching tabs must hide inactive panels and show only the selected panel.
4. The generated HTML must include the inline JavaScript needed for tab switching.

### R6 - Serve mode
1. `--serve` must regenerate the dashboard before starting the server.
2. The local server must listen on port `4888`.
3. The server must serve the generated dashboard and linked artifact files with appropriate content types.
4. When not running in CI, serve mode may open the local dashboard URL in the browser automatically.

### R7 - Styling and readability
1. The generated dashboard must remain readable on both desktop and mobile widths.
2. Severity badges must distinguish high, medium, and low findings consistently across sections.
3. Self-check review cards must visually separate detector-source explanation, evidence, and suggested change.
4. The TagTwo dashboard should present a stronger visual hierarchy than a simple stacked document,
   using layout, grouping, and navigation to make review faster.
5. The TagTwo self-check layout must stay visually distinct from the archived client dashboard rather
   than reusing the client section mix directly.

## Acceptance checks
1. Running `node tools/results-viewer.mjs --profile tagtwo` writes `reports/TagTwo/ai-results.html`.
2. If `reports/projects/tagtwo/web-selfcheck-report.json` exists, the dashboard shows anomaly-group
   cards, route evidence cards, inline screenshot thumbnails, and proposal guidance.
3. Opening the generated dashboard directly from disk resolves self-check screenshots correctly.
4. Clicking a self-check screenshot thumbnail opens the zoom overlay.
5. Missing report files are handled gracefully with empty states instead of crashes.
6. The TagTwo dashboard renders workspace tabs that switch between major review areas without reloading.
7. Running `node tools/results-viewer.mjs --profile tagtwo --serve` starts a local HTTP server that
   can serve the dashboard and screenshot files.
8. Running the viewer for `client-legacy` preserves the archived dashboard instead of regenerating it.

## Scenarios
### Scenario A - Developer reviews TagTwo self-check anomalies
Given `reports/projects/tagtwo/web-selfcheck-report.json` exists
When the developer runs `npm run speclens:tagtwo:results`
Then the TagTwo dashboard shows anomaly-group cards for the detected issue kinds and route evidence
cards with inline screenshots plus suggested changes

### Scenario B - Developer zooms a route screenshot
Given the TagTwo dashboard is open and a route evidence card has a screenshot thumbnail
When the developer clicks the screenshot
Then the zoom overlay opens with the full-size image and closes again on Escape, close-button click,
or outside click

### Scenario C - Self-check report missing
Given no TagTwo self-check report exists yet
When the developer runs `npm run speclens:tagtwo:results`
Then the Web Self-Check section renders a clear empty state that points to
`npm run speclens:tagtwo:selfcheck`
