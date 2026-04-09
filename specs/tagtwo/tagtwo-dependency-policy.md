# TagTwo Dependency Policy

## Goal
Keep the TagTwo demonstration repo auditable by expressing a few binary dependency-policy checks that can be evaluated directly from JSON manifests.

## Scope (IN)
- Root manifest dependencies and devDependencies
- Required root scripts for the fixture/demo repo

## Scope (OUT)
- Transitive dependency trees
- Runtime vulnerability scanning
- License interpretation, which is handled separately by the license checker

## Definitions (Source of truth)
- "Root dependency policy": rules evaluated against the root `package.json`
- "Placeholder dependency": a package intentionally used here to demonstrate a deterministic policy violation

## Rules
### R01 - Placeholder dependencies must not remain in the demo repo
1. The root manifest MUST NOT depend on `left-pad`.

### R02 - The fixture must expose a build script
1. The root manifest MUST define a `build` script.

## Machine checks
```json
[
  {
    "rule": "R01",
    "title": "Placeholder dependencies must not remain in the demo repo",
    "kind": "manifest-dependency-absent",
    "file": "package.json",
    "packageName": "left-pad",
    "scopes": ["dependencies", "devDependencies"],
    "severity": "medium",
    "description": "The root manifest still depends on left-pad, which is reserved here as a demo policy violation.",
    "suggestion": "Remove left-pad from the root manifest or replace it with native string padding."
  },
  {
    "rule": "R02",
    "title": "The fixture must expose a build script",
    "kind": "manifest-script-required",
    "file": "package.json",
    "script": "build",
    "severity": "low",
    "description": "The root manifest must define a build script so the fixture still resembles an executable repo.",
    "suggestion": "Add a build script to package.json."
  }
]
```

## Acceptance checks
1. The dependency-policy spec is evaluated locally from the repo inventory without a browser.
2. A root dependency on `left-pad` is reported as a deterministic policy finding.
3. A missing `build` script is reported as a deterministic policy finding.

## Scenarios
### Scenario A
Given the root manifest contains `left-pad`
When TagTwo spec-check runs
Then SpecLens reports a dependency-policy finding against `package.json`

### Scenario B
Given the root manifest contains a `build` script
When TagTwo spec-check runs
Then the script rule passes without producing a finding
