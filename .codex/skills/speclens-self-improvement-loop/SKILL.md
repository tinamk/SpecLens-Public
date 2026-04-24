---
name: speclens-self-improvement-loop
description: Use this skill when dogfooding SpecLens on the SpecLens repo itself. It creates or reuses a local workspace, imports workspace-scoped Codex auth, uploads a committed Git archive of the repo, runs hosted analysis or remediation jobs, downloads logs and artifacts, and focuses review on role, skill, tool, and Playwright execution quality.
---

# SpecLens Self-Improvement Loop

## Overview

Use this skill for the local dogfooding loop where SpecLens audits and improves the SpecLens repo itself.

The main target is execution quality, not generic product commentary. Prefer findings tied to:

- role determinism and contract drift
- skill/tool misuse or missing capability disclosure
- artifact completeness and run-scoped evidence
- auth binding failures or brittle setup
- browser execution reliability
- Playwright preflight, execution, and report capture

The default path assumes the hosted stack is running locally and `API_AUTH_MODE=local-dev` is enabled so the helper script can talk to the API without a browser login flow.

Hosted dogfood jobs must use the controller-plus-sandbox path:

- `ai-worker` claims and finalizes jobs only.
- repo materialization, Codex, runtime startup, shell commands, and Playwright run inside a one-shot hosted agent Docker sandbox.
- local and single-node stacks route both `ai-worker` and `runner` through `job-dind`; neither should mount `/var/run/docker.sock`.
- sandbox launch failures are job failures, not a reason to fall back to direct role execution in `ai-worker`.

## Commands

### Prepare the local sandbox stack

Before queueing a cycle, make sure the hosted stack is running with the nested Docker daemon and seeded sandbox images:

```bash
docker compose up -d --build caddy web api runner ai-worker
```

The compose dependencies start `job-dind` and run both image seeders:

- `runner-sandbox-image-init` seeds `speclens/analysis-runner:local`.
- `ai-agent-sandbox-image-init` seeds `speclens/ai-agent-sandbox:local`.

The helper runs this preflight by default before queueing:

- compose config contains `job-dind`, `DOCKER_HOST=tcp://job-dind:2375`, and the hosted agent sandbox image
- compose config does not mount `/var/run/docker.sock`
- `job-dind`, `api`, and `ai-worker` are running
- the nested daemon contains both runner and hosted agent sandbox images

Only skip this with `--no-sandbox-preflight` when intentionally targeting a separately verified stack.

### Queue an analysis cycle

The default analysis cycle runs `agent-universal-standard`. That is the release-grade profile with 22 roles. Hosted execution now schedules those roles as a dependency graph inside the job sandbox, using `AI_WORKER_ROLE_MAX_CONCURRENCY` to run independent roles concurrently while preserving deterministic report order.

Default local and single-node stacks use:

```bash
AI_WORKER_ROLE_MAX_CONCURRENCY=4
```

Increase this only when Codex quota, CPU, memory, and sandbox runtime capacity can handle more parallel role processes. Runtime/browser/Playwright roles are still serialized with synthetic graph edges to avoid port, dev-server, and artifact races.

On the April 24, 2026 full SpecLens dogfood run (`job_a5b95d9d-83fe-4b8f-b11f-2e7e215da0c8`), the 22-role standard browser job completed successfully in 21m16s at concurrency 4. It produced ready sandbox evidence, 57 downloaded artifacts, successful runtime execution, successful direct browser QA, and successful safe Playwright verification via `npm run e2e:hosted:local -- --list`. The deterministic native `artifact-auditor` completed in 1s, down from the prior 3m59s Codex baseline. The measured slow roles were `remediation-planner` (3m45s), `navigation-qa-planner` (3m30s), `ux-friction-reviewer` (3m24s), `component-cartographer` (3m15s), and `code-health-reviewer` (3m12s).

The same pass exposed and fixed two runtime issues:

- Final standardized handoff must run a safe Playwright verification command, not the first full-suite command proposed by a role.
- Shell command timeouts must kill the whole process group so orphaned Playwright descendants cannot hold stdout open after the wrapper exits.

For fast runtime/tooling work, prefer:

```bash
node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs analyze \
  --profile runtime-fast \
  --runtime-mode browser \
  --codex-scope workspace \
  --ref HEAD
```

