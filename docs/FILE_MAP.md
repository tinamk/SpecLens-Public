# File Map

This document describes what each important file/folder in this repository does.

## Root
- `.gitignore`: Files and folders excluded from git tracking.
- `README.md`: Project overview and local usage notes.
- `package.json`: NPM scripts and dependency declarations.
- `package-lock.json`: Exact dependency lockfile.
- `index.html`: Vite HTML shell.
- `vite.config.ts`: Vite configuration.
- `eslint.config.js`: ESLint configuration.
- `playwright.config.ts`: Playwright E2E runner configuration.
- `tsconfig.json`: Base TypeScript configuration.
- `tsconfig.app.json`: TypeScript settings for app code.
- `tsconfig.node.json`: TypeScript settings for Node/tool scripts.

## CI
- `.github/workflows/speclens-e2e.yml`: CI pipeline for Speclens, label scan, E2E tests, and artifact upload.

## Application Source (`src/`)
- `src/main.tsx`: App entry point (mounts React app).
- `src/App.tsx`: Main app UI composition and button examples.
- `src/Modal.tsx`: Modal component logic and accessibility behavior.
- `src/glossary.ts`: Source of truth for standardized UI terms.
- `src/index.css`: Global CSS.
- `src/App.css`: App-level CSS (scaffold/custom usage).
- `src/styles/app.css`: App layout/styles currently imported by `App.tsx`.
- `src/styles/modal.css`: Modal-specific styles.
- `src/assets/react.svg`: Static asset from starter template.

## Tests
- `tests/e2e/modal.spec.ts`: Playwright E2E tests for modal behavior.
- `test-results/.last-run.json`: Playwright-generated metadata from latest run.

## Specs
- `specs/feature-001-modal-consistency.md`: Modal feature specification.
- `specs/feature-001-ui-label-consistency.md`: UI label consistency specification.

## Tooling Scripts (`tools/`)
- `tools/speclens.mjs`: Reads spec acceptance checks and produces task entries.
- `tools/speclens-cli.mjs`: Main SpecLens CLI (`init/lint/extract/scan/test/report`).
- `tools/speclens-dashboard.mjs`: Generates static dashboard run pages and history index.
- `tools/report-schema.md`: Dashboard JSON schema reference.
- `tools/tasks.json`: Generated tasks from `speclens.mjs`.
- `tools/ui-label-scan.mjs`: Rule scanner for label consistency enforcement.
- `tools/ui-text-inventory.mjs`: Text inventory scanner that reports discovered UI strings.

## Reports (`reports/`)
- `reports/runs/<runId>/dashboard.html`: Per-run static dashboard page.
- `reports/runs/<runId>/dashboard.json`: Per-run dashboard data.
- `reports/latest.html`: Copy of newest dashboard page.
- `reports/latest.json`: Copy of newest dashboard data.
- `reports/index.html`: Dashboard run history page.
- `reports/labels-violations.json`: Structured output from label scan step.
- `reports/speclens-state.json`: Step status/state used by reporting.
- `reports/ui-text-inventory.json`: Machine-readable UI text inventory report.
- `reports/ui-text-inventory.md`: Human-readable UI text inventory summary.

## Other
- `public/vite.svg`: Public static file served directly.
- `backend/README.md`: Notes for backend workspace.
- `backend/src/.gitkeep`: Keeps empty backend source folder tracked.
