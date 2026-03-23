# SpecLens

AI-powered spec-driven development toolkit. Analyses codebases against human-written specs,
screenshots running apps for visual consistency, and generates interactive HTML dashboards —
all driven by specs you write, not AI guesswork.

> **Spec-Driven Development applied to itself.**
> SpecLens uses its own methodology: every tool in `tools/` has a corresponding spec in
> `specs/speclens/` that defines exactly what it must do. When the code changes, the spec changes.

## Stack

- Frontend demo: React + TypeScript + Vite
- E2E: Playwright (`@playwright/test`)
- AI: Anthropic Claude (`@anthropic-ai/sdk`) — spec checking, visual analysis, component discovery
- CLI: Node.js ESM scripts in `tools/`

---

## Prerequisites

```bash
npm install
npx playwright install chromium   # needed for visual and analyze commands
```

Set your environment variables (API key is required for `spec-check`, `visual`, `discover`, and `consistency`):

```bash
# In .env.local (recommended) or .env at the project root:
ANTHROPIC_API_KEY=sk-ant-...
# or
CLAUDE_API_KEY=sk-ant-...

# Optional: default codebase path for analyze/discover in a sibling folder
SPECLENS_DISCOVER_PATH=../client-frontend

# Optional: login defaults for visual/analyze
client_USERNAME=admin
client_PASSWORD=<yourpass>
```

---

## How It Works

SpecLens has two core analysis modes that work together:

### 1. Spec-check — Code vs Spec
Reads your `specs/*.md` files, extracts the rules, then sends batches of source code to Claude
and asks: "Does this code violate any of these rules?" Returns a structured violation report.

### 2. Visual — Screenshot + Vision
Launches Playwright, navigates every page of the running app, interacts with dropdowns/filters/
pagination, takes screenshots, and sends them to Claude Vision to find visual inconsistencies
(wrong button sizes, inconsistent colors, misaligned spacing). Zooms in on each finding and
maps it back to the source code.

### 3. Results — Interactive Dashboard
Merges all reports into a single HTML file with tabs for Visual, Spec Check, and Label findings.
Issue cards show zoom screenshots, side-by-side comparisons, and code snippets.

---

## Quick Start — Full Analysis

```bash
# Start the client-frontend dev server first (in a separate terminal):
cd C:/Users/TinaMortensenKjaer/client-frontend && npm run dev

# Run the full pipeline — spec-check all specs + visual all sections:
npm run speclens:analyze:all -- --path C:/Users/TinaMortensenKjaer/client-frontend \
  --url http://localhost:5173 --username admin --password <yourpass>

# Open the interactive results dashboard:
npm run speclens:results:serve
```

On subsequent runs, SpecLens uses this priority for path/url/username values:
1. CLI flags (`--path`, `--url`, `--username`)
2. Saved values in `speclens.config.json`
3. Environment variables (for path: `SPECLENS_DISCOVER_PATH` or `SPECLENS_SOURCE_PATH`)

Example repeat run with only password:

```bash
npm run speclens:analyze:all -- --password <yourpass>
# or use env var so you never type the password:
# client_PASSWORD=<yourpass> npm run speclens:analyze:all
```

---

## Commands

### Section-specific analysis (most common)

Run spec-check + visual for one section at a time. Each section automatically includes the
`client-metadata` spec (shared structure rules) in the spec-check step.

| Command | Specs checked | Pages visited |
|---|---|---|
| `npm run speclens:analyze:defence -- --password <p>` | `client-defence` + `client-metadata` | 5 defence pages |
| `npm run speclens:analyze:monitoring -- --password <p>` | `client-monitoring` + `client-metadata` | 2 monitoring pages |
| `npm run speclens:analyze:quality -- --password <p>` | `client-quality` + `client-metadata` | 1 quality page |
| `npm run speclens:analyze:metadata -- --path <dir>` | `client-metadata` only | no visual step |
| `npm run speclens:analyze:all -- --password <p>` | all specs | all sections |

