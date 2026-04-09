# Iteration 2 Architecture

## Overview
Iteration 2 separates SpecLens into target adapters and analyzers so the primary demonstration path can work on a repo without visual tooling.
It now also includes an optional local-only TagTwo self-check bootstrap path for browser-visible
evidence collection without any external model API.

## Related ADRs

- `docs/adr/ADR-0002-tagtwo-profile-aware-adapter-analyzer-architecture.md`
- `docs/adr/ADR-0001-tagtwo-local-selfcheck-bootstrap.md`

## Adapter / Analyzer Split
```text
Target Profile (tagtwo)
  -> repo-json adapter
     -> repo inventory
     -> local spec-check
     -> license-policy checker
     -> results viewer
  -> local-web bootstrap adapter (optional)
     -> page crawl
     -> deterministic browser findings
     -> bootstrap spec proposal
     -> results viewer

Legacy Profile (client-legacy)
  -> svelte-web adapter / legacy scanners
     -> discover / visual / interaction / chaos
```

## TagTwo Pipeline
1. `repo-inventory.mjs` reads repo files and JSON manifests.
2. `spec-checker.mjs` switches to deterministic local mode for `repo-json` profiles.
3. `license-checker.mjs` uses `package-lock.json` to enumerate the dependency tree, reads package manifests for declared license metadata, and evaluates policy outcomes against `policies/license-policy.json`.
4. `results-viewer.mjs` renders current TagTwo findings and links to archived client evidence.

## Optional TagTwo Self-Check Bootstrap
1. `tagtwo-selfcheck.mjs` opens a configured local TagTwo URL and crawls same-origin pages.
2. It records deterministic issues such as load failures, page errors, console errors, failed
   requests, and missing basic document structure.
3. It writes self-check reports under `reports/projects/tagtwo/` and proposes approval-gated
   updates to the TagTwo web bootstrap spec.
4. `results-viewer.mjs` surfaces the self-check output alongside repo-policy findings.

## Notes
- The default TagTwo path remains repo-first and reproducible without a live app.
- The local self-check path is optional bootstrap support, not a replacement for the deterministic baseline.
- The license checker reports policy risk and review-needed status, not legal certainty.
- Patch drafts are intentionally limited to directly owned root-manifest metadata.
