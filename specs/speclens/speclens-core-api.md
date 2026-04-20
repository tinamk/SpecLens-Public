# SpecLens Core API

## Goal

Define the stable hosted JS API for workspace creation, behavioral-parity repo analysis, run retrieval, and patch export.

## Scope (IN)

- `createWorkspace(options)`
- `analyzeRepo({ source, preset, output, workspace, mode })`
- `listRoleDefinitions()`
- `getRun(runId, options)`
- `listRuns(filters)`
- `exportPatch(runId, selection, options)`

## Scope (OUT)

- Legacy `tools/` command behavior
- Background job execution

## Definitions (Source of truth)

- **Workspace**: Managed SpecLens runtime area under `.speclens-workspace/`
- **Run**: One immutable analysis snapshot with preset, role, and runtime metadata
- **Source descriptor**: `{ type, location, ref?, depth? }`

## Rules

### R1 - Workspace behavior
1. Analysis runtime state must be written into `.speclens-workspace/`, not the target repo.
2. `createWorkspace()` must ensure cache, runs, generated, and exports directories exist.

### R2 - Source handling
1. `analyzeRepo()` must accept `path`, `git`, and `workspace` source descriptors.
2. Git sources must be acquired through a managed workspace cache.
3. Normal analysis must remain read-only for the target repo.

### R3 - Analysis output
1. Each run must write a JSON run record, Markdown report, HTML dashboard, and generated spec pack.
2. Each run must resolve a preset, role set, and runtime mode.
3. Reports must expose normalized sections for the migrated role families.
4. When a run resolves to `browser` runtime mode, SpecLens must execute browser-heavy roles against a sandbox copy of the target repo instead of mutating the original source.
5. Browser runs must support secret-backed authenticated coverage through workspace-managed credential pairs or Playwright storage state.

### R4 - Patch export
1. `exportPatch()` must create a patch bundle inside the managed workspace.
2. Patch export must not mutate the target repo.

## Acceptance checks
1. An arbitrary local repo can be analyzed without a repo-local SpecLens config file.
2. A git source can be analyzed from the same API through the workspace cache.
3. Exporting a patch bundle leaves the target repo unchanged.
4. A preset-role analysis returns normalized sections and findings.
5. A bootable local repo can be analyzed in `browser` runtime mode with crawl screenshots and interaction evidence written into `.speclens-workspace/`.

## Scenarios

### Scenario A
Given a local repo path
When `analyzeRepo()` runs
Then SpecLens writes the run artifacts into `.speclens-workspace/`
