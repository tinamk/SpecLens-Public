# SpecLens Thesis Overview Update: Iterations 1-5 And Post-Parity Hardening

## Purpose

This document is a new thesis-oriented overview that extends `docs/thesis/ITERATIONS-001-005-thesis-foundation.md` with the work added after that foundation synthesis.

It should be read as the current thesis overview as of 2026-04-28. It does not declare a new official iteration. The repo still identifies Iteration 5 as the current path, so the new material is best described as an Iteration 5 continuation: behavioral parity was restored first, then the hosted product was hardened around identity, provider portability, AI execution, sandboxing, evidence quality, UX structure, and dogfooding.

The thesis story therefore changes slightly:

SpecLens did not stop at becoming a parity-restored hosted product. It continued into a harder research and engineering question: how to make the restored hosted product trustworthy, observable, reproducible, and safe enough to run AI-assisted repository analysis as a real SaaS workflow.

## Source Basis

This update is based on the original thesis foundation document plus the newer repo trail:

- `docs/thesis/ITERATIONS-001-005-thesis-foundation.md`
- `docs/adr/ADR-0006-keycloak-provider-registry-and-portable-dev-stack.md`
- `docs/issues/keycloak-provider-storage-dev-mode.md`
- `docs/issues/platform-long-task-queue.md`
- `docs/issues/hosted-web-route-map-ux-audit.md`
- `docs/issues/ai-agent-role-contract-hardening.md`
- `docs/issues/ai-playwright-execution-hardening.md`
- `docs/issues/job-execution-artifact-hardening.md`
- `docs/issues/unified-agent-job-sandboxing.md`
- `docs/issues/self-improvement-loop-skill.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/auth-and-access.md`
- `docs/architecture/job-execution.md`
- `docs/architecture/ai-agent-runtime.md`
- `docs/architecture/local-dev-stack.md`
- `docs/ops/production-readiness.md`
- current working-tree changes reviewed on 2026-04-28 around browser auth coverage, artifact handling, queue concurrency, and report evidence rendering

## Updated Executive Summary

The original five-iteration thesis story remains correct:

1. Iteration 1 proved the concept through a client-centered, browser-driven evidence pipeline.
2. Iteration 2 reduced external dependency risk by pivoting to deterministic TagTwo repository analysis.
3. Iteration 3 generalized the artifact into a reusable local product platform.
4. Iteration 4 turned the platform into a hosted SaaS scaffold with product, legal, billing, and deployment boundaries.
5. Iteration 5 restored the archived analysis breadth on the hosted TypeScript architecture through behavioral parity rather than rollback.

The new work adds a second half to Iteration 5. After parity recovery, the project focused on operational hardening. This means the latest artifact is not only "the hosted product with restored parity." It is now better described as:

A hosted, multi-user, spec-driven repository analysis SaaS with restored analysis breadth, agent-native execution, scoped identity and auth handling, portable provider infrastructure, durable queueing, one-shot Docker job sandboxes, contract-aware AI roles, run-scoped browser evidence, report/remediation workflows, and a repeatable self-improvement loop.

That is an important thesis-level change. Earlier iterations mostly asked what the artifact should do. The latest work asks whether the artifact can do it with enough isolation, observability, determinism, and operational realism to be credible as a hosted product.

## Updated Cross-Iteration Overview

| Iteration | Main problem | Primary design move | Artifact state after the original foundation | New interpretation after later additions |
|---|---|---|---|---|
| 1 | Spec-driven analysis needed proof on a real case | client-first browser and visual evidence pipeline | Case-specific proof of concept | Still the empirical baseline and archived evidence source |
| 2 | The proof depended too much on live client access | TagTwo-first deterministic repo analysis | Reproducible repository analyzer | Still the first reproducibility correction |
| 3 | The analyzer was still too profile-bound | Generic core, CLI, HTTP API, and managed workspace | Reusable local platform | Still the productization pivot |
| 4 | A local platform was not a hosted product | Hosted web/API/runner, persistence, billing, auth, and dual licensing | Hosted SaaS scaffold | Still the socio-technical product boundary |
| 5 | Hosted architecture had lost archived analysis breadth | Behavioral parity on the active TypeScript product | Parity-restored hosted product | Parity-restored and then hardened through provider portability, agent sandboxing, role contracts, artifact diagnostics, UX audit, and dogfooding |

