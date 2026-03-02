# File Map

This document describes what each important file and folder in this repository does.

---

## Root

| File | Description |
|---|---|
| `README.md` | Project overview, all commands, usage examples |
| `package.json` | NPM scripts and dependency declarations |
| `package-lock.json` | Exact dependency lockfile |
| `speclens.config.json` | SpecLens pipeline configuration (spec path, scan command, report paths) |
| `playwright.config.ts` | Playwright E2E runner configuration |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | Base TypeScript configuration |
| `index.html` | Vite HTML shell |
| `eslint.config.js` | ESLint configuration |

---

## CI

| File | Description |
|---|---|
| `.github/workflows/speclens-e2e.yml` | CI pipeline — label scan, E2E tests, artifact upload |

---

## Application Source (`src/`)

Demo React app used for the spec pipeline.

| File | Description |
|---|---|
| `src/main.tsx` | App entry point (mounts React app) |
| `src/App.tsx` | Main UI with button examples and modal usage |
| `src/Modal.tsx` | Accessible modal component (ESC close, focus trap, overlay click) |
| `src/glossary.ts` | Source of truth for standardized UI terms |
| `src/index.css` | Global CSS |
| `src/App.css` | App-level CSS |
| `src/styles/app.css` | App layout styles |
| `src/styles/modal.css` | Modal-specific styles |

---

## Specs (`specs/`)

Human-written specifications that drive the pipeline.

| File | Description |
|---|---|
| `specs/feature-001-modal-consistency.md` | Modal behavior specification (acceptance checks, scenarios) |
| `specs/feature-001-ui-label-consistency.md` | UI label consistency specification (glossary rules) |
| `specs/feature-001-template.md` | Blank spec template for new features |

---

## Tests (`tests/`)

| File | Description |
|---|---|
| `tests/e2e/modal.spec.ts` | Playwright E2E tests — modal ESC close, overlay click, focus trap |

---

## Tooling Scripts (`tools/`)

The SpecLens CLI and all analysis tools.

| File | Description |
|---|---|
| `tools/speclens-cli.mjs` | **Main CLI entry point** — routes all `speclens <command>` calls. Commands: `init`, `lint`, `extract`, `scan`, `test`, `report`, `discover`, `consistency`, `visual` |
| `tools/speclens.mjs` | Legacy spec parser — reads acceptance checks, produces task entries |
| `tools/speclens-dashboard.mjs` | Generates static per-run dashboard HTML and history index |
| `tools/ui-label-scan.mjs` | Label rule scanner — enforces glossary casing, forbids `Dev`/standalone `Run`, outputs `reports/labels-violations.json` |
| `tools/ui-text-inventory.mjs` | Text inventory scanner — discovers all UI strings in source files, outputs JSON + Markdown report |
| `tools/component-scanner.mjs` | **AI component discovery** — walks a Svelte codebase, builds import graph, sends components to Claude for categorization (Button/Modal/Dropdown/Pagination etc.), outputs `reports/component-inventory.*` |
| `tools/consistency-checker.mjs` | **AI consistency analysis** — reads component inventory, extracts props/CSS classes/labels per component, uses Claude to find naming inconsistencies, outputs `reports/consistency-report.*` |
| `tools/visual-inspector.mjs` | **AI visual inspection** — launches Playwright, navigates all app sections (client-defence/monitoring/quality), interacts with dropdowns/filters/pagination, sends screenshots to Claude vision, outputs `reports/visual/` |
| `tools/tasks.json` | Generated task list from `speclens extract` |
| `tools/report-schema.md` | Dashboard JSON schema reference |

---

## Reports (`reports/`)

All generated output from SpecLens commands.

### Component discovery — `npm run speclens:discover -- --path <dir>`

| File | Description |
|---|---|
| `reports/component-inventory.json` | Full component inventory — all components categorized by type, with props, importCount, interactive, navigates flags |
| `reports/component-inventory.md` | Human-readable inventory — grouped by category (Button, Modal, Dropdown, etc.), sorted by import frequency. Includes a **Navigation & Flow Components** section |

### Naming consistency — `npm run speclens:consistency`

| File | Description |
|---|---|
| `reports/consistency-report.json` | All naming inconsistency findings with severity, type, examples, and suggestions |
| `reports/consistency-report.md` | Human-readable report — global issues first, then per-category, with 🔴/🟡/🔵 severity badges |

### Visual inspection — `npm run speclens:visual -- --url <url> --username <u> --password <p>`

| File | Description |
|---|---|
| `reports/visual/visual-report.json` | All visual findings grouped by app section |
| `reports/visual/visual-report.md` | Human-readable report — cross-section issues, then per section with severity badges |
| `reports/visual/screenshots/client-defence/` | Screenshots from the defence section (overview + interactions) |
| `reports/visual/screenshots/client-monitoring/` | Screenshots from the monitoring section |
| `reports/visual/screenshots/client-quality/` | Screenshots from the quality section |

### Core pipeline

| File | Description |
|---|---|
| `reports/labels-violations.json` | Output from `speclens:scan` — UI label rule violations |
| `reports/speclens-state.json` | Step-by-step pipeline status (ok/fail, timestamps, durations) |
| `reports/speclens-report.md` | Markdown pipeline summary |
| `reports/speclens-report.html` | HTML pipeline summary |
| `reports/ui-text-inventory.json` | Machine-readable UI text inventory |
| `reports/ui-text-inventory.md` | Human-readable UI text inventory table |
| `reports/runs/<runId>/dashboard.html` | Per-run static dashboard page |
| `reports/runs/<runId>/dashboard.json` | Per-run dashboard data |
| `reports/latest.html` | Copy of most recent dashboard |
| `reports/latest.json` | Copy of most recent dashboard data |
| `reports/index.html` | Dashboard run history index |
| `reports/artifacts/` | Copied Playwright artifacts (playwright-report, test-results) |

---

## Other

| File | Description |
|---|---|
| `docs/FILE_MAP.md` | This file — repository map |
| `public/vite.svg` | Static asset served directly |
| `backend/README.md` | Notes for backend workspace |
| `backend/src/.gitkeep` | Keeps empty backend source folder tracked |
