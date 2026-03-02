# SpecLens

AI-powered spec-driven development toolkit. Scans codebases, discovers UI components, checks naming and visual consistency, runs E2E tests, and generates reports — all driven from human-readable specs.

## Stack

- Frontend demo: React + TypeScript + Vite
- E2E: Playwright (`@playwright/test`)
- AI: Anthropic Claude (`@anthropic-ai/sdk`) — used for component categorization, naming analysis, and visual inspection
- CLI: Node.js ESM scripts in `tools/`

---

## Prerequisites

```bash
npm install
npx playwright install chromium   # needed for visual and E2E commands
```

Set your Anthropic API key (required for `discover`, `consistency`, and `visual` commands):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or if your project uses CLAUDE_API_KEY:
export CLAUDE_API_KEY=sk-ant-...
```

---

## Pipeline Overview

```
specs/
  └── feature-XXX.md           ← human-written spec (source of truth)
        │
        ├── speclens lint       ← validate spec structure
        ├── speclens extract    ← parse acceptance checks → tasks.json
        ├── speclens scan       ← enforce UI label rules
        ├── speclens test       ← run E2E tests, collect artifacts
        └── speclens report     ← generate HTML dashboard

External codebase (e.g. client-frontend/):
        ├── speclens discover     ← Claude scans Svelte components, categorises by type
        ├── speclens consistency  ← Claude finds naming & CSS inconsistencies
        └── speclens visual       ← Playwright screenshots + Claude vision finds visual issues
```

---

## Commands

### Core pipeline (spec-driven)

| Command | Description |
|---|---|
| `npm run speclens:init` | Create `specs/`, `tools/`, `reports/` folders and config |
| `npm run speclens:lint` | Validate spec format (required sections + acceptance checks) |
| `npm run speclens:extract` | Parse acceptance checks from spec → `tools/tasks.json` |
| `npm run speclens:scan` | Run UI label consistency rules against source files |
| `npm run speclens:test` | Run configured E2E tests and collect Playwright artifacts |
| `npm run speclens:report` | Generate static HTML dashboard from all step results |
| `npm run speclens:report:open` | Generate dashboard and open it in browser |

### AI-powered analysis (external codebase)

| Command | Description |
|---|---|
| `npm run speclens:discover` | Scan a Svelte codebase with Claude — finds reusable components, categorises by type (Button, Modal, Dropdown, Pagination, etc.), detects import frequency and navigation patterns |
| `npm run speclens:consistency` | Reads the component inventory and uses Claude to find prop naming, CSS class naming, and label text inconsistencies |
| `npm run speclens:visual` | Launches Playwright, screenshots all pages + interactive states (dropdowns, filters, pagination), uses Claude vision to find visual inconsistencies grouped by app section |

### Dev utilities

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server for demo app |
| `npm run build` | TypeScript check + Vite build |
| `npm run test:e2e` | Run Playwright E2E tests headless |
| `npm run test:e2e:ui` | Run Playwright in interactive UI mode |
| `npm run labels:inventory` | Generate UI text inventory report |
| `npm run labels:lint` | Run label scanner rules |

---

## Quick Reference — All Commands (with paths)

Copy-paste ready commands for this project. Start the client-frontend dev server first for `visual` and `analyze`.

```bash
# ── ONE COMMAND — runs everything and opens results ───────────────────────────

# First run (saves path/url/username to config, password is never saved):
npm run speclens:analyze -- --path C:/Users/TinaMortensenKjær/client-frontend --url http://localhost:5173 --username admin --password <yourpass>

# All subsequent runs (path/url/username already saved in speclens.config.json):
npm run speclens:analyze -- --password <yourpass>
# or with env var so you don't type the password at all:
# set client_PASSWORD=<yourpass> && npm run speclens:analyze

# With HTTP server (screenshots load as images in the dashboard):
npm run speclens:analyze -- --password <yourpass> --serve

# ── Individual AI steps (if you only want to re-run one part) ────────────────

# 1. Scan Svelte components and categorise by type
npm run speclens:discover -- --path C:/Users/TinaMortensenKjær/client-frontend

# 2. Check naming consistency across discovered components
npm run speclens:consistency

# 3. Screenshot all pages and find visual inconsistencies
npm run speclens:visual -- --url http://localhost:5173 --username admin --password <yourpass>