The updated thesis phrasing should avoid presenting Iteration 5 as a single simple milestone. It is more accurate to treat it as a two-part cycle:

- Iteration 5A: restore behavioral breadth on the hosted TypeScript product.
- Iteration 5B: harden the restored hosted product so AI/browser execution is safer, more deterministic, more observable, and easier to operate.

This split is a thesis explanation only. It is not a new repo governance label.

## Additions Since The Foundation Overview

### 1. Keycloak, Provider Registry, Storage Portability, And Full Dev Mode

ADR-0006 adds an important architectural correction. The hosted product moved away from earlier Auth0-specific framing, single-path AI execution assumptions, and storage-provider coupling.

The active direction is now:

- Keycloak-first identity for hosted and local development.
- Generic identity subject fields instead of Auth0-specific naming.
- Ordered AI provider selection, including OpenAI and OpenAI Codex.
- S3-compatible object storage portability, with local MinIO as the default development target.
- A full Docker Compose stack for web, API, runner, AI worker, Postgres, Keycloak, and MinIO.

For the thesis, this strengthens the product-maturity story. Iteration 4 introduced the hosted SaaS boundary. The later work made that boundary less vendor-specific and more realistic for local, hosted, and self-hosted operations.

The most important claim is not just "Keycloak replaced Auth0." The stronger claim is:

SpecLens made portability a design requirement for identity, AI providers, and artifact storage, which reduces vendor lock-in and makes the hosted artifact easier to validate in realistic local infrastructure.

### 2. Scoped Codex Auth And Stricter Ownership Boundaries

The later hosted work also clarified where AI execution credentials live.

The active auth model now distinguishes:

- user-scoped Codex auth in `/portal/settings`
- workspace-scoped Codex auth and reusable run secrets in workspace settings
- global fallback Codex auth in `/portal/admin/ai/auth`
- per-run auth-scope selection on the runs surface

The authorization model was also hardened:

- only workspace owners may attach stored workspace secrets to new hosted analysis jobs
- remediation queueing is restricted to workspace owners
- admin AI privileges do not bypass workspace-owner checks for normal workspace mutations

For the thesis, this is a useful governance point. Once AI execution became part of the product, the artifact needed more than prompt design. It needed explicit credential ownership and authorization boundaries.

### 3. Portal IA And UX Route Audit

The hosted web route audit mapped the full `apps/web` route surface and diagnosed the product information architecture. It identified 22 navigable page routes and 6 support route handlers, then proposed an owner-first workspace journey.

The important route responsibility model is:

- public pages explain product, pricing, licensing, commercial rights, and trust terms
- `/portal/workspaces` is the signed-in home
- workspace routes own the operational journey: overview, sources, runs, reports, code, access, and settings
- admin AI routes are operator-only and should stay out of normal owner workflows
- auth, proxy, GitHub callback, and commercial-contact routes are support infrastructure, not user-facing IA

The thesis relevance is that the hosted artifact matured beyond backend architecture. The work recognized that a SaaS research artifact also needs coherent route ownership, user flow, and navigation structure. This supports a socio-technical interpretation of the artifact.

### 4. Production Backlog Closure And Durable Hosted Infrastructure

The platform long-task queue records substantial closure across the hosted product surface:

- PostgreSQL-backed `pg-boss` job lifecycle
- persistent logs and artifact metadata
- authenticated SSE log fanout
- runner and AI-worker separation
- object-storage-backed uploads and artifact references
- Keycloak-backed auth and user provisioning
- Stripe checkout/webhook handling
- GitHub App install, webhook, private repository, and resync flows
- hosted portal pages backed by real API data
- report rendering for screenshots, crawl evidence, artifacts, remediation, and exports
- health, readiness, metrics, backup, restore, retention, and operational checklists