This uses the internal `agent-e2e-runtime-tooling-fast`, which keeps the hosted sandbox, source materialization, runtime discovery, browser execution, Playwright operator, artifact audit, and standardized JSON handoff, but skips broad architecture, UX, copy, dependency, and remediation reviewer roles. On the April 24, 2026 SpecLens dogfood run it completed the role phase in about 15.5 minutes instead of the prior 45-minute standard profile.

For a full release-grade audit, run:

```bash
node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs analyze
```

Useful overrides:

```bash
node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs analyze \
  --workspace-name "SpecLens self-improvement" \
  --profile standard \
  --agent-id agent-universal-standard \
  --runtime-mode browser \
  --codex-scope workspace \
  --ref HEAD
```

What it does:

1. Reuse or create the workspace.
2. Import workspace Codex auth from the local `auth.json` if needed.
3. Create a committed Git archive from the chosen ref.
4. Upload the archive as a workspace source.
5. Queue the hosted analysis job.
6. Wait for completion by default.
7. Download logs, report payloads, sandbox evidence, and job artifacts into `.speclens-workspace/self-improvement/`.
8. Fail the cycle if sandbox launch/result evidence is missing unless `--no-strict-sandbox-evidence` is passed.

If local API restarts or the helper loses its polling connection after queueing, collect the completed job evidence without creating a new job:

```bash
node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs collect \
  --job-id job_<id>
```

### Queue a remediation cycle from a prior analysis summary

Run:

```bash
node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs remediate \
  --analysis-summary .speclens-workspace/self-improvement/analysis-<job-id>/summary.json
```

Useful overrides:

```bash
node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs remediate \
  --analysis-summary .speclens-workspace/self-improvement/analysis-<job-id>/summary.json \
  --max-iterations 1 \
  --selection-mode auto-priority \
  --output-mode changeset
```

The remediation helper queues a bounded hosted changeset run and downloads its artifacts, including the patch bundle when one is generated.

## Review Focus

After an analysis run, inspect the downloaded evidence before deciding whether to remediate or apply anything.

Prioritize:

- `sandbox-evidence.json`, especially missing launch, wait, result-collection, stdout, or artifact evidence
- execution logs with warnings or retries in `agent`, `runner`, `sandbox`, `browser`, `auth`, or `artifact` scopes
- report sections such as `Role contract audit`, `Runtime execution`, `Browser QA execution`, `Playwright preflight`, and artifact analysis
- missing or low-quality artifacts for browser and Playwright roles
- changes that improve determinism, cleanup stale outputs, preserve repo-relative paths, or make auth/tooling behavior explicit

Treat generic UI, copy, or product suggestions as secondary unless they expose a tooling failure or a broken audit path.

## Apply Gate

Do not apply a remediation output just because it exists.

Only apply a downloaded changeset after checking:

- the parent analysis report is high quality and grounded in real evidence
- the remediation job finished successfully
- the generated `changeset-manifest.json` and `patch-bundle.diff` stay within the intended scope
- the validation commands in the changeset are sensible for this repo

Typical local check:

```bash
git apply --check <downloaded-patch-bundle.diff>
```

If the patch is acceptable, apply it explicitly and then rerun the loop.

## Notes

- The upload path accepts Git repository archives, so the helper audits committed refs such as `HEAD`. If you want the loop to include new local changes, commit them first or be explicit that the current cycle is evaluating the last committed state.
- If workspace auth import fails because no local Codex auth file exists, resolve that first with local Codex login and rerun the helper.
- Prefer the helper script over ad hoc API calls so cycle output lands in a deterministic local evidence directory.
- Treat a successful job without sandbox evidence as a tooling failure. Hosted job quality is not acceptable unless the artifacts prove the run entered the Docker sandbox.

## Relevant Files

- `apps/ai-worker/src/services/worker.ts`
- `apps/ai-worker/src/services/sandbox.ts`
- `apps/ai-worker/docker/agent-sandbox.Dockerfile`
- `docker-compose.yml`
- `deploy/digitalocean/docker-compose.single-node.yml`
- `packages/db/src/repositories.ts`
- `packages/contracts/src/index.ts`
- `tests/ai-worker.test.ts`
- `tests/api.test.ts`
- `tests/docker-sandboxing.test.ts`
- `docs/architecture/ai-agent-runtime.md`
