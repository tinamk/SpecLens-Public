import assert from "node:assert/strict";
import test from "node:test";
import {
  agentSandboxRequestSchema,
  agentSandboxResultSchema,
  type AgentSandboxRequest,
  type JobEnvelope,
} from "@speclens/contracts";

const now = "2026-04-23T00:00:00.000Z";

function buildRequest(): AgentSandboxRequest {
  return agentSandboxRequestSchema.parse({
    schemaVersion: "speclens.agent-sandbox.v1",
    execution: {
      job: {
        id: "job_sandbox_contract",
        workspaceId: "workspace_1",
        sourceId: "source_1",
        status: "running",
        sourceType: "git-public",
        sourceLocation: "https://github.com/example/repo.git",
        roles: ["runtime-scout"],
        runtimeMode: "browser",
        secretRefs: ["secret_1"],
        requestedByUserId: "user_1",
        createdAt: now,
      },
      workspace: {
        id: "workspace_1",
        ownerUserId: "user_1",
        name: "Workspace",
        slug: "workspace",
        entitlement: "free",
        createdAt: now,
        updatedAt: now,
      },
      source: {
        id: "source_1",
        workspaceId: "workspace_1",
        type: "git-public",
        displayName: "Repo",
        location: "https://github.com/example/repo.git",
        visibility: "public",
        verificationStatus: "verified",
        verificationError: null,
        githubInstallationId: null,
        uploadObjectKey: null,
        createdAt: now,
      },
      metadata: {
        codexAuth: {
          scope: "workspace",
          recordId: "workspace_1",
        },
      },
      secrets: [{
        id: "secret_1",
        kind: "credential-pair",
        name: "Demo Login",
        value: "{\"username\":\"demo\",\"password\":\"secret\"}",
      }],
      plan: {
        agent: {
          id: "agent_1",
          name: "Agent",
          description: null,
        },
        roles: [{
          id: "runtime-scout",
          name: "Runtime scout",
          description: null,
          prompt: "Inspect runtime.",
          order: 0,
          consoleVisibility: "normal",
          executorKind: "codex",
          nativeExecutorId: null,
          dependsOnRoleIds: [],
          skills: [{
            id: "skill_1",
            name: "Runtime Skill",
            instructions: "Prefer deterministic commands.",
            toolCapabilities: ["repo-read", "shell-exec"],
            order: 0,
          }],
        }],
      },
      roleDefinitions: [{
        id: "runtime-scout",
        title: "Runtime scout",
        description: "",
        order: 0,
        dependsOnRoleIds: [],
        skills: [{ id: "skill_1", name: "Runtime Skill" }],
      }],
      learnables: [{
        id: "learnable_1",
        workspaceId: "workspace_1",
        sourceId: "source_1",
        statement: "Use npm for this repo.",
        category: "runtime",
        evidence: ["package-lock.json"],
        learnedFromJobId: "job_previous",
        order: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      }],
      codexAuthPath: "/speclens-agent-run/codex/auth.json",
      outputRoot: "/speclens-agent-run",
      timeoutMs: 1800000,
    },
  });
}

test("agent sandbox request/result schemas preserve immutable hosted execution inputs", () => {
  const request = buildRequest();
  assert.equal(request.execution.job.executionPath, "unified-agent");
  assert.equal(request.execution.secrets[0]?.name, "Demo Login");
  assert.equal(request.execution.plan.roles[0]?.skills[0]?.toolCapabilities.includes("shell-exec"), true);
  assert.equal(request.execution.learnables[0]?.statement, "Use npm for this repo.");

  const envelope: JobEnvelope = {
    job: {
      ...request.execution.job,
      status: "succeeded",
      reportId: "report_1",
      finishedAt: now,
    },
    logs: [],
    report: null,
    artifacts: [],
    timing: {
      queueDurationMs: null,
      runDurationMs: 10,
      totalDurationMs: 10,
      elapsedMs: 10,
      estimatedTotalMs: 10,
      estimatedRemainingMs: 0,
      confidence: "high",
      basis: "test",
    },
    qualityScorecard: null,
    capabilityGaps: [],
    artifactAnalysis: null,
    executionSteps: [],
  };
  const result = agentSandboxResultSchema.parse({
    schemaVersion: "speclens.agent-sandbox-result.v1",
    status: "succeeded",
    failureReason: null,
    envelope,
    learnables: request.execution.learnables,
  });
  assert.equal(result.envelope.job.executionPath, "unified-agent");
  assert.equal(result.learnables.length, 1);
});

test("ai-worker config exposes hosted sandbox orchestration settings", async () => {
  const originalEnv = { ...process.env };
  process.env.DOCKER_HOST = "tcp://job-dind:2375";
  process.env.AI_WORKER_SANDBOX_IMAGE = "speclens/ai-agent-sandbox:test";
  process.env.AI_WORKER_SANDBOX_NETWORK = "host";
  process.env.AI_WORKER_SANDBOX_TIMEOUT_MS = "12345";
  process.env.AI_WORKER_SANDBOX_OBJECT_STORAGE_ENDPOINT = "http://minio:9000";
  process.env.AI_WORKER_ROLE_MAX_CONCURRENCY = "6";

  try {
    const { loadAiWorkerConfig } = await import("../apps/ai-worker/src/services/config");
    const config = loadAiWorkerConfig();
    assert.equal(config.dockerHost, "tcp://job-dind:2375");
    assert.equal(config.sandboxImage, "speclens/ai-agent-sandbox:test");
    assert.equal(config.sandboxNetwork, "host");
    assert.equal(config.sandboxTimeoutMs, 12345);
    assert.equal(config.sandboxObjectStorageEndpoint, "http://minio:9000");
    assert.equal(config.roleMaxConcurrency, 6);
  } finally {
    process.env = originalEnv;
  }
});