This changes the result narrative. Iteration 4 was originally a hosted scaffold. The later work makes the hosted product path much closer to an end-to-end SaaS control plane with realistic operations.

The remaining caveat is that local and Compose validation are still the main repeatable gates. Live DigitalOcean verification, live provider credentials, and backup/restore drills remain separate production gates.

### 5. AI Agent Role Contract Hardening

The AI worker now gives seeded roles explicit output contracts. Role output is no longer treated as acceptable merely because a role produced any section.

The hardened model includes:

- canonical expected section titles for seeded roles
- required structured data keys
- prompt injection of each role contract
- canonicalization of obvious single-section outputs
- a `Role contract audit` report section
- role quality scoring based on contract readiness

For the thesis, this is a major step from "AI as flexible synthesis" toward "AI as contract-bound execution." It addresses a key risk in agentic systems: outputs can be fluent but structurally useless. SpecLens reduces that risk by making role readiness auditable.

This supports a discussion theme:

AI flexibility becomes usable in a product artifact only when it is constrained by explicit contracts, validation, and report-level audit evidence.

### 6. Playwright And Browser Execution Hardening

The hosted AI worker's Playwright path was made more deterministic.

The implemented hardening includes:

- detection of repo-native Playwright wrapper scripts
- repo-relative Playwright metadata in report sections
- cleanup of stale `playwright-report/` and `test-results/` before execution
- persistence of Playwright validation logs as hosted artifacts
- optional Playwright outputs treated as advisory rather than release-blocking

Current working-tree additions extend this browser evidence model further:

- redacted browser auth coverage summaries
- `auth-coverage` as an artifact kind
- protected-route counts, skipped-route counts, and auth confidence in browser QA sections
- report rendering for browser auth state, protected target coverage, page count, interaction count, and confidence
- filtering of sensitive storage-state artifacts so raw browser auth material is not mirrored into normal artifact references

The thesis should separate validated implemented work from current working-tree work if using this in a results chapter. The broad thesis point is still clear: browser realism introduces secret and evidence risks, so SpecLens is moving from raw browser output toward redacted, structured, auditable browser evidence.

### 7. Job Failure, Cancellation, And Artifact Diagnostics

The job execution path now preserves evidence even when AI-agent jobs fail or are cancelled.

The hardened behavior includes:

- replaying in-memory agent logs during finalization
- duplicate-safe DB log insertion
- stable failed role step ordering
- `agent-failure.json` as a runtime-log artifact for failed and cancelled jobs
- diagnostic data containing status, failure reason, execution steps, and logs

This is thesis-relevant because unsuccessful runs are still research and product evidence. A hosted analysis product cannot only explain successful reports. It must also make failed execution reviewable.

The contribution here is observability under failure, not just feature completion.

### 8. One-Shot Hosted Agent Sandboxing

The unified-agent job path was moved into a controller-plus-sandbox model.

The active shape is:

- `apps/ai-worker` remains the long-lived queue consumer and persistence controller
- each hosted agent job is executed inside a one-shot Docker sandbox
- source materialization, Codex role execution, shell commands, runtime startup, Playwright, browser evidence, remediation changeset generation, and local artifact capture happen inside the sandbox
- the sandbox writes a structured result bundle
- the controller mirrors reports, artifacts, logs, learnables, and changesets into durable product state

Local Compose and the single-node deploy now use a shared nested Docker daemon, `job-dind`, for runner and hosted agent sandboxes. The runner and AI worker no longer mount the host Docker socket.

For the thesis, this is one of the strongest later additions. It turns the hosted AI worker from a long-lived process that performs repo work into a controller that launches isolated, job-scoped execution environments. That is a clearer security and reproducibility boundary.

The strongest thesis claim is:

