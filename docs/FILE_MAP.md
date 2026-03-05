# File Map

This document describes what each important file and folder in this repository does.

---

## Root

| File | Description |
|---|---|
| `README.md` | Project overview, all commands, pipeline diagrams, report index |
| `package.json` | NPM scripts and dependency declarations |
| `package-lock.json` | Exact dependency lockfile |
| `speclens.config.json` | SpecLens pipeline configuration (spec path, source path, target URL, report paths) |
| `PlanDocument.md` | Academic background document — spec-driven development theory and SpecLens motivation |
| `playwright.config.ts` | Playwright E2E runner configuration |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | Base TypeScript configuration |
| `index.html` | Vite HTML shell for demo app |
| `eslint.config.js` | ESLint configuration |
| `.env` | API keys (not committed) — `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`, `client_USERNAME`, `client_PASSWORD` |

---

## CI

| File | Description |
|---|---|
| `.github/workflows/speclens-e2e.yml` | CI pipeline — label scan, E2E tests, artifact upload |

---

## Application Source (`src/`)

Demo React app used as the spec pipeline target for the feature-001 specs.

| File | Description |
|---|---|
| `src/main.tsx` | App entry point (mounts React app) |
| `src/App.tsx` | Main UI with button examples and modal usage |
| `src/Modal.tsx` | Accessible modal component (ESC close, focus trap, overlay click) |
| `src/glossary.ts` | Source of truth for standardized UI label terms |
| `src/index.css` | Global CSS |
| `src/App.css` | App-level CSS |
| `src/styles/app.css` | App layout styles |
| `src/styles/modal.css` | Modal-specific styles |

---

## Specs (`specs/`)

Human-written specifications that drive the pipeline. The spec-checker validates source code
against the rules in these files. Specs are the source of truth — code must match specs.

### Specs for client-frontend (`specs/client/`)

| File | Description |
|---|---|
| `specs/client/design-system.md` | client-frontend design system: color tokens (`--client-*`), typography, spacing (`rem-calc`), CSS class naming (kebab-case), Foundation grid |
| `specs/client/component-standards.md` | Svelte component conventions: PascalCase naming, props API (`classNames`, `title`, `disabled`), event callbacks (`on*`), bindable state (`$bindable`), Button/Modal/Table/Input APIs |
| `specs/client/client-defence.md` | Fraud detection section: incident overview, live mode, filtering, incident resolution, validated prefixes, blocked calls, traffic overview, QoE |
| `specs/client/client-monitoring.md` | Monitoring section: XDR viewer, events list |
| `specs/client/client-quality.md` | Quality dashboard section |
| `specs/client/client-metadata.md` | Shared structural rules that apply to all sections (navigation, layout, widget usage) |

### Demo app specs (`specs/`)

| File | Description |
|---|---|
| `specs/feature-001-modal-consistency.md` | Modal behavior spec for demo app (acceptance checks, scenarios) |
| `specs/feature-001-ui-label-consistency.md` | UI label consistency spec for demo app (glossary rules) |
| `specs/feature-001-template.md` | Blank spec template for new features |

### SpecLens self-specs

SpecLens applies spec-driven development to itself. Every tool has a spec. **When any tool changes, its spec must be updated.**

| File | Description |
|---|---|
| `specs/speclens/speclens-cli.md` | CLI entry point: all commands, config file format, `.env` loading, run archiving, step state, analyze pipeline routing |
| `specs/speclens/speclens-spec-format.md` | Spec file structure: required sections, `### R{n} — {Title}` rule format, acceptance check numbering, scenario format, file naming conventions |
| `specs/speclens/speclens-visual-inspector.md` | visual-inspector.mjs: section map, auth, screenshot capture strategy, Claude vision batching, zoom screenshots (80px pad), 4-level code location search, output format |
| `specs/speclens/speclens-spec-checker.md` | spec-checker.mjs: spec parsing, phase strategy (filenames/style/script/full), batch processing, Claude prompt construction, `extractJsonArray()`, output format |
| `specs/speclens/speclens-results-viewer.md` | results-viewer.mjs: HTML dashboard generation, tab structure, issue cards, zoom overlay, code block rendering, serve mode on port 4888 |
| `specs/speclens/speclens-spec-generator.md` | spec-generator.mjs: prerequisite loading, static CSS/ARIA analysis, digest construction, single Claude call, output format |

---

## Tests (`tests/`)

| File | Description |
|---|---|
| `tests/e2e/modal.spec.ts` | Playwright E2E tests — modal ESC close, overlay click, focus trap, focus return |

---

## Tooling Scripts (`tools/`)

The SpecLens CLI and all analysis tools. Each tool's behaviour is specified in `specs/speclens/`.