### Individual steps

| Command | Description |
|---|---|
| `npm run speclens:spec-check` | Run spec checker against all specs in `specs/` |
| `npm run speclens:visual -- --url <u> --username <u> --password <p>` | Visual inspection — all sections |
| `npm run speclens:results` | Generate `reports/ai-results.html` dashboard |
| `npm run speclens:results:serve` | Generate dashboard + serve on `http://localhost:4888` |
| `npm run speclens:discover -- --path <dir>` | Scan Svelte components with Claude, build inventory |
| `npm run speclens:consistency` | Find naming inconsistencies across components |
| `npm run speclens:spec-generate -- --section <s>` | Generate a draft UX spec from inventory + CSS/ARIA analysis |
| `npm run speclens:visual-filter` | Post-process visual findings — classify each as intentional (spec-documented) or genuine via Claude |
| `npm run speclens:chaos` | Phase 4 — synthesise all findings into Spec Gaps + structured Change Proposals (CP-001…) |
| `npm run speclens:interaction -- --section client-defence` | Phase 5 — exploratory interaction testing: discover all interactive elements, click/fill/select each, judge before/after screenshots with Claude Vision |
| `npm run speclens:pipeline:defence` | **Run all 5 phases in order** for client-defence: spec-check → visual → visual-filter → chaos → interaction → results |
| `npm run speclens:pipeline:monitoring` | Same full pipeline for client-monitoring |
| `npm run speclens:pipeline:quality` | Same full pipeline for client-quality |

> **Note — running Phase 5 on a live system:**
> By default the interaction tester fills in forms and clicks submit/save/confirm buttons.
> This is safe on a local test environment, but if you ever point it at a live system with real data,
> you should disable form submission first. To do that, open `tools/interaction-tester.mjs` and
> remove (or comment out) the **"Click submit/save/confirm button if present inside the modal"**
> block inside `handleModalFlow` — it is clearly marked with that comment. No other changes are needed.

### Core spec pipeline (demo app)

| Command | Description |
|---|---|
| `npm run speclens:init` | Create `specs/`, `tools/`, `reports/` folders and config file |
| `npm run speclens:lint` | Validate spec format (required sections + acceptance checks) |
| `npm run speclens:extract` | Parse acceptance checks from spec → `tools/tasks.json` |
| `npm run speclens:scan` | Run UI label consistency rules against source files |
| `npm run speclens:test` | Run configured E2E tests and collect Playwright artifacts |
| `npm run speclens:report` | Generate HTML dashboard from step results |
| `npm run speclens:report:open` | Generate dashboard and open it in browser |

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

## Specs

### Specs for client-frontend (`specs/client/*.md`)

These define what client-frontend must do. The spec-checker validates source code against them.

| Spec | Covers |
|---|---|
| `specs/client/design-system.md` | Color tokens, typography, spacing, CSS class naming |
| `specs/client/component-standards.md` | Component file naming, props API, event callbacks, bindable state |
| `specs/client/client-defence.md` | Fraud detection section: incident list, live mode, filtering, resolution |
| `specs/client/client-monitoring.md` | Monitoring section: XDR viewer, events |
| `specs/client/client-quality.md` | Quality dashboard section |
| `specs/client/client-metadata.md` | Shared structural rules that apply to every section |

### SpecLens self-specs (`specs/speclens/*.md`)

SpecLens applies spec-driven development to itself. These specs define what each tool must do.
**When any tool in `tools/` changes, its spec must be updated to match.**

| Spec | Covers |
|---|---|
| `specs/speclens/speclens-cli.md` | All CLI commands, config file, run archiving, analyze pipeline |
| `specs/speclens/speclens-spec-format.md` | Spec file structure: required sections, rule block format, naming |
| `specs/speclens/speclens-visual-inspector.md` | Screenshot strategy, vision analysis, zoom, code location |
| `specs/speclens/speclens-spec-checker.md` | Rule parsing, batch processing, Claude prompts, output format |
| `specs/speclens/speclens-results-viewer.md` | HTML dashboard, zoom overlay, code snippets, serve mode |