SpecLens handles AI-assisted repository analysis as sandboxed job execution, not as direct mutation or direct shell execution inside the product controller.

### 9. Self-Improvement Loop

A repo-local `speclens-self-improvement-loop` skill and helper script were added for dogfooding SpecLens on SpecLens itself.

The workflow can:

- create or reuse a workspace
- import workspace-scoped Codex auth
- upload a committed Git archive of the current repo
- queue hosted analysis or remediation jobs
- wait for completion
- download logs and artifacts
- review role, skill, tool, artifact, and Playwright execution quality

The helper also checks sandbox evidence and can fail the loop if expected sandbox launch/result evidence is missing.

This is important methodologically. It adds a self-referential evaluation loop: SpecLens is used as a target for SpecLens. That does not replace independent validation, but it gives the thesis a strong example of iterative artifact refinement through dogfooding.

The thesis should frame this carefully:

- Strength: the artifact can expose weaknesses in its own hosted analysis pipeline.
- Risk: self-evaluation can bias the artifact toward its own repo shape.
- Mitigation: keep downloaded logs, artifacts, and validation commands as explicit evidence.

### 10. Report And Remediation Decision Surface

The report detail route has grown into the main decision surface for a completed analysis:

- release-gate summary
- findings triage
- normalized sections
- artifact lists
- remediation launch/readiness
- changed-file links
- report export
- jumps into code and run detail

Current working-tree changes add browser evidence rendering and more stable test ids for remediation and capability gap inspection.

For the thesis, this matters because SpecLens is not only an execution engine. It is also a review product. The report page is where analysis evidence becomes an actionable decision: accept, investigate, export, remediate, or inspect code context.

### 11. Production Readiness And Operational Validation

The operations docs now define clearer production-facing controls:

- `npm run ops:validate` for live-service probing
- `npm run stack:validate` for Compose boot, Keycloak seed, ops validation, and hosted local E2E slices
- health/readiness checks
- metrics exposure
- queue/storage roundtrips
- webhook signature checks
- backup and restore procedures
- smoke checklist and incident runbooks

This reinforces the hosted SaaS claim. The artifact is no longer documented only as a codebase that can run tests. It now has an operator-facing validation model.

## Updated Evidence And Validation Trail

The original foundation document already recorded the main iteration validations up to 2026-04-19. The later additions add these evidence points:

| Date | Evidence | Meaning |
|---|---|---|
| 2026-04-20 | `STACK_VALIDATE_BUILD=0 STACK_VALIDATE_SHUTDOWN_STACK=1 npm run stack:validate` passed | Full local Compose stack, Keycloak, MinIO, worker services, and hosted E2E validation became a documented gate |
| 2026-04-23 | `npm run lint`, `node --import tsx --test tests/ai-worker.test.ts`, `npm run typecheck`, and `npm run build` passed for role contract hardening | AI role output contracts and contract audit behavior were validated |
| 2026-04-23 | `node --import tsx --test tests/ai-worker.test.ts`, `npm run typecheck`, and `npm run validate:local` passed for Playwright execution hardening | Browser/Playwright artifact behavior was validated |
| 2026-04-23 | `node --import tsx --test tests/ai-worker.test.ts` and `npm run validate:local` passed for job artifact hardening | Failure/cancellation diagnostics were covered |
| 2026-04-23 | self-improvement helper `--help` and `node --check` passed | Dogfood automation was syntactically and operationally prepared |
| 2026-04-24 | SpecLens self-audit baseline completed a 22-role standard browser job in 21m16s with 57 downloaded artifacts | The hosted agent runtime had a concrete self-audit evidence point |
| 2026-04-28 | current working tree adds browser auth coverage summaries, sensitive artifact filtering, object-key preservation, queue concurrency fixes, and report-side auth evidence rendering | Useful current implementation evidence, but should be treated as uncommitted until validated and committed |

