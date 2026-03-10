# SpecLens Chaos Advisor — Phase 4 Synthesis & Change Proposals

## Goal
`tools/chaos-advisor.mjs` is the Phase 4 synthesis step. It reads all outputs produced by
Phases 1–3 (spec violations, visual findings, consistency issues, component inventory) together
with the existing spec files, then makes two Claude API calls to produce:

1. **Spec Gaps** — patterns found in the data that no existing rule covers, each with a
   proposed rule text ready to insert into a spec file
2. **Change Proposals (CPs)** — structured, prioritised proposals (CP-001…) for code, spec,
   doc, or test changes, with risk rating, rationale, evidence, and a review checklist

The tool is **read-only by design** — it proposes changes but never applies them.

## Scope (IN)
- Loading and digesting `reports/spec-check-report.json` (required)
- Loading `reports/visual/visual-report-filtered.json` or `reports/visual/visual-report.json` (optional)
- Loading `reports/consistency-report.json` and `reports/component-inventory.json` (optional)
- Loading all `specs/client/*.md` spec files for gap analysis context
- Claude Call 1: spec gap detection — systematic patterns not covered by any existing rule
- Claude Call 2: change proposal generation — structured CPs with ID, type, scope, risk, evidence
- Writing `reports/chaos-advisor-report.json` and `reports/chaos-advisor-report.md`

## Scope (OUT)
- Applying any proposed change automatically
- Modifying spec files, source code, or test files
- Running the visual inspector, spec checker, or any other tool
- Functional / interaction testing (clicking through the UI — this is Phase 5)

## Definitions (Source of truth)
- **Spec Gap (SG-NNN)**: A pattern observed across multiple findings that no existing rule covers.
  Has: `gapId`, `title`, `category`, `evidence`, `proposedRuleText`, `suggestedSpec`, `priority`
- **Change Proposal (CP-NNN)**: A structured, human-reviewable proposal for a code, spec, doc,
  or test change. Has: `id`, `type`, `scope`, `risk`, `summary`, `rationale`, `evidence`,
  `proposedFix`, `reviewChecklist`
- **type**: `code_change` | `spec_change` | `doc_change` | `test_change`
- **scope**: `in_spec` (violation of an existing rule) | `out_of_spec` (gap — no rule yet covers it)
- **risk**: `high` | `medium` | `low` — determines ordering in the report
- **Digest**: A truncated, summarised view of a report used as Claude input to stay within token limits

## Rules

### R1 — Input loading
1. `reports/spec-check-report.json` is required. If missing, exit with code 1 and instruct the
   user to run `speclens:spec-check` first.
2. Visual report is optional — prefer `visual-report-filtered.json`, fall back to `visual-report.json`.
   If neither exists, log a warning and continue with an empty visual digest.
3. Consistency report and component inventory are optional — log warnings if missing, continue.
4. Spec files from `specs/client/*.md` are loaded and concatenated (capped at 20 000 chars) to
   provide rule context for gap detection. If the directory is missing, continue without spec context.

### R2 — Digest construction
1. The violation digest MUST group violations by rule (not list each one individually) and include:
   violation count, high-severity count, one example description, and one example file path per rule.
   Total capped at 8 000 chars.
2. The visual digest MUST list each finding as one line: `[section] type (severity): description`.
   Total capped at 4 000 chars.
3. The consistency digest MUST list at most 10 issues with severity and description.
   Total capped at 2 000 chars.

### R3 — Claude Call 1: Spec gap detection
1. The prompt MUST include: full spec content, violation digest, visual digest, consistency digest.
2. Claude MUST be instructed to identify only SYSTEMATIC patterns (appearing in multiple findings)
   not covered by any existing rule.
3. Each spec gap MUST include: `gapId` (SG-NNN), `title`, `category`, `evidence`, `proposedRuleText`
   (in SpecLens `### R{N} — Title` format with numbered items), `suggestedSpec`, `priority`.
4. The prompt MUST explicitly state: do NOT propose gaps already covered by existing rules.
5. Claude model: `claude-sonnet-4-6`, `max_tokens: 4096`.
6. If the call fails, log a warning and continue with `specGaps = []`.

### R4 — Claude Call 2: Change proposal generation
1. The prompt MUST include: violation digest, visual digest, consistency digest, spec gap summary.
2. Claude MUST produce 8–15 prioritised proposals. Related violations SHOULD be combined into
   one CP where sensible.
3. Each CP MUST include: `id` (CP-NNN), `type`, `scope`, `risk`, `summary` (≤100 chars),
   `rationale`, `evidence`, `proposedFix`, `reviewChecklist` (array of strings).
4. CPs MUST be ordered: high-risk `in_spec` first, then `out_of_spec` gaps, then low-risk.
5. Claude model: `claude-sonnet-4-6`, `max_tokens: 8192`.
6. If the call fails, log a warning and continue with `changeProposals = []`.

### R5 — Output format
1. `reports/chaos-advisor-report.json` structure:
   ```json
   {
     "generatedAt": "<ISO>",
     "summary": {
       "totalSpecViolations": N,
       "totalVisualFindings": N,
       "specGapsFound": N,
       "changeProposalsGenerated": N
     },
     "specGaps": [...],
     "changeProposals": [...]
   }
   ```
2. `reports/chaos-advisor-report.md` MUST include:
   - Executive Summary table (violations / visual / gaps / proposals)
   - Highest priority section (top 5 high-risk CPs as bullets)
   - Spec Gaps section with proposed rule text in fenced code blocks
   - Change Proposals summary table (ID / type / scope / risk / summary)
   - Change Proposals detail section (one subsection per CP with all fields + checklist)
3. The markdown MUST end with: `*Generated by SpecLens Chaos Advisor — proposals only, no changes applied automatically.*`

### R6 — Read-only guarantee
1. The tool MUST NOT write to any file outside `reports/`.
2. The tool MUST NOT modify spec files, source files, or configuration.
3. Every output file MUST contain a note that proposals are human-reviewable and not auto-applied.

## Acceptance checks
1. Missing `spec-check-report.json` exits with code 1 and a clear message
2. Missing visual report logs a warning and continues (does not exit)
3. Exactly two Claude calls are made per run
4. `extractJsonArray()` is used for all Claude response parsing
5. Spec gaps have `gapId` in `SG-NNN` format
6. Change proposals have `id` in `CP-NNN` format
7. Both output files are written to `reports/` on every successful run
8. The markdown report ends with the read-only disclaimer

## Scenarios
### Scenario A — Full run after complete pipeline
Given all three phase reports exist
When `npm run speclens:chaos` is run
Then the tool loads all reports, makes two Claude calls, and writes a report with
spec gaps and change proposals derived from the actual findings

### Scenario B — Missing visual report
Given `visual-report.json` and `visual-report-filtered.json` do not exist
When the tool runs
Then it logs a warning and proceeds with `"No visual findings available."` as the visual digest
The spec gap and change proposal calls still run with the available data

### Scenario C — Claude returns no spec gaps
Given all findings are covered by existing rules
When Call 1 completes
Then `specGaps = []` and the Spec Gaps section says `_No spec gaps identified_`
Call 2 still runs and generates change proposals from the violation and visual data
