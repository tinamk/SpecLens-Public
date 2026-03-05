# SpecLens Spec Format — Specification File Structure

## Goal
Every spec file in SpecLens is a Markdown contract that defines what the software must do.
This spec defines the structure, sections, and formatting rules that every spec file must follow
so that automated tools can parse them reliably.

## Scope (IN)
- Required sections and their headings
- Rules block format (`### R{n} — {Title}`, numbered items)
- Acceptance checks format
- Scenarios format (Given/When/Then)
- Spec file naming and location conventions
- The `## Definitions (Source of truth)` section
- How `## Scope (IN)` and `## Scope (OUT)` must be written

## Scope (OUT)
- The content of individual specs (what client-defence must do, etc.)
- CI enforcement of spec format (future work)
- Spec versioning or change history

## Definitions (Source of truth)
- **Spec**: A Markdown file in `specs/` (or a subdirectory) that defines requirements for one
  feature, section, or tool component
- **Rule**: A named, numbered requirement block under `## Rules`. Format: `### R{n} — {Title}`
  where n is a positive integer
- **Rule item**: A numbered list item inside a rule block. Referenced as `R{n} item {m}` (e.g., R2 item 3)
- **Acceptance check**: A numbered list item under `## Acceptance checks`. IDs are assigned
  programmatically as `AC-01`, `AC-02`, … by tooling — do not write IDs in the file itself
- **Scenario**: A Given/When/Then block under `## Scenarios`
- **Scope (IN)**: Bullet list of what the spec explicitly covers — everything in this list is subject to its rules
- **Scope (OUT)**: Bullet list of what is explicitly excluded — tooling must not flag violations in excluded areas

## Rules

### R1 — Required sections
1. Every spec file must contain these headings at level `##` (in any order):
   `Goal`, `Scope (IN)`, `Scope (OUT)`, `Rules`, `Acceptance checks`, `Scenarios`
2. The file title must be a single `#` heading on the first non-blank line
3. `## Definitions (Source of truth)` is strongly recommended but not strictly required by tooling
4. A spec without a `## Rules` section (or with a Rules section that has zero rule blocks) is treated
   as a template or documentation file — the spec-checker skips it entirely
5. Skipped specs must still pass `speclens lint` if they contain Goal, Scope (IN), Scope (OUT),
   Acceptance checks, and Scenarios sections

### R2 — Rules block format
1. Each rule block heading must follow the pattern: `### R{n} — {Title}`
   - `R` is the literal letter R (uppercase)
   - `{n}` is a positive integer (1, 2, 3, …)
   - The separator is ` — ` (space, em dash, space) — not ` - ` or ` – `
   - `{Title}` is a short descriptive label in sentence case
2. Rule items must be a numbered Markdown list (`1.`, `2.`, `3.`, …)
3. Each rule item must be a self-contained, testable statement (not a header or sub-header)
4. Rule blocks must be numbered consecutively from R1 with no gaps within a spec file
5. Two spec files may both define R1 — they are scoped to their own spec; IDs are only unique per file

### R3 — Acceptance checks format
1. `## Acceptance checks` must contain a numbered Markdown list
2. Each item must be a single, binary-checkable statement (pass/fail with no ambiguity)
3. There must be at least one acceptance check per spec file that has rules
4. Acceptance checks must not duplicate rule items verbatim — they should be outcome-oriented
   (e.g., "No component file uses lowercase" not "Rule R1 item 1 must be followed")
5. Tooling assigns IDs `AC-01`, `AC-02`, … to checks in order — do not hardcode IDs in the file

### R4 — Scenarios format
1. `## Scenarios` must contain at least one scenario
2. Each scenario must be a level-3 heading (`### Scenario {letter} — {Short description}`)
3. Each scenario body must contain exactly the three lines: `Given ...`, `When ...`, `Then ...`
4. Scenarios describe end-to-end user-visible behaviour — they are not unit test cases

### R5 — Spec file naming and location
1. Spec files must use kebab-case filenames ending in `.md`: `design-system.md`, `client-defence.md`
2. Files in `specs/client/` are the client-frontend specs checked by `spec-check`
3. Files in `specs/speclens/` are the SpecLens self-specs — excluded from `spec-check` runs
4. Feature specs for the demo app live in `specs/` root: `feature-{NNN}-{slug}.md`
5. No two spec files may share the same base name within the same directory
6. Section specs for client-frontend use the prefix `client-{section}.md` (e.g., `client-defence.md`)
7. SpecLens self-specs use the prefix `speclens-{component}.md`

### R6 — Scope clarity
1. `## Scope (IN)` must be a bullet list — no prose paragraphs
2. `## Scope (OUT)` must be a bullet list — no prose paragraphs
3. Every item in Scope (IN) must be a thing that can be checked (a page, a component, a behaviour)
4. Cross-references to other specs must be explicit: `(covered by design-system.md)` not just `(see above)`

### R7 — Definitions section
1. Each definition entry must follow the format: `- **Term**: explanation`
2. Terms must be bold — the `**Term**` pattern is used by tooling to extract the glossary
3. Definitions must be placed before Rules so they can be referenced in rule items
4. The section heading must be exactly `## Definitions (Source of truth)` to be parsed by spec-checker

## Acceptance checks
1. Every spec file has a single `#` title heading on the first non-blank line
2. Every spec file has all six required `##` sections: Goal, Scope (IN), Scope (OUT), Rules, Acceptance checks, Scenarios
3. Every rule block heading matches the pattern `### R\d+ — .+`
4. Rule item lists are numbered starting at 1 with no gaps
5. `## Acceptance checks` contains at least one numbered list item
6. `## Scenarios` contains at least one `### Scenario` block with Given/When/Then lines
7. All spec filenames are kebab-case `.md` files
8. No two spec files in the same directory share the same base name
9. `speclens lint` passes on every spec file in `specs/`

## Scenarios
### Scenario A — New spec passes lint
Given a developer creates `specs/feature-002-alerts.md` following this format
When they run `npm run speclens:lint`
Then lint reports "Spec lint passed" with the number of acceptance checks parsed

### Scenario B — Malformed rule heading is caught
Given a spec file has a rule block with heading `### Rule 1: My Rule` instead of `### R1 — My Rule`
When `spec-checker.mjs` parses the file
Then the rule block is not extracted and a warning is logged that zero rules were found

### Scenario C — Spec with no Rules is skipped
Given a spec file has no `## Rules` section
When `spec-checker.mjs` processes the specs directory
Then that file is silently skipped and not included in the report
