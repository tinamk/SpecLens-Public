# TagTwo Architecture

## Goal
Define a small, auditable repository baseline for the TagTwo demonstration profile so SpecLens can evaluate a repo without UI access or external credentials.

## Scope (IN)
- Root npm manifest structure
- Reproducibility metadata for npm installs
- Workspace-oriented repo structure for the fixture/demo case

## Scope (OUT)
- Runtime behaviour of the real TagTwo application
- Visual or browser-driven validation
- Ecosystem-specific rules outside npm JSON manifests

## Definitions (Source of truth)
- "Root manifest": the repository-level `package.json`
- "Reproducible npm install": a repo state with a committed `package-lock.json`
- "Workspace package": any package manifest below `packages/`

## Rules
### R01 - Repository manifests must exist
1. The repository MUST contain a root `package.json`.
2. The repository MUST contain a root `package-lock.json`.
3. The repository MUST contain a top-level `README.md`.

### R02 - Root package metadata must be explicit
1. The root manifest MUST declare `packageManager`.
2. The root manifest MUST declare `private: true` for the fixture/demo repo.

### R03 - Workspace structure must be declared
1. The root manifest MUST define `workspaces`.
2. The inventory MUST include at least three package manifests to demonstrate multi-package coverage.

## Machine checks
```json
[
  {
    "rule": "R01",
    "title": "Repository manifests must exist",
    "kind": "file-exists",
    "file": "package.json",
    "severity": "high",
    "description": "The TagTwo demo repo is missing a root package.json.",
    "suggestion": "Add a root package.json at the repository root."
  },
  {
    "rule": "R01",
    "title": "Repository manifests must exist",
    "kind": "file-exists",
    "file": "package-lock.json",
    "severity": "medium",
    "description": "The TagTwo demo repo is missing package-lock.json.",
    "suggestion": "Commit package-lock.json so the demo pipeline is reproducible."
  },
  {
    "rule": "R01",
    "title": "Repository manifests must exist",
    "kind": "file-exists",
    "file": "README.md",
    "severity": "low",
    "description": "The TagTwo demo repo is missing README.md.",
    "suggestion": "Add a top-level README.md that describes the fixture."
  },
  {
    "rule": "R02",
    "title": "Root package metadata must be explicit",
    "kind": "manifest-field-required",
    "file": "package.json",
    "field": "packageManager",
    "severity": "medium",
    "description": "The root manifest must declare the npm packageManager used by the demo repo.",
    "suggestion": "Add a packageManager field such as npm@11.x to the root manifest."
  },
  {
    "rule": "R02",
    "title": "Root package metadata must be explicit",
    "kind": "manifest-field-equals",
    "file": "package.json",
    "field": "private",
    "expected": true,
    "severity": "low",
    "description": "The fixture root manifest should be marked private to avoid accidental publication semantics.",
    "suggestion": "Set private to true in the root package.json."
  },
  {
    "rule": "R03",
    "title": "Workspace structure must be declared",
    "kind": "manifest-field-required",
    "file": "package.json",
    "field": "workspaces",
    "severity": "medium",
    "description": "The root manifest must declare workspaces for the TagTwo fixture.",
    "suggestion": "Add a workspaces array such as [\"packages/*\"] to package.json."
  },
  {
    "rule": "R03",
    "title": "Workspace structure must be declared",
    "kind": "inventory-manifest-count-min",
    "file": ".",
    "minimum": 3,
    "severity": "low",
    "description": "The TagTwo fixture should expose at least three package manifests to demonstrate repo-level coverage.",
    "suggestion": "Add a few small workspace packages or narrow the spec scope."
  }
]
```

## Acceptance checks
1. Running `npm run speclens:inventory:tagtwo` writes `reports/projects/tagtwo/repo-inventory.json`.
2. The resulting inventory records `package.json`, `package-lock.json`, and `README.md` when present.
3. Running `npm run speclens:spec-check -- --profile tagtwo` produces a repo-oriented report without requiring an AI API key.
4. Any missing baseline file or root metadata field appears as an explicit, binary finding in the spec-check report.

## Scenarios
### Scenario A
Given a repo fixture with a root manifest, lockfile, README, and workspaces
When SpecLens runs the TagTwo inventory and spec-check flow
Then the architecture rules can be validated without launching a browser

### Scenario B
Given a repo fixture missing a required root file
When SpecLens runs the TagTwo inventory and spec-check flow
Then the missing file is reported as a deterministic rule violation
