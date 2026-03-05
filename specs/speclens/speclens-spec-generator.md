# SpecLens Spec Generator — Draft Spec Generation Tool

## Goal
`tools/spec-generator.mjs` is Phase 2 of the SpecLens pipeline. It reads the outputs from
Phase 1 (`reports/component-inventory.json` and `reports/consistency-report.json`), performs
static CSS and accessibility analysis of the source files, and uses a single Claude call to
generate a draft UX specification in SpecLens format. The generated spec is written to
`specs/client/generated-{section}-spec.md` for the developer to review and edit.

## Scope (IN)
- Loading and validating prerequisite reports (component inventory, consistency report)
- Static analysis of source files: CSS color tokens, font sizes, spacing values, ARIA attributes,
  role attributes, keyboard handlers, focus patterns (regex only — no Claude)
- Building a structured digest from the analysis (capped at 6000 chars)
- Calling Claude once to generate a draft spec document in SpecLens format
- Writing the generated spec to `specs/client/generated-{section}-spec.md`
- Writing a JSON summary to `reports/spec-generation-report.json`
- Writing a markdown summary to `reports/spec-generation-report.md`
- `--section` flag to restrict analysis to one section's routes folder
- `--path` flag to override the source path from the inventory
- `--output` flag to override the output spec file path

## Scope (OUT)
- Spec validation or linting of the generated file (use `speclens:lint` for that)
- Running the spec-checker against the generated file (use `speclens:spec-check`)
- Batched source code analysis (the digest approach avoids batching)
- Visual or screenshot analysis (see `speclens-visual-inspector.md`)

## Definitions (Source of truth)
- **Digest**: A structured text summary of the component inventory, consistency issues, CSS
  patterns, and accessibility findings — capped at 6000 characters — sent to Claude as context
- **Static analysis**: Regex-based extraction of CSS and ARIA patterns from source files with
  no Claude involvement — fast and deterministic
- **Generated spec**: The draft markdown file written to `specs/client/generated-{section}-spec.md`
  — clearly named to indicate it was auto-generated and requires human review before use
- **Section route mapping**: `client-defence` → `src/routes/defense/`, `client-monitoring` →
  `src/routes/monitoring/`, `client-quality` → `src/routes/quality/`

## Rules

### R1 — Prerequisite loading
1. The tool must read `reports/component-inventory.json`; if missing, exit with code 1 and
   instruct the user to run `speclens:discover` first
2. The tool must read `reports/consistency-report.json`; if missing, log a warning and continue
   without consistency context — never exit
3. `targetPath` is read from the inventory JSON; the `--path` flag overrides it
4. If `targetPath` does not exist on disk, exit with code 1

### R2 — Static source analysis
1. Walk `.svelte`, `.scss`, and `.css` files under `targetPath/src/` (or the section routes
   folder if `--section` is given), skipping `node_modules`, `.svelte-kit`, `build`, `dist`,
   `.git`, `.cache`, `.vite`
2. If `--section` is given and the matching routes folder exists, restrict scanning to that folder;
   otherwise scan all of `src/`
3. Extract via regex (no Claude): CSS custom property color values, font-size declarations,
   margin/padding spacing values, aria-* attribute names, role attribute values, keyboard event
   handler occurrences (`on:keydown/keyup/keypress`), and focus pattern occurrences
4. Collect the top-N most frequent values for each category (colors: 12, fonts: 8, spacing: 8,
   ARIA attrs: 10) before building the digest

### R3 — Digest construction
1. The digest must include: component inventory summary (categories, import counts, props),
   top consistency issues (severity-sorted, top 10), CSS pattern summary, accessibility summary
2. The digest must be capped at 6000 characters before being sent to Claude
3. The digest must report the number of files scanned with ARIA attributes vs total files scanned

### R4 — Claude spec generation
1. A single Claude API call must generate the spec — no batching
2. Claude model: `claude-sonnet-4-6`, `max_tokens: 8192`
3. The prompt must specify the exact SpecLens spec format including rule heading pattern
   (`### R{n} — {Title}` with em-dash), numbered rule items, binary acceptance checks, and
   Given/When/Then scenario format
4. The prompt must instruct Claude to base every rule on actual evidence from the digest —
   not to invent conventions absent from the analysis
5. The prompt must instruct Claude to return ONLY the markdown document with no prose before or after
6. Any surrounding markdown code fences (` ```markdown `) in Claude's response must be stripped

### R5 — Output
1. The generated spec is written to `specs/client/generated-{section}-spec.md` by default,
   or to the `--output` path if provided; always overwrite if the file exists (log that it did)
2. `reports/spec-generation-report.json` must be written with: `generatedAt`, `targetPath`,
   `section`, `outputSpec`, and a `stats` object with counts of components, issues, and patterns
3. `reports/spec-generation-report.md` must be written with a summary table and next-step
   instructions telling the user to review the spec then run `speclens:spec-check`
4. The `reports/` directory must be created if absent

### R6 — Error handling
1. A failed Claude call must surface the error message and exit with code 1
2. Unreadable source files during analysis must be silently skipped — never crash the analysis pass

## Acceptance checks
1. Running without `reports/component-inventory.json` exits with code 1 and instructs user to run `discover`
2. Running without `reports/consistency-report.json` logs a warning and continues (no crash)
3. `--section client-defence` restricts file scanning to `src/routes/defense/`
4. The generated spec file is written to `specs/client/generated-{section}-spec.md` by default
5. `reports/spec-generation-report.json` is written with correct shape after every successful run
6. `reports/spec-generation-report.md` includes next-step instructions referencing `speclens:spec-check`
7. The digest sent to Claude is capped at 6000 characters
8. Claude's response is stripped of surrounding markdown fences before being written to disk

## Scenarios
### Scenario A — Generate spec for defence section
Given `reports/component-inventory.json` and `reports/consistency-report.json` exist
When the developer runs `npm run speclens:spec-generate -- --section client-defence`
Then `specs/client/generated-client-defence-spec.md` is written, containing rules derived from
the actual component patterns and CSS values found in `src/routes/defense/`

### Scenario B — Missing consistency report
Given `reports/component-inventory.json` exists but `reports/consistency-report.json` does not
When the developer runs `npm run speclens:spec-generate`
Then a warning is logged, the tool continues without consistency data, and a spec is still generated

### Scenario C — Developer validates code against generated spec
Given `specs/client/generated-client-defence-spec.md` has been reviewed and edited
When the developer runs `npm run speclens:spec-check -- --specs generated-client-defence-spec`
Then the spec-checker validates the codebase against the generated rules and writes a violation report
