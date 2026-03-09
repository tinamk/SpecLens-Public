# SpecLens Spec Checker — Code-vs-Spec Compliance Tool

## Goal
`tools/spec-checker.mjs` reads spec files from `specs/client/` (and other subdirectories, excluding
`specs/speclens/`), extracts their rules, then sends batches of source code to Claude with a
structured prompt asking it to find violations. It writes a JSON and Markdown report that lists
every violation grouped by spec and rule.

## Scope (IN)
- Parsing spec Markdown files: extracting Rules, Acceptance checks, Definitions, Scope (IN)
- Selecting which source files to send for each spec (the "phase strategy")
- Building and sending Claude prompts for each batch
- Extracting JSON arrays from Claude responses robustly
- Grouping and sorting violations by severity
- Writing `reports/spec-check-report.json` and `reports/spec-check-report.md`
- The `--specs` CLI flag for running a subset of specs

## Scope (OUT)
- Visual / screenshot analysis (see `speclens-visual-inspector.md`)
- The HTML dashboard rendering (see `speclens-results-viewer.md`)
- Writing or modifying source code to fix violations
- Enforcing spec file format (see `speclens-spec-format.md`)

## Definitions (Source of truth)
- **Spec**: A `.md` file in `specs/` that has at least one rule block under `## Rules`
- **Rule block**: A `### R{n} — {Title}` section with numbered items — parsed by `parseRules()`
- **Phase**: The type of file content sent to Claude for a given spec:
  `"filenames"` (names only), `"style"` (`<style>` blocks), `"script"` (`<script>` blocks), `"full"` (complete files)
- **Batch**: A group of up to `BATCH_SIZE` (6) files sent in one Claude API call
- **Violation**: A JSON object describing one rule breach found by Claude
- **Severity**: `"high"` | `"medium"` | `"low"` — determines sort order and badge color in reports
- **extractJsonArray**: The bracket-depth scanning function used to robustly extract the first JSON
  array from a Claude response, handling prose text that may contain non-JSON bracket expressions

## Rules

### R1 — Spec file loading and filtering
1. The tool must walk `specs/` recursively to find all `.md` files, excluding the `speclens/`
   subdirectory (which contains SpecLens self-specs, not target codebase specs)
2. Spec files with zero parsed rule blocks must be silently skipped (not an error)
3. The `--specs` flag accepts a comma-separated list of spec base names (without `.md`):
   `node tools/spec-checker.mjs --specs client-defence,client-metadata`
4. When `--specs` is provided, only the named specs are processed — all others are skipped
5. If `--specs` names a spec that does not exist, the tool must log a warning and continue with
   the matching specs that do exist
6. If no specs with rule blocks are found (after filtering), exit with code 1 and a clear message

### R2 — Spec parsing
1. `parseSpec(filePath)` must extract: `name` (base filename without `.md`), `title` (from `#` heading),
   `rules` (from `## Rules`), `checks` (from `## Acceptance checks`),
   `defs` (from `## Definitions (Source of truth)`), `scopeIn` (from `## Scope (IN)`)
2. `parseRules()` must split on `### R\d+` boundaries and extract `id`, `title`, and `items[]` per block
3. `parseAcceptanceChecks()` must assign sequential IDs `AC-01`, `AC-02`, … to each numbered list item
4. Section extraction must use regex anchored to `## {Heading}\n` and terminating at the next `## ` heading

### R3 — File selection phase strategy
1. For `component-standards` spec: run two phases — `"filenames"` (all component files) then `"script"` (script blocks)
2. For `design-system` spec: run one phase — `"style"` (style blocks from all components + all `.scss` files under `src/style/`)
3. For `client-accessibility` spec: run two phases —
   a. `"style"` (style blocks from all components + all route files) — for outline/focus CSS rules
   b. `"full"` (all components + all route files + `src/app.html`) — for all other WCAG rules
   The `client-accessibility` spec is processed before the general `client-*` rule and returns early.
4. For other `client-{section}` specs: run one phase — `"full"` (all files under `src/routes/{routeSlug}/`)
5. Route slug mapping: `client-defence` → `defense`, `client-metadata` → `metadata`,
   `client-monitoring` → `monitoring`, `client-quality` → `quality`
6. Specs not matching any of the above patterns must produce zero phases (skipped with a log message)
7. Phase `"filenames"` sends only the relative file path list — no file content
8. Phase `"style"` extracts the `<style>...</style>` block from each `.svelte` file; files without a style block are skipped
9. Phase `"script"` extracts the `<script>...</script>` block; files without a script block are skipped
10. Phase `"full"` sends the full file content (truncated to `MAX_BLOCK_CHARS` = 2500 chars per file)

### R4 — Batch processing
1. Files within each phase must be split into batches of at most `BATCH_SIZE` (6) files
2. Each batch is a single Claude API call — batches within a phase run sequentially
3. If a batch produces zero file blocks (all files were empty/missing), skip the Claude call and return `[]`
4. The tool must print progress to stdout: phase name, total files, batch count, and per-batch violation count

