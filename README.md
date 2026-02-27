# SpecLens Starter (MVP)

Minimal spec-driven development setup with pipeline:

`spec -> tasks.json -> e2e tests -> minimal code that passes tests`

## Stack

- Frontend: React + TypeScript + Vite
- E2E: Playwright (`@playwright/test`)
- No extra libraries were added beyond Playwright for the test flow.

## Architecture (Short)

```text
specs/feature-001-modal-consistency.md
                |
                v
      tools/speclens.mjs
                |
                v
         tools/tasks.json
                |
                v
      tests/e2e/modal.spec.ts
                |
                v
   src/App.tsx + src/Modal.tsx
                |
                v
          Vite app (:5173)

backend/
  └─ src/   (reserved for future backend services)
```

The workflow is intentionally minimal: the spec drives extracted tasks, tasks are validated through E2E behavior, and frontend code is kept small until tests pass.

## What is built so far

### 1) Spec

- `specs/feature-001-modal-consistency.md`
- Contains goal, scope, constraints, acceptance checks, and scenarios for modal consistency.

### 2) Simple spec parser (SpecLens tool)

- `tools/speclens.mjs`
- Reads acceptance checks from the spec and generates:
  - `tools/tasks.json`

Run:

```bash
npm run speclens
```

### 3) E2E setup

- `playwright.config.ts` with `baseURL` set to `http://localhost:5173`
- `tests/e2e/modal.spec.ts` covers:
  - Close with `Escape` + focus return
  - Close with overlay click + focus return
  - Focus trap when tabbing

Run:

```bash
npm run test:e2e
```

UI mode:

```bash
npm run test:e2e:ui
```

### 4) Minimal implementation that passes tests

- `src/Modal.tsx`
  - Reusable modal
  - `role="dialog"` and `aria-modal="true"`
  - `aria-labelledby` linked to modal title
  - Closes with `X`, overlay click, and `Escape`
  - Focus trap inside modal
  - Focus returns to opener button on close
- `src/App.tsx`
  - Example page with `Open modal` button
  - Opens modal and passes `returnFocusRef`

### 5) Styling separated from component code

Inline styles were moved to dedicated CSS files:

- `src/styles/app.css`
- `src/styles/modal.css`

Imported in components:

- `src/App.tsx`
- `src/Modal.tsx`

### 6) Frontend/backend separation in repo

- Frontend code is in `src/`
- Backend starting structure added in:
  - `backend/README.md`
  - `backend/src/.gitkeep`

## Scripts

Defined in `package.json`:

- `npm run dev` - starts Vite
- `npm run build` - builds the project
- `npm run speclens` - generates `tools/tasks.json` from spec
- `npm run speclens:init` - initializes speclens files/config/template
- `npm run speclens:lint` - validates spec sections + acceptance checks
- `npm run speclens:extract` - extracts acceptance checks into `tools/tasks.json`
- `npm run speclens:scan` - runs configured label scan command
- `npm run speclens:test` - runs configured tests + collects artifacts
- `npm run speclens:report` - generates static dashboard files
- `npm run speclens:report:open` - generates dashboard and opens `reports/latest.html`
- `npm run labels:inventory` - generates UI text inventory reports
- `npm run labels:lint` - runs scoped UI label enforcement rules
- `npm run lint:labels` - runs label scanner with default scope
- `npm run test:e2e` - runs Playwright E2E
- `npm run test:e2e:ui` - runs Playwright in UI mode

## UI Label Tooling

### Inventory (report-only)

The inventory script helps you see existing UI wording/casing so you do not need to guess.

- Script: `tools/ui-text-inventory.mjs`
- Scan target: source files (`.ts`, `.tsx`, `.svelte`)
- Outputs:
  - `reports/ui-text-inventory.json`
  - `reports/ui-text-inventory.md`
- Report includes:
  - text found
  - file path and line number
  - occurrence count (duplicates)

Run:

```bash
npm run labels:inventory
```

### Rules scanner / lint (enforcement)

The rules scanner enforces a small, high-value subset of glossary rules and fails on violations.

- Script: `tools/ui-label-scan.mjs`
- Enforced rules:
  - forbid `Dev`, `dev`, `development`
  - forbid standalone `Run` (must be `Run <target>`)
  - enforce glossary term casing (for terms defined in `src/glossary.ts`)
- Scope:
  - start small to avoid many failures on day 1
  - currently scoped via script to `src/App.tsx`
  - you can pass another folder/file scope: `node tools/ui-label-scan.mjs <path>`

Run:

```bash
npm run labels:lint
```

The scanner also writes JSON output for dashboard/report usage:

- `reports/labels-violations.json`

## SpecLens Dashboard (static HTML)

Generate a file-based dashboard (works with `file://`) that summarizes run status, specs/tasks, violations, artifacts, and history.

Generate:

```bash
npm run speclens:report
```

Generate and open:

```bash
npm run speclens:report:open
```

Output structure:

- `reports/runs/<runId>/dashboard.html`
- `reports/runs/<runId>/dashboard.json`
- `reports/latest.html`
- `reports/latest.json`
- `reports/index.html`

Dashboard data sources:

- `speclens.config.json`
- `reports/speclens-state.json`
- `tools/tasks.json`
- `reports/labels-violations.json`
- Playwright/test artifacts if present (`playwright-report`, `test-results`, `reports/artifacts/*`)

## File Map

For a maintained repository map, see:

- `docs/FILE_MAP.md`

## Verified status

- `npm run speclens`: generates `tasks.json` with 5 tasks.
- `npm run test:e2e`: all tests pass (3/3).

## Acceptance checks status (Feature 001)

1. Modal opens via `Open modal` button - Completed
2. Modal closes via `X`, overlay click, and `ESC` - Completed
3. Focus stays inside modal while tabbing - Completed
4. Focus returns to `Open modal` on close - Completed
5. E2E covers (2)-(4) - Completed
