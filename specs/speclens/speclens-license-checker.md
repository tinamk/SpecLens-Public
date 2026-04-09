# SpecLens License Checker

## Goal
Specify the deterministic license-policy analyzer used in iteration 2 so SpecLens can evaluate npm-style JSON manifests without visual tooling or external credentials.

## Scope (IN)
- Reading repo inventory or repo paths for npm manifests
- Using `package-lock.json` as dependency-tree enumeration input when present
- Evaluating SPDX expressions and `SEE LICENSE IN <filename>` metadata
- Applying allow / review / block policy classifications
- Producing JSON, Markdown, and patch-draft evidence

## Scope (OUT)
- Legal advice or legal certainty
- Ecosystem support beyond npm-style JSON manifests in iteration 2
- Automatic patch application without explicit human approval

## Definitions (Source of truth)
- "Patch draft": a suggested manifest change prepared for explicit human approval
- "Approval": an explicit `--apply-draft <id>` command invocation
- "Policy classification": the allow / review / block decision taken from `policies/license-policy.json`

## Rules
### R01 - Input handling must be deterministic
1. The tool MUST run without browser access.
2. The tool MUST run without Anthropic credentials.
3. The tool MUST be able to read the active profile target or an explicit `--path`.
4. The tool SHOULD use `package-lock.json` to enumerate dependency-tree entries when it exists.
5. The tool SHOULD read package manifests as the source of declared license metadata.
6. If installed package manifests are unavailable, the tool MUST report reduced coverage explicitly.

### R02 - Output must be reproducible
1. The tool MUST write a JSON report.
2. The tool MUST write a Markdown report.
3. The JSON report MUST include severity counts and manifest-level findings.

### R03 - Patch drafts must remain human-approved
1. The tool MAY generate suggested patch drafts for selected metadata issues.
2. The tool MUST NOT apply a patch draft unless the user explicitly passes `--apply-draft <id>`.
3. When a patch draft is applied, the tool MUST store before/after evidence and rerun the checker.
4. Iteration-2 patch drafts MUST be limited to root-manifest files the project directly owns.
5. The tool MUST NOT generate patch drafts for transitive dependency manifests.

## Acceptance checks
1. Running `npm run speclens:license:tagtwo` succeeds without `ANTHROPIC_API_KEY`.
2. The tool writes `license-report.json` and `license-report.md` under the active profile report directory.
3. A missing root license field produces a patch draft but no file mutation until `--apply-draft` is used.
4. After applying a patch draft, the tool stores before/after evidence and refreshes the report.
5. The report includes a coverage note explaining whether installed package manifests were available.

## Scenarios
### Scenario A
Given a root manifest missing a license field
When the license checker runs
Then the report includes a metadata finding and a suggested patch draft

### Scenario B
Given the user explicitly applies a valid patch draft
When the license checker reruns
Then the report records before/after evidence and the updated manifest state