# 4. Open the AI results dashboard in the browser
npm run speclens:results

# 4b. Serve the dashboard via HTTP (needed if screenshots don't load)
npm run speclens:results:serve

# ── Core spec pipeline (demo app) ────────────────────────────────────────────

npm run speclens:lint          # validate spec format
npm run speclens:extract       # parse acceptance checks → tools/tasks.json
npm run speclens:scan          # enforce UI label rules
npm run speclens:test          # run E2E tests
npm run speclens:report:open   # generate + open HTML dashboard

# ── Dev utilities ─────────────────────────────────────────────────────────────

npm run dev                    # start Vite dev server for demo app
npm run test:e2e               # run Playwright tests headless
npm run test:e2e:ui            # run Playwright in interactive UI mode
npm run labels:inventory       # generate UI text inventory report
```

> **API key required** for `discover`, `consistency`, and `visual`:
> ```bash
> export ANTHROPIC_API_KEY=sk-ant-...
> ```

---

## Usage Examples

### Run the full AI pipeline on client-frontend

```bash
# Step 1 — start the dev server (in a separate terminal)
cd C:/Users/TinaMortensenKjær/client-frontend && npm run dev

# Step 2 — back in SpecLens:
npm run speclens:discover -- --path C:/Users/TinaMortensenKjær/client-frontend
npm run speclens:consistency
npm run speclens:visual -- --url http://localhost:5173 --username admin --password <yourpass>
npm run speclens:results:serve
```

### Run the full spec pipeline on the demo app

```bash
npm run speclens:lint
npm run speclens:extract
npm run speclens:scan
npm run speclens:test
npm run speclens:report:open
```

### Visual inspection only

```bash
npm run speclens:visual -- --url http://localhost:5173 --username admin --password <yourpass>
```

Visits **client-defence** (5 pages), **client-monitoring** (2 pages), and **client-quality** (1 page). On each page it interacts with dropdowns, time filters, filter panels, sidebar menus, and pagination before taking screenshots. Claude vision then compares them and reports inconsistencies by severity.

---

## Configuration

`speclens.config.json` controls paths for the core pipeline:

```json
{
  "specPath": "specs/feature-001-modal-consistency.md",
  "tasksOutput": "tools/tasks.json",
  "scan": { "command": "node tools/ui-label-scan.mjs src/App.tsx" },
  "test": { "command": "npm run test:e2e", "artifacts": ["playwright-report", "test-results"] },
  "report": {
    "reportDir": "reports",
    "stateFile": "reports/speclens-state.json",
    "html": "reports/speclens-report.html"
  },
  "discover": {
    "outputJson": "reports/component-inventory.json",
    "outputMd": "reports/component-inventory.md"
  }
}
```

---

## Reports

All reports are written to `reports/`:

| File | Generated by | Description |
|---|---|---|
| `reports/component-inventory.md` | `discover` | Components grouped by type with import counts, props, interactive/navigates flags |
| `reports/component-inventory.json` | `discover` | Machine-readable component inventory |
| `reports/consistency-report.md` | `consistency` | Naming inconsistencies by severity — prop names, CSS classes, label text |
| `reports/consistency-report.json` | `consistency` | Machine-readable consistency findings |
| `reports/visual/visual-report.md` | `visual` | Visual inconsistencies by section with severity badges |
| `reports/visual/visual-report.json` | `visual` | Machine-readable visual findings |
| `reports/visual/screenshots/` | `visual` | All screenshots taken during inspection |
| `reports/labels-violations.json` | `scan` | UI label rule violations |
| `reports/speclens-state.json` | all steps | Step statuses and timestamps for dashboard |
| `reports/runs/<id>/dashboard.html` | `report` | Per-run static dashboard |
| `reports/latest.html` | `report` | Latest dashboard (copy) |

---

## File Map

See [docs/FILE_MAP.md](docs/FILE_MAP.md) for a description of every file in the repository.

---

## Acceptance checks status (Feature 001 — Modal)

1. Modal opens via `Open modal` button — Completed
2. Modal closes via `X`, overlay click, and `ESC` — Completed
3. Focus stays inside modal while tabbing — Completed
4. Focus returns to `Open modal` on close — Completed
5. E2E covers (2)–(4) — Completed