### R5 — Claude prompt construction
1. The prompt must include: spec title, definitions block (if present), the full rules block, the code section, and a phase hint
2. Phase hints:
   - `"filenames"` → `"These are component FILENAMES only — check naming rules."`
   - `"style"` → `"These are the <style> blocks extracted from Svelte components."`
   - `"script"` → `"These are the <script> blocks extracted from Svelte components."`
   - `"full"` → `"These are full Svelte component or route files."`
3. The prompt must instruct Claude to return ONLY a valid JSON array and return `[]` if no violations
4. The violation object schema requested from Claude:
   `{ rule, item, severity, file, violatingCode, description, suggestion }`
5. The prompt must tell Claude: "Be precise — only report things that genuinely break a rule as written.
   Do NOT invent issues or report style preferences not in the rules."
6. Claude model: `claude-sonnet-4-6`, `max_tokens: 8192`

### R6 — JSON response extraction
1. All Claude response parsing must use `extractJsonArray()` — never a bare `text.match(/\[[\s\S]*\]/)` regex
2. `extractJsonArray(text)` must:
   a. First attempt: find a fenced code block (` ```json ` or ` ``` `) containing an array and parse it
   b. Second attempt: scan for the first `[` whose next non-whitespace character is `{` or `]`, then
      use bracket-depth counting to find the matching `]` and parse the slice
3. If both attempts fail, return `null` — the caller must treat `null` as an empty array
4. A JSON parse error inside `extractJsonArray()` must be swallowed per-attempt and the next
   attempt tried; the function must never throw

### R7 — Violation grouping and sorting
1. Violations must be sorted by severity before grouping: `high` first, then `medium`, then `low`
2. Violations must be grouped by rule ID within each spec result
3. Rule groups with zero violations must be excluded from the output
4. Unknown rule IDs (Claude returned a rule ID not in the spec) are placed in an `"unknown"` group

### R8 — Output format
1. `reports/spec-check-report.json` structure:
   ```json
   {
     "generatedAt": "<ISO>",
     "totalViolations": 12,
     "severityCounts": { "high": 2, "medium": 5, "low": 5 },
     "specs": [
       {
         "specFile": "client-defence.md",
         "specTitle": "client-defence — Fraud Detection Section",
         "violationCount": 4,
         "rules": [{ "ruleId": "R2", "ruleTitle": "Live mode", "violations": [...] }]
       }
     ]
   }
   ```
2. `reports/spec-check-report.md` must include: a title, a summary table (spec | violations),
   and per-spec sections with per-rule subsections and individual violation cards showing severity,
   file, violating code, description, and fix suggestion
3. Both output files must be written atomically (write to final path directly, not a temp file)
4. The `reports/` directory must be created if absent

### R9 — Inventory dependency
1. The tool reads `reports/component-inventory.json` to get the `targetPath` (root of the project to analyse)
2. If the inventory file is missing, the tool must exit with code 1 and instruct the user to run `discover` first
3. If `targetPath` does not exist on disk, exit with code 1

## Acceptance checks
1. Running with no `specs/` directory exits with code 1 and a clear error message
2. Running with no inventory file exits with code 1 and instructs the user to run `discover`
3. `--specs client-defence,client-metadata` processes only those two specs
4. A spec file with no `## Rules` section is silently skipped (not in the report)
5. `max_tokens` for Claude calls is 8192
6. `extractJsonArray()` is used for all response parsing — no bare regex JSON extraction
7. `extractJsonArray()` returns null (not throws) when the response contains no valid JSON array
8. Violations are sorted high → medium → low before being included in results
9. `reports/spec-check-report.json` and `reports/spec-check-report.md` are written after every successful run
10. A Claude API error on one batch logs a warning and returns `[]` for that batch — the run continues

## Scenarios
### Scenario A — Running against one section
Given the client-frontend source is at the `targetPath` in the inventory
When the developer runs `node tools/spec-checker.mjs --specs client-defence`
Then only the `client-defence.md` spec is processed, source files from `src/routes/defense/` are batched,
Claude finds violations, and the report is written with violation counts per rule

### Scenario D — Cross-section accessibility spec
Given `client-accessibility.md` is in the spec filter
When the tool runs `getCheckPhases()` for it
Then it does NOT look for `src/routes/accessibility/` (which does not exist)
Instead it runs a `"style"` phase over all components and routes, then a `"full"` phase over all
components, routes, and `src/app.html`, ensuring WCAG violations are found across the whole codebase

### Scenario B — Claude returns prose before JSON
Given Claude's response contains the text `[Resource] not found` before the actual JSON array
When `extractJsonArray()` processes the response
Then it skips the `[Resource]` text (peek ahead sees `R`, not `{` or `]`), finds the real array,
and returns it correctly parsed

### Scenario C — Claude truncates JSON
Given a large batch causes Claude to truncate its response mid-JSON
When `extractJsonArray()` attempts to parse the slice
Then the JSON.parse fails, the function returns null, and the caller treats it as zero violations
and logs a warning — it does not crash