For the thesis results chapter, use committed validation dates as hard evidence. Use the 2026-04-28 working-tree additions as "current implementation work" unless they are validated and committed before thesis submission.

## Updated Thesis Interpretation

### From Capability Recovery To Runtime Trust

The original Iteration 5 thesis claim was that SpecLens restored archived capability breadth without reviving the old runtime.

The updated claim is stronger:

SpecLens restored archived capability breadth and then hardened the hosted execution model so the restored behavior could run through scoped credentials, durable queues, observable logs, one-shot sandboxes, structured artifacts, and contract-aware AI roles.

This moves the discussion from pure modernization into runtime trust.

### From AI Output To AI Accountability

The later work makes AI output accountable in several ways:

- role contracts define what each role must produce
- report sections record contract audit results
- quality scoring checks contract readiness
- Playwright logs and artifacts are persisted
- failed and cancelled jobs produce diagnostic artifacts
- self-improvement runs download evidence for review

The thesis can argue that agentic analysis systems need accountability surfaces, not just generated text.

### From Browser Evidence To Safe Browser Evidence

Browser execution is powerful but risky because it involves secrets, storage state, protected routes, and potentially sensitive screenshots or traces.

The newer direction is to keep browser evidence useful while reducing unsafe leakage:

- use credential/session secrets through scoped workspace controls
- produce redacted auth coverage summaries
- classify browser auth coverage as an artifact kind
- filter sensitive storage-state files from normal artifact references
- report protected-route coverage without exposing raw cookies or local storage

This adds a nuanced discussion point: realism and safety are not opposites if the product turns raw execution into structured, redacted evidence.

### From Product Scaffold To Operable SaaS

Iteration 4 made the architecture hosted. The later work makes the hosted system more operable:

- Keycloak and MinIO in local Compose
- `pg-boss` queue ownership
- health/readiness/metrics
- stack validation
- backup and restore scripts
- incident and production checklists
- DigitalOcean single-node deployment shape

This supports the argument that a SaaS thesis artifact must include operation and validation, not only application features.

### From External Evaluation To Dogfooding

The self-improvement loop adds a practical feedback mechanism. It is not a replacement for external evaluation, but it helps test the artifact on a large real target with known expectations: its own codebase.

The thesis can present this as an additional design-science feedback loop:

1. run SpecLens on SpecLens
2. collect logs and artifacts
3. identify role, sandbox, Playwright, or artifact weaknesses
4. implement hardening
5. rerun and compare evidence

## Updated Discussion Themes

### AI Flexibility vs Contract Determinism

SpecLens uses AI roles because repository analysis benefits from synthesis, judgment, and broad code reading. But the later hardening shows that this flexibility must be constrained. Role contracts, schema expectations, and audit sections are the mechanism that turns flexible agent output into reviewable product data.

### Browser Realism vs Secret Safety

Iteration 5 recovered browser-heavy behavior. The continuation work shows the cost of that realism: protected route coverage needs credentials or session state, and browser storage artifacts can be sensitive. Redacted auth coverage summaries are the product answer to this tension.

### Sandbox Isolation vs Operational Complexity

One-shot Docker sandboxes improve isolation and reproducibility, but they add image management, nested Docker, network, timeout, and artifact collection complexity. This is a strong tradeoff for the discussion chapter because it shows why hosted AI execution is more than queue processing.

### Local Validation vs Production Certainty

The local Compose and stack validation paths are much stronger than the original scaffold. However, live provider credentials, live DigitalOcean verification, and backup/restore drills remain distinct evidence. The thesis should be precise: local validation supports product readiness, but it is not the same as full production proof.

### Dogfooding vs Independent Evaluation

Dogfooding is valuable because it exercises the product on a real, complex repo. It is also biased because the product and target share assumptions. The best thesis framing is to treat dogfooding as one evaluation layer, alongside validation commands, E2E tests, issue docs, and external production checks.

## Updated Chapter Mapping

### Method Chapter

