# SpecLens Visual Filter — Spec-Driven Finding Classification

## Goal
`tools/visual-filter.mjs` is a post-processing step for the visual inspector. It reads
`reports/visual/visual-report.json` (raw findings from `visual-inspector.mjs`) together with
all spec files from `specs/client/`, then makes a single Claude API call to classify each finding
as either **intentional** (behaviour explicitly documented or permitted by the spec) or
**genuine** (a real inconsistency not covered by any spec rule). The filtered result is written
to `reports/visual/visual-report-filtered.json`, which the dashboard (`results-viewer.mjs`)
automatically prefers over the raw report.

## Scope (IN)
- Reading `reports/visual/visual-report.json` (or a path override via `--report`)
- Loading and concatenating all `.md` spec files from `specs/client/` (or a path override via `--specs`)
- Classifying findings with a single Claude API call
- Writing `reports/visual/visual-report-filtered.json` — filtered report (intentional findings removed from `issues` arrays, kept in `intentionalIssues` arrays)
- Writing `reports/visual/visual-filter-report.md` — human-readable classification summary
- Optional `--section` flag to process only one section's findings

## Scope (OUT)
- Running the visual inspector itself (see `speclens-visual-inspector.md`)
- Modifying spec files
- Re-running classification automatically when specs change
- Rendering the HTML dashboard (see `speclens-results-viewer.md`)

## Definitions (Source of truth)
- **Intentional finding**: A visual inconsistency that is explicitly described or permitted by a spec rule — e.g. a button that uses two different colours because the spec documents two distinct states
- **Genuine finding**: A visual inconsistency not covered or permitted by any spec rule — a real problem to fix
- **Filtered report**: `visual-report-filtered.json` — same shape as the raw report but with intentional findings moved to `intentionalIssues` arrays and counts recalculated
- **Classification**: A JSON object `{ index, intentional, reason }` returned by Claude for each finding

## Rules

### R1 — Input loading
1. The tool MUST read the raw visual report from `reports/visual/visual-report.json` by default.
   If `--report <path>` is provided, use that path instead.
2. If the report file does not exist, exit with code 1 and instruct the user to run `speclens:visual` first.
3. Spec files MUST be loaded from `specs/client/` by default. If `--specs <dir>` is provided, use that directory.
4. If the specs directory does not exist or contains no `.md` files, log a warning and continue
   without spec context (treat all findings as potentially genuine).

### R2 — Finding extraction
1. Findings MUST be extracted from two locations in the report:
   - `report.crossSectionIssues[]` — tagged with `section: "_cross"`
   - `report.sections[sectionName].issues[]` — tagged with their section name
2. If `--section <name>` is provided, only findings from that section (plus cross-section) are processed.
3. Each extracted finding MUST carry a sequential zero-based `index` used to correlate with Claude's response.

### R3 — Claude classification call
1. A single Claude API call MUST be made for all extracted findings (never one call per finding).
2. The prompt MUST include: the full concatenated spec content (capped at 10 000 chars) and a
   plain-text summary of all findings (capped at 8 000 chars), each finding identified by `[index]`.
3. The prompt MUST ask Claude to return a JSON array with one entry per finding:
   `{ "index": N, "intentional": true|false, "reason": "…" }`
4. The prompt MUST explicitly state: if the spec says nothing about a finding, classify it as `intentional: false`.
5. Claude model: `claude-sonnet-4-6`, `max_tokens: 4096`.
6. All Claude response parsing MUST use `extractJsonArray()` — never a bare regex.

### R4 — Applying classifications and writing output
1. Every finding object in the report MUST be tagged with `intentional` (boolean) and
   `intentionalReason` (string) after classification.
2. Findings classified as `intentional: true` MUST be moved from the section's `issues` array
   to a new `intentionalIssues` array on that section object.
3. Cross-section intentional findings MUST be removed from `crossSectionIssues`.
4. The filtered report MUST recalculate `totalIssues`, `intentionalIssues` (count), and
   `severityCounts` based on genuine findings only.
5. The filtered report MUST add a `filteredAt` ISO timestamp field.
6. Both output files (`visual-report-filtered.json` and `visual-filter-report.md`) MUST be
   written to `reports/visual/`.

### R5 — Markdown summary
1. `visual-filter-report.md` MUST include: a summary table (total / genuine / intentional counts)
   and a table of intentional findings showing index, section, type, severity, description, and spec reason.
2. If no findings are intentional, the intentional table MUST show `_None — all findings are genuine inconsistencies._`

### R6 — Dashboard integration
1. `results-viewer.mjs` MUST prefer `visual-report-filtered.json` over `visual-report.json` when
   both exist (load filtered first, fall back to raw if filtered is absent).
2. Running `speclens:visual-filter` via the CLI (`commandVisualFilter`) MUST automatically
   regenerate the dashboard after writing the filtered report.

## Acceptance checks
1. If `visual-report.json` is missing, exit code 1 with a clear message
2. If specs directory is missing, log a warning and continue — do not exit
3. A single Claude call is made regardless of the number of findings
4. `extractJsonArray()` is used for all Claude response parsing
5. Intentional findings appear in `intentionalIssues` in the filtered report, not in `issues`
6. `totalIssues` in the filtered report counts only genuine findings
7. `visual-report-filtered.json` is loaded by the dashboard in preference to `visual-report.json`
8. `visual-filter-report.md` always includes a classification summary table

## Scenarios
### Scenario A — Live toggle false positive filtered out
Given the visual report contains a finding: button has two different background colours
And the spec contains R7 documenting that the live toggle intentionally uses two distinct colours
When the filter runs
Then Claude classifies that finding as `intentional: true` with a reason referencing R7
And the finding is moved to `intentionalIssues` and hidden from the dashboard

### Scenario B — Genuine inconsistency retained
Given the visual report contains a finding: card headers use inconsistent font weights
And no spec rule permits or documents this inconsistency
When the filter runs
Then Claude classifies that finding as `intentional: false`
And the finding remains in `issues` and appears on the dashboard

### Scenario C — No findings to classify
Given the visual report contains zero issues across all sections
When the filter runs
Then no Claude call is made
And the filtered report is written with the same content as the raw report plus `filteredAt`
