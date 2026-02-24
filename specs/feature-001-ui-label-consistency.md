# Feature 001 — UI label consistency (MVP)

## Goal
Ensure UI button labels and key terms are consistent in naming and casing across the app.

## Scope (IN)
- Enforce consistent casing and wording for a small set of key terms (starting set below).
- Detect inconsistent labels in the UI.
- Provide a single source of truth for terms (a glossary).
- Add automated checks that fail when inconsistency is introduced.

## Scope (OUT)
- No full redesign of UI.
- No translation/i18n system.
- No refactoring of every single string in the entire app (only the mapped terms in this MVP).

## Definitions (Source of truth)
We standardize the following terms (exact match):
- "Development" (NOT: Dev, dev, development)
- "Run <target>" (NOT: Run alone)
- "Settings" (NOT: Setting, settings when used as a title/button)
- "Save" (NOT: SAVE, save, Save changes) — for MVP use exactly "Save"
- Buttons use Title Case: e.g. "Open Modal", "Run Development", "Save"

## Rules
1. Buttons and primary action labels use Title Case.
2. "Run" must always include what is being run: "Run Development", "Run Tests", etc.
3. The term "Development" must always be written exactly as "Development" (capital D, full word).
4. No UI label should contain the forbidden variants listed above.

## Acceptance checks
1. A glossary file exists and is used as the source of truth for the standard terms.
2. There is an automated check that scans UI source files and fails if forbidden variants are present.
3. There is an automated check that fails if any label contains the standalone word "Run" as a complete label.
4. Add at least 3 examples in the UI that use the glossary terms (e.g. buttons).
5. All checks run in CI and locally via npm scripts.

## Scenarios
### Scenario A: Forbidden variant introduced
Given a developer adds a button labeled "dev"
When checks run
Then the checks fail and report the file/line

### Scenario B: Standalone "Run"
Given a developer adds a button labeled "Run"
When checks run
Then the checks fail and suggest "Run <target>"
