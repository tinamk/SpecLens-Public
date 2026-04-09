# SpecLens CLI — Command Interface

## Goal
`tools/speclens-cli.mjs` is the single entry point for all SpecLens operations. It orchestrates
sub-tools, manages run state, and archives output so every run is reproducible and traceable.

## Scope (IN)
- All npm scripts prefixed `speclens:*` in `package.json`
- The `speclens.config.json` configuration file format
- Run state tracking in `reports/speclens-state.json`
- Run archiving under `reports/runs/{runId}/`
- `.env` auto-loading (ANTHROPIC_API_KEY / CLAUDE_API_KEY)
- The `analyze`, `analyze:all`, `analyze:defence`, `analyze:monitoring`,
  `analyze:quality`, `analyze:metadata` pipeline commands
- The `selfcheck:tagtwo` command for local TagTwo webpage inspection
- The `visual`, `spec-check`, `consistency`, `discover`, `results`, `init`, `lint`,
  `extract`, `scan`, `test`, `report` commands

## Scope (OUT)
- The internal logic of sub-tools (spec-checker, visual-inspector, results-viewer — each has its own spec)
- The spec file format (see `speclens-spec-format.md`)
- CI/CD integration details

## Definitions (Source of truth)
- **Command**: A positional argument to `speclens-cli.mjs` (e.g., `node tools/speclens-cli.mjs analyze`)
- **npm script**: A `package.json` script that invokes a command (e.g., `npm run speclens:analyze`)
- **runId**: A timestamp-based string `YYYY-MM-DD_HH-MM-SS_{command}` used to name archive folders
- **Step**: One named entry in `speclens-state.json` representing the last run of a pipeline stage
- **Pipeline**: An ordered sequence of steps executed by an `analyze:*` command
- **Section**: One of `defence`, `monitoring`, `quality`, `metadata` — maps to spec files and route directories

## Rules

### R1 — Command routing
1. The CLI must support these commands via `process.argv[2]`:
   `init`, `lint`, `extract`, `scan`, `test`, `report`, `analyze`, `analyze:all`,
   `analyze:defence`, `analyze:monitoring`, `analyze:quality`, `analyze:metadata`,
   `discover`, `spec-check`, `consistency`, `visual`, `results`, `selfcheck:tagtwo`
2. An unrecognised command must print a usage message listing all valid commands and exit with code 1
3. Every command that invokes a sub-tool must propagate the sub-tool's exit code — if the sub-tool
   fails, the CLI must exit non-zero
4. Each command must record its outcome in `reports/speclens-state.json` via `updateStep()`

### R2 — Config file (`speclens.config.json`)
1. The config file must live at the project root (`process.cwd()/speclens.config.json`)
2. Required top-level keys: `specPath`, `tasksOutput`, `scan`, `test`, `report`
3. The `report` key must contain: `reportDir`, `stateFile`, `markdown`, `html`, `artifactsDir`
4. Missing config causes a clear error: `"Missing config file: speclens.config.json. Run speclens init first."`
5. `init` must create the config file with sensible defaults if it does not already exist — it must
   never overwrite an existing config
6. The default TagTwo profile config may include an optional `selfCheck` section with the local
   base URL and report output paths for browser-visible TagTwo checks

### R3 — Environment loading
1. The CLI must load `.env` from `process.cwd()` before any command executes
2. Keys already present in `process.env` must not be overridden (system env takes priority)
3. Both `ANTHROPIC_API_KEY` and `CLAUDE_API_KEY` are accepted; `ANTHROPIC_API_KEY` takes precedence
4. If the required API key is absent when a Claude-calling command runs, exit with a clear error message
5. `selfcheck:tagtwo` must not require any API key

### R4 — Run archiving
1. Every `analyze:*` command must archive its outputs to `reports/runs/{runId}/`
2. The `runId` format is `YYYY-MM-DD_HH-MM-SS_{command}`
3. Each archive directory must contain a `manifest.json` with: `command`, `runId`, `archivedAt`, `files[]`
4. Archiving must be non-destructive — if a source file does not exist, skip it with a warning;
   never abort the whole run because of a missing artifact

### R5 — Step state tracking
1. `reports/speclens-state.json` must be updated after every step with: `ok` (boolean), `at` (ISO timestamp),
   and step-specific metadata (e.g., `violationCount`, `screenshotsTaken`)
2. The state file must be created if it does not exist; never crash if it is absent
3. State must be read fresh from disk on each access — never cached in memory across commands

