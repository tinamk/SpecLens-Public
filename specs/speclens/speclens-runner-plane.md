# SpecLens Runner Plane

## Goal

Define the retained isolated runner-plane shape for Iteration 5 while hosted AI jobs execute through the `unified-agent` sandbox path.

## Scope (IN)

- queued runner process retained for runner-plane compatibility and sandbox validation
- Docker sandbox execution model
- artifact handoff expectations
- shared nested Docker daemon expectations used by both runner and hosted agent sandboxes

## Scope (OUT)

- App Platform control plane

## Definitions (Source of truth)

- **Runner plane**: `apps/runner`
- **Active hosted AI path**: `executionPath: "unified-agent"` jobs claimed by `apps/ai-worker` and executed inside one-shot hosted agent sandboxes.

## Rules

### R1 - Separation
1. The runner plane must remain separate from the web/API control plane.
2. The runner plane must preserve a Docker sandbox execution model.
3. The system must support queued job claiming semantics even when local validation uses an in-process queue fallback.
4. Normal hosted audit and remediation submissions must not be routed through the runner queue; they use `ai-agent-jobs` and the hosted agent sandbox controller.

## Acceptance checks
1. A dedicated runner process exists in `apps/runner`.
2. The runner plane has container-image scaffolding.
3. The hosted product can validate queued job execution semantics without requiring the archived runtime.
4. Local and single-node deployments keep runner and hosted-agent sandbox images seeded in the shared nested Docker daemon without mounting the host Docker socket.