---

## Pipeline Diagrams

### Analyze section pipeline

```
npm run speclens:analyze:defence -- --password <p>
        |
        +- spec-check --specs client-defence,client-metadata
        |       +- reads specs/*.md rules
        |       +- sends source code batches to Claude
        |       +- writes reports/spec-check-report.json + .md
        |
        +- visual --section client-defence
        |       +- Playwright navigates /defense/* pages
        |       +- interacts with dropdowns, filters, pagination
        |       +- Claude Vision finds visual inconsistencies
        |       +- zooms in on each finding, maps to source code
        |       +- writes reports/visual/visual-report.json + .md
        |
        +- archive to reports/runs/YYYY-MM-DD_HH-MM-SS_analyze:defence/
```

### Full pipeline flow

```
specs/
  +-- client-defence.md          <- you write the rules
  +-- client-monitoring.md
  +-- client-quality.md
  +-- client-metadata.md
  +-- speclens/                <- SpecLens specs for itself
        +-- speclens-cli.md
        +-- ...

        speclens spec-check    <- Claude checks code against your rules
        speclens visual        <- Playwright + Claude Vision finds inconsistencies
        speclens results       <- interactive HTML dashboard
```

---

## Configuration

`speclens.config.json` is created by `speclens init`. On first analyze, `--path`, `--url`, and
`--username` are saved to it automatically so you only need `--password` on repeat runs.

You can also set defaults in `.env.local` (recommended, gitignored):

```bash
SPECLENS_DISCOVER_PATH=../client-frontend
client_USERNAME=admin
client_PASSWORD=<yourpass>
```

```json
{
  "specPath": "specs/feature-001-modal-consistency.md",
  "tasksOutput": "tools/tasks.json",
  "sourcePath": "C:/Users/TinaMortensenKjaer/client-frontend",
  "targetUrl": "http://localhost:5173",
  "username": "admin",
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

All generated output lives in `reports/`. The main entry point is:

```
reports/ai-results.html    <- open this (or use speclens:results:serve for image support)
```

| File / Directory | Generated by | Description |
|---|---|---|
| `reports/ai-results.html` | `results` / `results:serve` | **Main interactive dashboard** — Visual, Spec Check, Labels tabs |
| `reports/spec-check-report.json` | `spec-check` | All rule violations grouped by spec and rule |
| `reports/spec-check-report.md` | `spec-check` | Human-readable spec violations with severity badges |
| `reports/visual/visual-report.json` | `visual` | Visual findings grouped by section |
| `reports/visual/visual-report.md` | `visual` | Human-readable visual report |
| `reports/visual/screenshots/{section}/` | `visual` | Full-page screenshots per section |
| `reports/visual/screenshots/{section}/zoom-*.png` | `visual` | Zoomed-in screenshots of each finding |
| `reports/component-inventory.json` | `discover` | All Svelte components categorised by type |
| `reports/component-inventory.md` | `discover` | Human-readable component inventory |
| `reports/consistency-report.json` | `consistency` | Naming inconsistency findings |
| `reports/consistency-report.md` | `consistency` | Human-readable consistency report |
| `reports/spec-generation-report.json` | `spec-generate` | Summary of spec generation run (stats, output path) |
| `reports/spec-generation-report.md` | `spec-generate` | Human-readable summary with next-step instructions |
| `specs/client/generated-{section}-spec.md` | `spec-generate` | Auto-generated UX spec draft — review before use |
| `reports/labels-violations.json` | `scan` | UI label rule violations |
| `reports/speclens-state.json` | all steps | Step statuses and timestamps |
| `reports/runs/<runId>/` | `analyze:*` | Archived outputs per run with `manifest.json` |

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
