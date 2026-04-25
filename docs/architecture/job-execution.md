# Job Execution

SpecLens uses durable queued job execution backed by PostgreSQL and `pg-boss`.

## Core Flow

```mermaid
flowchart TD
  User[Portal/API user]
  Api[apps/api]
  Repo[(Source + Job rows)]
  Dispatch[Queue dispatch loop]
  PgBoss[(pg-boss queues)]
  Runner[apps/runner]
  AiWorker[apps/ai-worker controller]
  AgentSandbox[agent job sandbox]
  ResultBundle[(mounted result bundle)]
  Report[(AnalysisReport)]
  Logs[(AnalysisJobLog)]

  User --> Api
  Api --> Repo
  Api --> Dispatch
  Dispatch --> PgBoss
  PgBoss --> Runner
  PgBoss --> AiWorker
  AiWorker --> AgentSandbox
  AgentSandbox --> ResultBundle
  ResultBundle --> AiWorker
  Runner --> Repo
  Runner --> Logs
  AiWorker --> Logs
  Runner --> Report
  AiWorker --> Report
```

## Queue Ownership

| Engine | Queue | Worker |
|---|---|---|
| active hosted AI jobs | `ai-agent-jobs` | `apps/ai-worker` controller plus one-shot sandbox |
| retained runner-plane compatibility | `analysis-jobs` | `apps/runner` |

The normal hosted product path resolves every audit and remediation job to `executionPath: "unified-agent"`.
The API dispatch loop therefore publishes active hosted jobs to `ai-agent-jobs`.
The runner queue and `apps/runner` remain part of the repository because the runner-plane sandbox and image seeding are still validated, but they are not the primary execution owner for normal hosted AI submissions.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> queued: queue publish succeeds
  queued --> running: worker claims job
  running --> succeeded
  running --> failed
  running --> cancelled
  pending --> failed: dispatch failure exhausted
  queued --> cancelled: cancellation requested before execution
```

## Dispatch Separation

The API does not execute long-running analysis inline.

Instead it:

1. creates `AnalysisJob`
2. persists source/job metadata, including an optional companion source
3. leases the job for dispatch
4. publishes a queue message containing `jobId`
5. lets the correct worker claim and execute it

For unified-agent hosted jobs, execution now has controller and sandbox phases:

1. `apps/ai-worker` claims the queued job, resolves the agent plan, stages auth, starts the job sandbox, streams logs, and finalizes durable state.
2. The one-shot hosted agent sandbox materializes source, runs Codex/native roles, starts runtime processes, runs Playwright/browser checks, writes artifacts, and emits a result bundle under the mounted output root.
3. The sandbox does not normally read or mutate job state in the database; the controller mirrors the result bundle into logs, reports, and artifact references.

For universal audit bundles, the persisted report also includes:

- categorized findings across code, dependency, license, auth, UX, visual, accessibility, copy, navigation, consistency, artifact, docs, and ops domains
- execution coverage describing attempted and skipped runtime/browser steps
- remediation packs grouped for downstream fix execution
- an artifact audit against expected report and browser outputs
- a release-gate decision with confidence and blocking findings

If an AI-agent job fails or is cancelled before a report is available, the sandbox writes `agent-failure.json` into the mounted output root and the controller mirrors it as a `runtime-log` artifact. The diagnostic artifact contains the status, failure reason, execution steps, and logs needed to review the interrupted role chain.

## Paired Sources

A job still has one primary `sourceId`, but it can also persist one optional companion source.

When a companion source is present:

- workers materialize both inputs
- SpecLens builds a combined temp workspace
- the primary input is mounted under `primary/`
- the companion input is mounted under `companion/`

This supports cases like:

- public Git repository + private GitHub repository
- uploaded Git archive + public Git repository
- uploaded Git archive + supporting private GitHub repository

## Why This Matters

- browser/API latency stays low
- retry and cancellation state are persisted
- core and agent execution can scale independently
- queue transport is durable because `pg-boss` state lives in PostgreSQL
- agent jobs can now produce concrete runtime and browser evidence instead of stopping at planning-only output

## Persistence Interfaces

The queue message is intentionally small.

- transport payload: usually just `{ jobId }`
- business state: `AnalysisJob`, `AnalysisJobLog`, `AnalysisReport`, `ArtifactReference`

## Cancellation And Retry

- jobs can be marked for cancellation in persistent state
- dispatch failures record attempt counts and next retry timestamps
- workers append logs during execution so the portal can stream or poll live status

## Related Files

- `packages/db/src/queue.ts`
- `packages/db/src/repositories.ts`
- `apps/api/src/routes/durable.ts`
- `apps/runner/src/services/runner.ts`
- `apps/ai-worker/src/services/worker.ts`