Add a subsection after the five iteration overview called "Iteration 5 continuation: hardening after parity." Explain that the same design-science cycle continued inside the current iteration:

- parity restoration exposed runtime trust issues
- the design response was provider portability, scoped auth, sandboxing, role contracts, and artifact diagnostics
- evaluation moved from static validation into stack validation and self-dogfooding

### Artifact Chapter

Add the following artifact elements to the latest SpecLens description:

- Keycloak-first identity
- ordered AI provider registry
- S3-compatible storage portability
- full local Compose stack
- unified-agent queue ownership by `apps/ai-worker`
- one-shot hosted agent sandbox image
- role output contracts and role contract audit
- Playwright wrapper detection and validation artifacts
- failure/cancellation diagnostic artifacts
- self-improvement loop skill and helper
- report decision surface for release gate, findings, artifacts, and remediation

### Results Chapter

Extend the results beyond the 2026-04-19 parity validation:

- 2026-04-20 stack validation passed
- 2026-04-23 AI role contract tests and validation passed
- 2026-04-23 Playwright execution hardening tests and validation passed
- 2026-04-23 failure diagnostic tests and validation passed
- 2026-04-23 self-improvement helper checks passed
- 2026-04-24 self-audit baseline completed with 22 roles, 21m16s runtime, and 57 artifacts

### Discussion Chapter

Add these new discussion threads:

- AI output needs explicit contracts to become product evidence.
- Browser realism must be balanced with secret handling and redacted evidence.
- Sandboxed hosted execution improves trust but increases operational complexity.
- A local realistic stack is an important intermediate validation layer.
- Dogfooding is useful but should be framed as complementary evidence.

### Conclusion Chapter

Update the final contribution claim:

SpecLens evolved from a case-specific visual analysis proof of concept into a hosted, multi-user, spec-driven analysis SaaS that not only restores legacy analysis breadth, but also wraps AI/browser execution in scoped identity, durable queues, sandbox isolation, contract-aware reporting, operational validation, and a self-improvement loop.

## Updated Candidate Research Question

The current thesis could use a research question like:

How can a spec-driven repository analysis artifact evolve from a case-specific browser pipeline into a hosted SaaS while preserving behavioral breadth, supporting AI-assisted execution, and maintaining reproducible, observable, and sandboxed analysis workflows?

This question fits all five iterations and the later hardening work.

## Updated Candidate Contribution Claim

A concise final contribution claim:

The contribution of SpecLens is a documented, iterative transformation of a spec-driven analysis prototype into a hosted SaaS artifact that integrates repository analysis, AI role execution, browser evidence, remediation workflows, product governance, and operational safeguards into one traceable product architecture.

## Current Limitations To Preserve In The Thesis

The updated thesis should still be honest about remaining limits:

- live production verification is separate from local and Compose validation
- provider-backed runs depend on real Keycloak, Stripe, GitHub, object storage, and AI credentials
- one-shot sandboxing adds operational complexity and requires ongoing timeout, image, and network hardening
- slow AI roles still need performance tuning before increasing concurrency too aggressively
- portal IA cleanup has documented remaining P1/P2 polish items
- current working-tree browser auth coverage additions should be validated and committed before being used as final results evidence
- dogfooding helps reveal issues but does not replace independent evaluation

## Final Updated Takeaway

The original foundation document showed that SpecLens had a coherent five-iteration design trajectory. The later work makes that trajectory more convincing because it shows what happened after the main parity goal was reached.

SpecLens did not merely restore old behavior and stop. It began hardening the conditions under which restored behavior can be trusted: identity became portable, AI providers became ordered, auth became scoped, role outputs became contract-aware, browser evidence became more structured, failed jobs became diagnosable, repository work moved into one-shot sandboxes, and the product gained a self-improvement loop.

That is the strongest updated thesis story: SpecLens is not only a feature migration from an old local tool into a hosted product. It is an iterative construction of a trustworthy hosted analysis system, where each phase changes the artifact boundary and makes the next reliability problem visible.