| File | Description |
|---|---|
| `tools/speclens-cli.mjs` | **Main CLI entry point.** Routes all `speclens <command>` calls, loads `.env`, manages config and step state, archives runs. Commands: `init`, `lint`, `extract`, `scan`, `test`, `report`, `analyze`, `analyze:all`, `analyze:defence`, `analyze:monitoring`, `analyze:quality`, `analyze:metadata`, `discover`, `spec-check`, `consistency`, `spec-generate`, `visual`, `results` |
| `tools/spec-checker.mjs` | **AI spec compliance checker.** Reads `specs/*.md`, extracts rules, sends source code batches to Claude, collects violations, writes `reports/spec-check-report.*`. Uses `extractJsonArray()` for robust response parsing. |
| `tools/visual-inspector.mjs` | **AI visual inspector.** Launches Playwright, navigates client-frontend sections, interacts with dropdowns/filters/pagination, sends screenshots to Claude Vision, takes zoom screenshots of each finding, maps findings to source code via 4-level search, writes `reports/visual/`. |
| `tools/results-viewer.mjs` | **HTML dashboard generator.** Reads all report JSON files, generates a self-contained `reports/ai-results.html` with tabbed sections, issue cards, zoom overlay, code block viewer, and optional HTTP serve mode on port 4888. |
| `tools/speclens-dashboard.mjs` | Generates static per-run dashboard HTML and run history index (used by `report` command) |
| `tools/speclens.mjs` | Legacy spec parser — reads acceptance checks, produces task entries |
| `tools/ui-label-scan.mjs` | Label rule scanner — enforces glossary casing, outputs `reports/labels-violations.json` |
| `tools/ui-text-inventory.mjs` | Text inventory scanner — discovers all UI strings in source files, outputs `reports/ui-text-inventory.*` |
| `tools/component-scanner.mjs` | **AI component discovery.** Walks a Svelte codebase, builds import graph, sends components to Claude for categorization, outputs `reports/component-inventory.*` |
| `tools/consistency-checker.mjs` | **AI consistency analysis.** Reads component inventory, uses Claude to find prop naming, CSS class, and label text inconsistencies, outputs `reports/consistency-report.*` |
| `tools/spec-generator.mjs` | **AI spec generator (Phase 2).** Reads component inventory + consistency report, performs static CSS/ARIA analysis, calls Claude once to generate a draft UX spec in SpecLens format. Writes `specs/client/generated-{section}-spec.md` and `reports/spec-generation-report.*` |
| `tools/tasks.json` | Generated task list from `speclens extract` |
| `tools/report-schema.md` | Dashboard JSON schema reference |

---

## Reports (`reports/`)

All generated output from SpecLens commands. The main entry point for reviewing results is
`reports/ai-results.html` (use `speclens:results:serve` for full image support).

### Main dashboard

| File | Description |
|---|---|
| `reports/ai-results.html` | **Interactive dashboard** — Visual, Spec Check, Labels tabs with issue cards, zoom screenshots, code snippets |

### Spec check — `npm run speclens:spec-check`

| File | Description |
|---|---|
| `reports/spec-check-report.json` | All rule violations: spec, rule, severity, file, violating code, description, suggestion |
| `reports/spec-check-report.md` | Human-readable report with severity badges, grouped by spec then rule |

### Visual inspection — `npm run speclens:visual -- --url <u> --username <u> --password <p>`

| File | Description |
|---|---|
| `reports/visual/visual-report.json` | All visual findings with section grouping, zoom paths, code locations, severity counts |
| `reports/visual/visual-report.md` | Human-readable visual report with cross-section issues and per-section findings |
| `reports/visual/screenshots/client-defence/` | Full-page screenshots from the defence section |
| `reports/visual/screenshots/client-monitoring/` | Full-page screenshots from the monitoring section |
| `reports/visual/screenshots/client-quality/` | Full-page screenshots from the quality section |
| `reports/visual/screenshots/{section}/zoom-*.png` | Zoomed-in (80px padded) crops of each finding location |

### Component discovery — `npm run speclens:discover -- --path <dir>`

| File | Description |
|---|---|
| `reports/component-inventory.json` | Full component inventory — all components categorized by type, with props, importCount, interactive, navigates flags |
| `reports/component-inventory.md` | Human-readable inventory — grouped by category, sorted by import frequency |

### Naming consistency — `npm run speclens:consistency`

| File | Description |
|---|---|
| `reports/consistency-report.json` | All naming inconsistency findings with severity, type, examples, and suggestions |
| `reports/consistency-report.md` | Human-readable report with severity badges, global issues first then per-category |

### Spec generation — `npm run speclens:spec-generate`

| File | Description |
|---|---|
| `reports/spec-generation-report.json` | Stats from the generation run: components analysed, patterns found, output path |
| `reports/spec-generation-report.md` | Human-readable summary with next-step instructions |
| `specs/client/generated-{section}-spec.md` | Auto-generated UX spec draft — review and edit before using with spec-check |

### Core pipeline

| File | Description |
|---|---|
| `reports/labels-violations.json` | Output from `speclens:scan` — UI label rule violations |
| `reports/speclens-state.json` | Step-by-step pipeline status (ok/fail, timestamps, durations, metadata) |
| `reports/speclens-report.md` | Markdown pipeline summary |
| `reports/speclens-report.html` | HTML pipeline summary |
| `reports/ui-text-inventory.json` | Machine-readable UI text inventory |
| `reports/ui-text-inventory.md` | Human-readable UI text inventory table |

### Run archive — created by `analyze:*` commands

| File | Description |
|---|---|
| `reports/runs/<runId>/` | One folder per run, named `YYYY-MM-DD_HH-MM-SS_{command}` |
| `reports/runs/<runId>/manifest.json` | Run metadata: command, runId, archivedAt, list of archived files |
| `reports/runs/<runId>/spec-check-report.*` | Spec check outputs archived from that run |
| `reports/runs/<runId>/visual/` | Visual outputs archived from that run |
| `reports/runs/<runId>/dashboard.html` | Per-run static dashboard page (from `report` command) |
| `reports/index.html` | Dashboard run history index |
| `reports/artifacts/` | Copied Playwright artifacts (playwright-report, test-results) |

---

## Docs

| File | Description |
|---|---|
| `docs/FILE_MAP.md` | This file — complete repository map |

---

## Other

| File | Description |
|---|---|
| `public/vite.svg` | Static asset served by Vite dev server |
| `backend/README.md` | Notes for backend workspace |
| `backend/src/.gitkeep` | Keeps empty backend source folder tracked |