### R6 — Analyze pipeline commands
1. `analyze:defence` must run: `spec-check --specs client-defence,client-metadata` then `visual --section client-defence`
2. `analyze:monitoring` must run: `spec-check --specs client-monitoring,client-metadata` then `visual --section client-monitoring`
3. `analyze:quality` must run: `spec-check --specs client-quality,client-metadata` then `visual --section client-quality`
4. `analyze:metadata` must run: `spec-check --specs client-metadata` only (no visual step)
5. `analyze:all` must run: `spec-check` (all specs) then `visual` (all sections)
6. `analyze` (bare) must run: `spec-check` then `visual` (same as `analyze:all`)
7. Each pipeline step must be run sequentially — a failing step must not abort the pipeline unless
   the failure makes subsequent steps meaningless (e.g., missing inventory)
8. The `--source-path` flag from the CLI arguments must be forwarded to both `spec-check` and `visual`

### R7 - TagTwo self-check command
1. `selfcheck:tagtwo` must run `tools/tagtwo-selfcheck.mjs` for the TagTwo profile and then refresh
   the TagTwo results dashboard.
2. The command must accept `--url`, `--start-path`, `--max-pages`, `--seed-paths`, `--auth-state`,
   `--browser-channel`, `--connect-cdp`, `--capture-auth`, `--anonymous`, `--write-spec-draft`,
   and `--serve`.
3. The command must accept both `--flag value` and `--flag=value` forms for those named flags.
4. When invoked through `npm run`, runner-forwarded `npm_config_*` values for those named flags
   must be treated the same as explicit CLI flags so package-script overrides still work.
5. The self-check run must archive its JSON report, Markdown report, screenshots directory, and
   updated dashboard snapshot under the TagTwo run archive directory.
6. When `--write-spec-draft` is not provided, the command must remain read-only with respect to
   `specs/tagtwo/`.
7. When `--write-spec-draft` is provided, the CLI must pass that flag through to the sub-tool
   without inventing extra approval behavior.

### R8 — npm script naming
1. Every CLI command must have a corresponding `package.json` script named `speclens:{command}`
2. Scripts that accept extra flags must forward them via `-- <flags>` syntax
3. No duplicate script definitions — each script name maps to exactly one command

### R9 — init command
1. `init` must create these directories if absent: `specs/`, `tools/`, `reports/`
2. `init` must create `specs/feature-001-template.md` as a starter spec template if absent
3. `init` must print a confirmation listing what was created

## Acceptance checks
1. Running `node tools/speclens-cli.mjs unknownCommand` prints usage and exits with code 1
2. `speclens.config.json` is created by `init` and never overwritten by a second `init` call
3. `.env` is loaded before any API call; `ANTHROPIC_API_KEY` takes priority over `CLAUDE_API_KEY`
4. After `analyze:defence`, a folder `reports/runs/YYYY-MM-DD_*_analyze:defence/` exists with `manifest.json`
5. `reports/speclens-state.json` contains a `steps.visual` entry after a visual run
6. `analyze:defence` runs spec-check with `client-defence,client-metadata` and visual with `--section client-defence`
7. `analyze:metadata` does not run a visual step
8. A non-zero exit code from a sub-tool causes the CLI to exit non-zero
9. All `speclens:*` npm scripts exist in `package.json`
10. `selfcheck:tagtwo` runs without any API key and writes TagTwo self-check artifacts
11. `selfcheck:tagtwo -- --write-spec-draft` passes the approval flag through to the sub-tool
12. `npm run speclens:tagtwo:selfcheck -- --url=http://127.0.0.1:4174/` honors the overridden URL
    instead of falling back to the configured default
13. `npm run speclens:tagtwo:selfcheck -- --connect-cdp=http://127.0.0.1:9222` passes the CDP
    connection URL through to the self-check sub-tool

## Scenarios
### Scenario A — First-time setup
Given a new project directory with no config
When the developer runs `npm run speclens:init`
Then `speclens.config.json`, `specs/`, `tools/`, and `reports/` are created; a second run does not overwrite them

### Scenario B — Analyse a single section
Given `speclens.config.json` exists and the client-frontend dev server is running
When the developer runs `npm run speclens:analyze:defence`
Then spec-check runs against `client-defence` and `client-metadata` specs, then visual runs for the defence section, and results are archived under `reports/runs/`

### Scenario C — Missing API key
Given `.env` does not define `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`
When the developer runs any analyze command
Then the CLI prints a clear error message and exits with code 1 before making any API calls

### Scenario D — Local TagTwo self-check
Given a local TagTwo app is reachable at the configured URL
When the developer runs `npm run speclens:tagtwo:selfcheck`
Then the CLI runs the local self-check tool, archives the report artifacts, and refreshes the
TagTwo dashboard without requiring any external AI provider
