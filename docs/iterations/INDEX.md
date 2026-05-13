# Iteration Index

SpecLens uses milestone-based Design Science iterations.

## Current

| Iteration | Status | Focus | Key docs |
|---|---|---|---|
| Iteration 5 | Current | Behavioral parity migration on the hosted TypeScript product | `docs/iterations/ITERATION-005-behavioral-parity-migration.md`, `docs/adr/ADR-0005-behavioral-parity-on-hosted-typescript-architecture.md` |

## History

| Iteration | Status | Focus | Key docs |
|---|---|---|---|
| Iteration 4 | Archived transition | Hosted SaaS, runner plane, pricing/legal product surface, and dual licensing | `docs/iterations/ITERATION-004-hosted-saas.md` |
| Iteration 3 | Archived transition | Generic productization, managed workspace runtime, and public JS/HTTP APIs | `docs/iterations/ITERATION-003-generic-productization.md` |
| Iteration 2 | Archived transition | TagTwo-first repo analysis and deterministic checks | `docs/archive/iteration-2-architecture.md`, `docs/archive/iteration-2-evaluation.md` |
| Iteration 1 | Archived baseline | client-first visual and browser-driven pipeline | `docs/archive/iteration-1-baseline.md` |

## Cross-Iteration Synthesis

- `docs/thesis/ITERATIONS-001-005-thesis-foundation.md` consolidates all five iterations into one thesis-oriented narrative covering method, artifact evolution, results, discussion themes, and conclusion claims.
- `docs/thesis/ITERATIONS-001-005-thesis-update-2026-04-28.md` extends the foundation narrative with the Iteration 5 continuation work around hosted parity hardening, provider portability, agent sandboxing, AI role contracts, artifact diagnostics, UX audit, operations, and dogfooding.

## Conventions

- Use one iteration doc per milestone or Design Science cycle.
- Keep iteration docs outcome-oriented: problem, objectives, design, demonstration, evaluation, reflection.
- Link issue docs and ADRs back to the owning iteration.
- When a cycle completes, keep its doc as evidence and start the next iteration with a new doc.

## Next docs

- Use `docs/iterations/ITERATION-000-template.md` when starting a new milestone.
