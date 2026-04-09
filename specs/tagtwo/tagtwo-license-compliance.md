# TagTwo License Compliance

## Goal
Define the TagTwo iteration-2 license-policy scope so SpecLens can report policy risk and review-needed findings from npm-style JSON manifests without claiming legal certainty.

## Scope (IN)
- `package.json` license fields
- `package-lock.json` as dependency-tree enumeration input
- SPDX license expressions
- `SEE LICENSE IN <filename>` references
- Allow / review / block policy outcomes

## Scope (OUT)
- Automatic legal conclusions
- Jurisdiction-specific compliance advice
- Non-npm package ecosystems

## Definitions (Source of truth)
- "Policy violation": a license or expression classified as blocked by `policies/license-policy.json`
- "Review needed": a license classification that is unknown or explicitly marked for manual review
- "Metadata issue": a missing field or broken reference that should be fixed before relying on the manifest

## Rules
### R01 - License reporting must stay policy-oriented
1. Findings MUST use wording such as "potential policy violation" or "requires legal/compliance review".
2. Findings MUST NOT automatically describe a dependency as illegal.

### R02 - npm license metadata must be auditable
1. Each evaluated manifest MUST contain either a valid SPDX expression or `SEE LICENSE IN <filename>`.
2. `SEE LICENSE IN <filename>` references MUST point to an existing file next to the manifest.
3. `package-lock.json` SHOULD be used to enumerate the dependency tree when present.
4. Package manifests SHOULD be used as the source of declared license metadata.
5. If installed package manifests are unavailable, the report MUST state that coverage is reduced.

### R03 - Policy classifications must drive severity
1. Blocked licenses MUST be reported as high severity.
2. Unknown or review-only licenses MUST be reported as medium severity.
3. Missing metadata-only issues MUST be reported as low severity.

### R04 - Patch drafts must stay narrow
1. Iteration-2 patch drafts MUST be limited to root-manifest metadata the project directly owns.
2. The checker MUST NOT generate patch drafts for transitive or third-party dependency manifests.

## Acceptance checks
1. Running `npm run speclens:license:tagtwo` writes both JSON and Markdown reports for the active profile.
2. Missing license metadata appears as a low-severity metadata issue.
3. Invalid SPDX expressions or broken `SEE LICENSE IN` references appear as review-needed findings.
4. Blocked licenses appear as high-severity potential policy violations.
5. At least one root-manifest metadata issue can emit a suggested patch draft for human approval.
6. The report states when dependency-tree coverage is reduced because installed package manifests are unavailable.

## Scenarios
### Scenario A
Given a manifest with `license: "SSPL-1.0"`
When the TagTwo license checker runs
Then the report marks it as a high-severity potential policy violation

### Scenario B
Given a manifest with `license: "SEE LICENSE IN LICENSE.md"` and the file is missing
When the TagTwo license checker runs
Then the report marks it as a medium-severity review-needed issue
