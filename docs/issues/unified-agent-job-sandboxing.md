# Unified Agent Job Sandboxing

## Summary

Hosted `unified-agent` jobs now use a controller-plus-sandbox execution model.

`apps/ai-worker` remains the queue consumer and persistence controller. It claims the job, resolves the agent plan, stages auth, builds an immutable sandbox request, launches a one-shot Docker container, streams sandbox logs, collects `result.json`, mirrors artifacts, stores learnables or changesets, and finalizes the durable job.

All repository work now runs inside the job sandbox:

- source materialization
- Codex role execution
- shell and validation commands
- runtime/app startup
- Playwright/browser execution
- remediation changeset generation
- local artifact capture

## What Changed

### Internal sandbox contracts

- `packages/contracts/src/index.ts`

Added internal-only schemas for:

- `agentSandboxRequestSchema`
- `agentSandboxResultSchema`
- `agentSandboxExecutionSnapshotSchema`
- resolved agent plan snapshots
- persisted job metadata snapshots

The request captures the claimed job, workspace/source metadata, resolved role and skill data, secrets, learnables, staged Codex auth path, output root, and timeout policy. The sandbox writes a structured result bundle instead of mutating job state directly.

### AI worker controller and sandbox entrypoint

- `apps/ai-worker/src/services/worker.ts`
- `apps/ai-worker/src/services/sandbox.ts`
- `apps/ai-worker/src/services/config.ts`

The queued hosted job path now calls Docker instead of running roles in the long-lived worker container. The old audit and remediation logic was moved behind a reusable execution core that can run with a file-backed sandbox log/result sink.

The controller has no in-process fallback for queued hosted jobs. If sandbox launch, timeout, cancellation, result collection, or finalization fails, the durable job fails through the controller.

### Dedicated hosted agent sandbox image

- `apps/ai-worker/docker/agent-sandbox.Dockerfile`
- `docker/install-codex-runtime.sh`
- `docker/install-playwright-chromium.sh`

The hosted agent sandbox is a one-shot image separate from the long-lived `ai-worker` service image. It includes pinned Codex plus the explicit platform package, Playwright Chromium, Docker CLI support, and the TypeScript sandbox entrypoint.

The runner and hosted agent sandbox images share the Codex and Playwright install scripts to keep browser/Codex behavior aligned.

### Shared nested Docker daemon

- `docker-compose.yml`
- `deploy/digitalocean/docker-compose.single-node.yml`
- `deploy/digitalocean/runner-bootstrap.sh`

Local compose and the single-node deploy now use `job-dind` as the shared nested Docker daemon for both runner and hosted agent job containers.

Neither `runner` nor `ai-worker` mounts `/var/run/docker.sock`. The standalone runner bootstrap also starts a dedicated DIND container and points the runner at that daemon.

## Operational Notes

- Hosted jobs still use `executionPath: "unified-agent"` and the existing `ai-agent-jobs` queue.
- `AI_WORKER_SANDBOX_IMAGE` defaults to `speclens/ai-agent-sandbox:local`.
- `AI_WORKER_SANDBOX_NETWORK=host` is used in compose so the sandbox can reach MinIO and the nested Docker daemon from inside the DIND network namespace.
- `AI_WORKER_CODEX_BYPASS_SANDBOX=true` and `SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS=true` are injected only into the job sandbox process.

## Validation

Targeted regression coverage:

- sandbox request/result schema parsing
- AI worker sandbox config parsing
- local compose nested Docker wiring
- single-node compose nested Docker wiring
- standalone runner bootstrap no longer mounting the host socket
- shared Codex/Playwright Docker install scripts
