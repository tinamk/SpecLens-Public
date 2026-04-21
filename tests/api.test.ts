import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { createHomeTempDirSync } from "@speclens/core";
import {
  appendAnalysisJobLogs,
  createAgentJobForUser,
  createAiAgent,
  createWorkspaceForUser,
  disconnectDatabase,
  getPrismaClient,
  listAiAgents,
  replaceSourceLearnables,
} from "@speclens/db";
import { createSourceForUserForTests } from "../packages/db/src/testing";
import { installApiTestEnv } from "./helpers/api-test-env";
import {
  authenticatedInject,
  ensureAuthenticatedPortalUser,
  makePortalSessionCookie,
} from "./helpers/portal-auth";
import {
  createTestDatabaseName,
  ensureRunnerSandboxImage,
  preparePrismaTestDatabase,
  stopHostedTestRuntime,
} from "./helpers/hosted-runtime";
import { createCommittedGitArchiveFixture, createCommittedGitFixture } from "./helpers/git-fixtures";

const fixturePath = createCommittedGitFixture(path.join(process.cwd(), "fixtures", "tagtwo-mini"), "speclens-api-static-repo-");
const browserFixturePath = createCommittedGitFixture(path.join(process.cwd(), "fixtures", "browser-parity-app"), "speclens-api-browser-repo-");
const fixtureArchivePath = createCommittedGitArchiveFixture(path.join(process.cwd(), "fixtures", "tagtwo-mini"), "speclens-api-static-archive-").archivePath;
const browserFixtureArchivePath = createCommittedGitArchiveFixture(path.join(process.cwd(), "fixtures", "browser-parity-app"), "speclens-api-browser-archive-").archivePath;
const fixtureUrl = pathToFileURL(fixturePath).toString();
const browserFixtureUrl = pathToFileURL(browserFixturePath).toString();
const defaultStripeWebhookSecret = "whsec_speclens_test";
const defaultGithubWebhookSecret = "github_webhook_secret_test";
const workspaceMemberCookie = makePortalSessionCookie({
  provider: "local-dev",
  subject: "local-dev-member",
  email: "workspace-member@speclens.test",
  displayName: "Workspace Member",
});

async function postStripeWebhook(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  event: Record<string, unknown>,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || defaultStripeWebhookSecret,
): Promise<unknown> {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  return await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/stripe",
    payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
  });
}

async function postCheckoutCompletedWebhook(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  sessionId: string,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || defaultStripeWebhookSecret,
): Promise<unknown> {
  return await postStripeWebhook(app, {
    id: `evt_${sessionId}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        metadata: {},
        subscription: `sub_${sessionId}`,
      },
    },
  }, webhookSecret);
}

async function postGithubInstallationWebhook(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  payload: Record<string, unknown>,
  webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET || defaultGithubWebhookSecret,
): Promise<unknown> {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;
  return await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/github",
    payload: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "installation",
      "x-hub-signature-256": signature,
    },
  });
}

async function uploadGitArchiveSource(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  workspaceId: string,
  archivePath: string,
  filename: string,
): Promise<{ source: { id: string; location: string; uploadObjectKey: string | null } }> {
  const archiveBuffer = fs.readFileSync(archivePath);
  const boundary = "----SpecLensBoundary";
  const multipartPayload = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
    Buffer.from("Content-Type: application/gzip\r\n\r\n"),
    archiveBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploadResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspaceId}/uploads`,
    payload: multipartPayload,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  });
  assert.equal(uploadResponse.statusCode, 200);
  return uploadResponse.json() as { source: { id: string; location: string; uploadObjectKey: string | null } };
}

async function enableProWorkspace(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  workspaceId: string,
): Promise<void> {
  const checkoutResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      workspaceId,
      plan: "pro",
    },
  });
  assert.equal(checkoutResponse.statusCode, 200);
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string };
  const webhookResponse: any = await postCheckoutCompletedWebhook(app, checkoutPayload.checkoutSessionId);
  assert.equal(webhookResponse.statusCode, 200);
}

async function startRunnerProcess(env: Record<string, string>): Promise<{
  close: () => Promise<void>;
}> {
  const runnerModuleUrl = pathToFileURL(path.resolve(process.cwd(), "apps/runner/src/services/runner.ts")).href;
  const bootstrap = [
    `const runner = await import('${runnerModuleUrl}');`,
    "await (runner.startEmbeddedRunnerWorker ?? runner.default?.startEmbeddedRunnerWorker).call(runner.default ?? runner);",
    "console.log('RUNNER_READY');",
    "setInterval(() => {}, 1 << 30);",
  ].join(" ");
  const child = spawn("node", ["--import", "tsx", "--eval", bootstrap], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      RUNNER_ID: env.RUNNER_ID ?? `runner-${Date.now()}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let ready = false;
  child.stdout.on("data", chunk => {
    const text = chunk.toString();
    output += text;
    if (text.includes("RUNNER_READY")) {
      ready = true;
    }
  });
  child.stderr.on("data", chunk => {
    output += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.once("exit", code => {
      if (ready) {
        resolve();
        return;
      }
      reject(new Error(`Runner process exited early with code ${code ?? "unknown"}.\n${output}`));
    });
    child.once("error", reject);
    const startedAt = Date.now();
    const poll = () => {
      if (ready) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 30_000) {
        reject(new Error(`Timed out waiting for runner worker readiness.\n${output}`));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });

  return {
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>(resolve => {
          child.once("exit", () => resolve());
        }),
        new Promise<void>(resolve => {
          setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5_000);
        }),
      ]);
    },
  };
}

async function startAgentWorkerProcess(env: Record<string, string>): Promise<{
  close: () => Promise<void>;
}> {
  const workerModuleUrl = pathToFileURL(path.resolve(process.cwd(), "apps/ai-worker/src/services/worker.ts")).href;
  const bootstrap = [
    `const worker = await import('${workerModuleUrl}');`,
    "await (worker.startEmbeddedAgentWorker ?? worker.default?.startEmbeddedAgentWorker).call(worker.default ?? worker);",
    "console.log('AI_WORKER_READY');",
    "setInterval(() => {}, 1 << 30);",
  ].join(" ");
  const child = spawn("node", ["--import", "tsx", "--eval", bootstrap], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      AI_WORKER_ID: env.AI_WORKER_ID ?? `ai-worker-${Date.now()}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let ready = false;
  child.stdout.on("data", chunk => {
    const text = chunk.toString();
    output += text;
    if (text.includes("AI_WORKER_READY")) {
      ready = true;
    }
  });
  child.stderr.on("data", chunk => {
    output += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.once("exit", code => {
      if (ready) {
        resolve();
        return;
      }
      reject(new Error(`AI worker process exited early with code ${code ?? "unknown"}.\n${output}`));
    });
    child.once("error", reject);
    const startedAt = Date.now();
    const poll = () => {
      if (ready) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 30_000) {
        reject(new Error(`Timed out waiting for AI worker readiness.\n${output}`));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });

  return {
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>(resolve => {
          child.once("exit", () => resolve());
        }),
        new Promise<void>(resolve => {
          setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5_000);
        }),
      ]);
    },
  };
}

async function createApiAppInstance(
  databaseName = createTestDatabaseName("speclens_api"),
  env: Record<string, string> = {},
  options: {
    reuseDatabase?: boolean;
    startRunner?: boolean;
    startAiWorker?: boolean;
  } = {},
) {
  const databaseUrl = await preparePrismaTestDatabase(
    databaseName,
    options.reuseDatabase ? { reuseExisting: true } : {},
  );
  const restoreEnv = await installApiTestEnv({
    DATABASE_URL: databaseUrl,
    STRIPE_WEBHOOK_SECRET: defaultStripeWebhookSecret,
    GITHUB_APP_WEBHOOK_SECRET: defaultGithubWebhookSecret,
    ...env,
  });
  await ensureRunnerSandboxImage();
  const runnerTempRoot = createHomeTempDirSync("speclens-test-runner-");
  const apiAppModule = await import("../apps/api/src/app");
  const candidate = apiAppModule.default as {
    createApiApp?: () => Promise<{ app: any }>;
    default?: () => Promise<{ app: any }>;
  } | (() => Promise<{ app: any }>);
  const createApiApp = typeof candidate === "function"
    ? candidate
    : typeof candidate.createApiApp === "function"
      ? candidate.createApiApp
      : candidate.default;

  assert.equal(typeof createApiApp, "function");
  const instance = await createApiApp!();
  const runner = options.startRunner
      ? await startRunnerProcess({
        DATABASE_URL: databaseUrl,
        API_AUTH_MODE: process.env.API_AUTH_MODE ?? "local-dev",
        OBJECT_STORAGE_PROVIDER: process.env.OBJECT_STORAGE_PROVIDER ?? "local",
        OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET ?? "",
        OBJECT_STORAGE_ENDPOINT: process.env.OBJECT_STORAGE_ENDPOINT ?? "",
        OBJECT_STORAGE_PUBLIC_ENDPOINT: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? "",
        OBJECT_STORAGE_REGION: process.env.OBJECT_STORAGE_REGION ?? "",
        OBJECT_STORAGE_FORCE_PATH_STYLE: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? "",
        OBJECT_STORAGE_ACCESS_KEY_ID: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "",
        GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
        GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
        GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE ?? "",
        GITHUB_API_TOKEN: process.env.GITHUB_API_TOKEN ?? "",
        SANDBOX_IMAGE: process.env.SANDBOX_IMAGE ?? "speclens/analysis-runner:local",
        RUNNER_TEMP_ROOT: runnerTempRoot,
      })
    : null;
  const aiWorkerTempRoot = createHomeTempDirSync("speclens-test-ai-worker-");
  const aiWorker = options.startAiWorker
    ? await startAgentWorkerProcess({
        DATABASE_URL: databaseUrl,
        API_AUTH_MODE: process.env.API_AUTH_MODE ?? "local-dev",
        OBJECT_STORAGE_PROVIDER: process.env.OBJECT_STORAGE_PROVIDER ?? "local",
        OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET ?? "",
        OBJECT_STORAGE_ENDPOINT: process.env.OBJECT_STORAGE_ENDPOINT ?? "",
        OBJECT_STORAGE_PUBLIC_ENDPOINT: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? "",
        OBJECT_STORAGE_REGION: process.env.OBJECT_STORAGE_REGION ?? "",
        OBJECT_STORAGE_FORCE_PATH_STYLE: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? "",
        OBJECT_STORAGE_ACCESS_KEY_ID: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "",
        GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
        GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
        GITHUB_APP_PRIVATE_KEY_FILE: process.env.GITHUB_APP_PRIVATE_KEY_FILE ?? "",
        GITHUB_API_TOKEN: process.env.GITHUB_API_TOKEN ?? "",
        AI_WORKER_TEMP_ROOT: aiWorkerTempRoot,
        CODEX_BIN: process.env.CODEX_BIN ?? "",
      })
    : null;
  return {
    ...instance,
    close: async () => {
      await instance.app.close();
      await runner?.close();
      await aiWorker?.close();
      await disconnectDatabase();
      await restoreEnv();
      fs.rmSync(runnerTempRoot, { recursive: true, force: true });
      fs.rmSync(aiWorkerTempRoot, { recursive: true, force: true });
    },
  };
}

after(async () => {
  await stopHostedTestRuntime();
});

function writeCodexStub(stubPath: string): void {
  const script = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "let outputPath = null;",
    "for (let i = 0; i < args.length - 1; i += 1) {",
    "  if (args[i] === '--output-last-message') {",
    "    outputPath = args[i + 1];",
    "    break;",
    "  }",
    "}",
    "if (!outputPath) { process.exit(2); }",
    "if (outputPath.includes('remediation-iteration-')) {",
    "  const remediationPath = require('node:path').join(process.cwd(), 'SPECLENS_REMEDIATION.md');",
    "  fs.writeFileSync(remediationPath, '# SpecLens remediation\\n\\nThis changeset was generated by the test stub.\\n', 'utf8');",
    "  fs.writeFileSync(outputPath, JSON.stringify({",
    "    summary: 'Remediation changes applied',",
    "    changedFiles: ['SPECLENS_REMEDIATION.md'],",
    "    commandsRun: ['write SPECLENS_REMEDIATION.md'],",
    "    notes: ['Deterministic remediation stub output.'],",
    "  }));",
    "  process.exit(0);",
    "}",
    "const roleId = /role-(.+)\\.json$/.exec(outputPath)?.[1] ?? 'unknown';",
    "const payload = roleId === 'standardized-json-output' ? {",
    "  summary: 'Canonical handoff ready',",
    "  sections: [{",
    "    title: 'Standardized JSON handoff',",
    "    status: 'ready',",
    "    summary: 'Structured runtime and auth handoff prepared.',",
    "    data: { standardizedOutput: {",
    "      schemaVersion: 'speclens.agent-handoff.v1',",
    "      auditBundleId: 'standard',",
    "      generatedBy: { agentId: 'agent-universal-standard', agentName: 'Universal audit standard agent', roleId: 'standardized-json-output', roleName: 'Standardized JSON output' },",
    "      runtime: { installCommands: [], buildCommands: [], startCommands: [], verificationCommands: [], packageManagers: ['npm'], targets: [], workingDirectories: ['.'], serviceDependencies: [], envFiles: [], ports: [], baseUrls: [] },",
    "      auth: { frontend: { strategy: null, loginRoutes: [], callbackRoutes: [], protectedRoutes: [], secretRefs: [], bootstrapSteps: [], userActions: [] }, api: { strategy: null, loginRoutes: [], callbackRoutes: [], protectedRoutes: [], secretRefs: [], bootstrapSteps: [], userActions: [] } },",
    "      playwright: { readiness: 'blocked', present: false, packageManager: 'npm', configPaths: [], commands: [], setupCommands: [], workingDirectories: ['.'], baseUrlStrategy: null, authStrategy: null, testTargets: [], navigationTargets: [], journeys: [], assertions: [], reporters: [], artifacts: [], prerequisites: [], coverageGaps: [] },",
    "      detectedSurfaces: [{ label: 'Fixture app', kind: 'repo-app', location: '.', companion: false, confidence: 'high' }],",
    "      executionCoverage: { attempted: [], skipped: [] },",
    "      artifactExpectations: [],",
    "      remediationPacks: [],",
    "      releaseGateDecision: { status: 'warn', reason: 'Compatibility bridge validation run.', confidence: 'medium', blockingFindingIds: [] },",
    "      blockers: [],",
    "      recommendations: [],",
    "    } },",
    "  }],",
    "  findings: [],",
    "} : {",
    "  summary: `Stub summary for ${roleId}`,",
    "  sections: [{ title: `Stub section ${roleId}`, status: 'ready', summary: 'ok', data: { roleId } }],",
    "  findings: [],",
    "};",
    "fs.writeFileSync(outputPath, JSON.stringify(payload));",
  ].join("\n");
  fs.writeFileSync(stubPath, script, { encoding: "utf8" });
  fs.chmodSync(stubPath, 0o755);
}

async function createStubbedAiWorkerApiAppInstance(
  databaseName?: string,
  env: Record<string, string> = {},
  options: {
    reuseDatabase?: boolean;
    startRunner?: boolean;
  } = {},
): Promise<Awaited<ReturnType<typeof createApiAppInstance>> & { tempRoot: string }> {
  const tempRoot = createHomeTempDirSync("speclens-api-aiworker-");
  const codexStubPath = path.join(tempRoot, "codex-stub.js");
  writeCodexStub(codexStubPath);
  const instance = await createApiAppInstance(
    databaseName,
    {
      CODEX_BIN: codexStubPath,
      AI_WORKER_CODEX_TIMEOUT_MS: "10000",
      APP_STATE_PATH: path.join(tempRoot, "state.json"),
      OBJECT_STORAGE_PROVIDER: "local",
      ...env,
    },
    { ...options, startAiWorker: true },
  );
  return {
    ...instance,
    tempRoot,
  };
}

function getApiTestJobTimeoutMs(): number {
  const value = Number.parseInt(process.env.SPECLENS_API_TEST_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 180_000;
}

function getApiTestJobPollIntervalMs(): number {
  const value = Number.parseInt(process.env.SPECLENS_API_TEST_JOB_POLL_INTERVAL_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 100;
}

async function waitForJob(app: any, jobId: string, timeoutMs = getApiTestJobTimeoutMs()): Promise<any> {
  const startedAt = Date.now();
  let lastStatus = "unknown";
  for (;;) {
    const response: any = await authenticatedInject(app, {
      method: "GET",
      url: `/api/jobs/${jobId}`,
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as { job: { job: { status: string } } };
    lastStatus = payload.job.job.status;
    if (payload.job.job.status === "succeeded" || payload.job.job.status === "failed" || payload.job.job.status === "cancelled") {
      return payload;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for job ${jobId} after ${timeoutMs}ms. Last status: ${lastStatus}.`);
    }
    await new Promise(resolve => setTimeout(resolve, getApiTestJobPollIntervalMs()));
  }
}

async function waitForCodeReview(app: any, url: string, timeoutMs = getApiTestJobTimeoutMs()): Promise<any> {
  const startedAt = Date.now();
  for (;;) {
    const response: any = await authenticatedInject(app, {
      method: "GET",
      url,
    });
    if (response.statusCode === 200) {
      return response;
    }
    if (response.statusCode !== 409) {
      assert.equal(response.statusCode, 200);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for code review readiness at ${url}.`);
    }
    await new Promise(resolve => setTimeout(resolve, getApiTestJobPollIntervalMs()));
  }
}

test("hosted API supports queued workspace analysis, logs, report, and export flow", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const tasksResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: "/api/analysis-tasks",
  });
  assert.equal(tasksResponse.statusCode, 200);
  const tasksPayload = tasksResponse.json() as { tasks: Array<{ agentId: string }> };
  assert.equal(tasksPayload.tasks.some(item => item.agentId === "agent-universal-exhaustive"), true);

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Portal Workspace",
      description: "Hosted workspace for API validation",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string; slug: string } };

  const sourceOwner = await ensureAuthenticatedPortalUser();
  const sourceRecord = await createSourceForUserForTests(workspacePayload.workspace.id, sourceOwner.id, {
    type: "git-public",
    displayName: "Remediation fixture",
    location: fixtureUrl,
  });
  const sourcePayload = { source: { id: sourceRecord.id } };

  const secretResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets`,
    payload: {
      name: "TagTwo creds",
      kind: "credential-pair",
      value: "{\"username\":\"demo\",\"password\":\"secret\"}",
    },
  });
  assert.equal(secretResponse.statusCode, 200);
  const secretPayload = secretResponse.json() as { secret: { id: string } };

  const analysisResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      agentId: "agent-universal-exhaustive",
      runtimeMode: "browser",
      secretRefs: [secretPayload.secret.id],
    },
  });
  assert.equal(analysisResponse.statusCode, 200);
  const analysisPayload = analysisResponse.json() as {
    job: {
      job: { id: string; status: string; agentId: string | null; executionPath: string };
      report: null;
    };
  };
  assert.equal(["pending", "queued"].includes(analysisPayload.job.job.status), true);
  assert.equal(analysisPayload.job.job.agentId, "agent-universal-exhaustive");
  assert.equal(analysisPayload.job.job.executionPath, "unified-agent");

  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  assert.equal(completedPayload.job.job.status, "succeeded");
  assert.equal(completedPayload.job.job.executionPath, "unified-agent");
  assert.ok(completedPayload.job.report);
  assert.equal(completedPayload.job.report?.sections.length > 0, true);

  const logsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/logs`,
  });
  assert.equal(logsResponse.statusCode, 200);
  const logsPayload = logsResponse.json() as { logs: Array<{ id: string; message: string }> };
  assert.equal(logsPayload.logs.length > 1, true);
  assert.equal(logsPayload.logs.some(log => log.message.includes("dispatch") || log.message.includes("claimed")), true);

  const reportId = completedPayload.job.report!.id;
  const reportResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/reports/${reportId}`,
  });
  assert.equal(reportResponse.statusCode, 200);
  const reportPayload = reportResponse.json() as { report: { id: string; roles: Array<{ id: string }> } | null };
  assert.equal(reportPayload.report?.id, reportId);
  assert.equal(reportPayload.report?.roles.some(role => role.id === "browser-executor"), true);

  const exportResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/reports/${reportId}/export`,
  });
  assert.equal(exportResponse.statusCode, 200);
  const exportPayload = exportResponse.json() as { artifact: { key: string }; downloadUrl: string };
  assert.equal(exportPayload.artifact.key.includes("exports/reports/"), true);
  assert.equal(
    exportPayload.downloadUrl.includes(`/api/jobs/${analysisPayload.job.job.id}/artifacts/`)
      || exportPayload.downloadUrl.includes(`/api/proxy/api/jobs/${analysisPayload.job.job.id}/artifacts/`),
    true,
  );

  const artifactsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/artifacts`,
  });
  assert.equal(artifactsResponse.statusCode, 200);
  const artifactsPayload = artifactsResponse.json() as { artifacts: Array<{ key: string }> };
  const exportArtifactIndex = artifactsPayload.artifacts.findIndex(artifact => artifact.key === exportPayload.artifact.key);
  assert.notEqual(exportArtifactIndex, -1);

  const exportedArtifactResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/artifacts/${exportArtifactIndex}`,
  });
  assert.equal(exportedArtifactResponse.statusCode, 200);
});

test("hosted API supports owner-managed member, secret, and source lifecycle flows", async t => {
  const instance = await createApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const owner = await ensureAuthenticatedPortalUser();
  const member = await ensureAuthenticatedPortalUser({ cookie: workspaceMemberCookie });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Lifecycle Workspace",
      description: "Owner-managed collaboration and source lifecycle validation",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const missingMemberResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/members`,
    payload: {
      email: "missing-user@speclens.test",
    },
  });
  assert.equal(missingMemberResponse.statusCode, 404);

  const membershipResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/members`,
    payload: {
      email: member.email,
    },
  });
  assert.equal(membershipResponse.statusCode, 200);
  const membershipPayload = membershipResponse.json() as { membership: { id: string; email: string } };
  assert.equal(membershipPayload.membership.email, member.email);

  const detailResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}`,
  });
  assert.equal(detailResponse.statusCode, 200);
  const detailPayload = detailResponse.json() as {
    workspace: { ownerUserId: string };
    members: Array<{ id: string; userId: string; email: string; displayName: string }>;
  };
  const ownerMembership = detailPayload.members.find(currentMember => currentMember.userId === owner.id) ?? null;
  assert.ok(ownerMembership);
  assert.equal(
    detailPayload.members.some(currentMember => currentMember.email === member.email && currentMember.displayName === member.displayName),
    true,
  );

  const membersPageResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/members?q=workspace-member&page=1&pageSize=1`,
  });
  assert.equal(membersPageResponse.statusCode, 200);
  const membersPagePayload = membersPageResponse.json() as {
    items: Array<{ email: string }>;
    pageInfo: { page: number; pageSize: number; total: number; totalPages: number };
  };
  assert.equal(membersPagePayload.items[0]?.email, member.email);
  assert.equal(membersPagePayload.pageInfo.pageSize, 1);
  assert.equal(membersPagePayload.pageInfo.total >= 1, true);

  const secretCreateResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets`,
    payload: {
      name: "Preview login",
      kind: "credential-pair",
      value: "{\"username\":\"demo\",\"password\":\"secret\"}",
    },
  });
  assert.equal(secretCreateResponse.statusCode, 200);
  const secretPayload = secretCreateResponse.json() as { secret: { id: string; name: string } };

  const memberSecretsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets?q=Preview&page=1&pageSize=10`,
    headers: {
      cookie: workspaceMemberCookie,
    },
  });
  assert.equal(memberSecretsResponse.statusCode, 200);
  const memberSecretsPayload = memberSecretsResponse.json() as {
    items: Array<{ id: string; name: string; kind: string; valuePreview: string }>;
    pageInfo: { total: number };
  };
  assert.equal(memberSecretsPayload.items.some(secret => secret.id === secretPayload.secret.id && secret.name === "Preview login"), true);
  assert.equal(memberSecretsPayload.items[0]?.valuePreview.includes("stored"), true);
  assert.equal(memberSecretsPayload.pageInfo.total >= 1, true);

  const memberSecretSource = await createSourceForUserForTests(workspacePayload.workspace.id, owner.id, {
    type: "git-public",
    displayName: "Member queued source",
    location: fixtureUrl,
  });
  const memberAnalyzeWithSecretResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    headers: {
      cookie: workspaceMemberCookie,
    },
    payload: {
      sourceId: memberSecretSource.id,
      agentId: "agent-universal-standard",
      secretRefs: [secretPayload.secret.id],
    },
  });
  assert.equal(memberAnalyzeWithSecretResponse.statusCode, 403);

  const memberPlainSource = await createSourceForUserForTests(workspacePayload.workspace.id, owner.id, {
    type: "git-public",
    displayName: "Member queued source without secrets",
    location: fixtureUrl,
  });
  const memberAnalyzeWithoutSecretResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    headers: {
      cookie: workspaceMemberCookie,
    },
    payload: {
      sourceId: memberPlainSource.id,
      agentId: "agent-universal-standard",
    },
  });
  assert.equal(memberAnalyzeWithoutSecretResponse.statusCode, 200);

  const secretUpdateResponse: any = await authenticatedInject(app, {
    method: "PATCH",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets/${secretPayload.secret.id}`,
    payload: {
      name: "Preview login rotated",
      kind: "api-token",
      value: "token-v2",
    },
  });
  assert.equal(secretUpdateResponse.statusCode, 200);
  const secretUpdatePayload = secretUpdateResponse.json() as { secret: { id: string; name: string; kind: string } };
  assert.equal(secretUpdatePayload.secret.id, secretPayload.secret.id);
  assert.equal(secretUpdatePayload.secret.name, "Preview login rotated");
  assert.equal(secretUpdatePayload.secret.kind, "api-token");

  const memberSecretCreateResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets`,
    headers: {
      cookie: workspaceMemberCookie,
    },
    payload: {
      name: "Member token",
      kind: "api-token",
      value: "shh",
    },
  });
  assert.equal(memberSecretCreateResponse.statusCode, 403);

  const updatedSecretsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets?q=rotated&page=1&pageSize=10`,
  });
  assert.equal(updatedSecretsResponse.statusCode, 200);
  const updatedSecretsPayload = updatedSecretsResponse.json() as {
    items: Array<{ id: string; name: string; kind: string }>;
  };
  assert.equal(updatedSecretsPayload.items[0]?.id, secretPayload.secret.id);
  assert.equal(updatedSecretsPayload.items[0]?.name, "Preview login rotated");

  const unusedSource = await createSourceForUserForTests(workspacePayload.workspace.id, owner.id, {
    type: "git-public",
    displayName: "Unused source",
    location: fixtureUrl,
  });
  const renameResponse: any = await authenticatedInject(app, {
    method: "PATCH",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources/${unusedSource.id}`,
    payload: {
      displayName: "Renamed source",
    },
  });
  assert.equal(renameResponse.statusCode, 200);
  const renamePayload = renameResponse.json() as { source: { displayName: string } };
  assert.equal(renamePayload.source.displayName, "Renamed source");

  const filteredSourcesResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources?q=Renamed&type=git-public&page=1&pageSize=10`,
  });
  assert.equal(filteredSourcesResponse.statusCode, 200);
  const filteredSourcesPayload = filteredSourcesResponse.json() as {
    items: Array<{ id: string; displayName: string }>;
    pageInfo: { total: number };
  };
  assert.equal(filteredSourcesPayload.items[0]?.id, unusedSource.id);
  assert.equal(filteredSourcesPayload.items[0]?.displayName, "Renamed source");
  assert.equal(filteredSourcesPayload.pageInfo.total >= 1, true);

  const deleteUnusedSourceResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources/${unusedSource.id}`,
  });
  assert.equal(deleteUnusedSourceResponse.statusCode, 200);

  const inUseSource = await createSourceForUserForTests(workspacePayload.workspace.id, owner.id, {
    type: "git-public",
    displayName: "In-use source",
    location: fixtureUrl,
  });
  const analyzeResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: inUseSource.id,
      agentId: "agent-universal-standard",
    },
  });
  assert.equal(analyzeResponse.statusCode, 200);

  const deleteUsedSourceResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources/${inUseSource.id}`,
  });
  assert.equal(deleteUsedSourceResponse.statusCode, 409);

  const ownerRemovalResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/members/${ownerMembership?.id}`,
  });
  assert.equal(ownerRemovalResponse.statusCode, 400);

  const memberRemovalResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/members/${membershipPayload.membership.id}`,
  });
  assert.equal(memberRemovalResponse.statusCode, 200);

  const removedMemberSecretsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets`,
    headers: {
      cookie: workspaceMemberCookie,
    },
  });
  assert.equal(removedMemberSecretsResponse.statusCode, 403);

  const deleteSecretResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets/${secretPayload.secret.id}`,
  });
  assert.equal(deleteSecretResponse.statusCode, 200);
});

test("hosted API paginates and filters the workspace directory", async t => {
  const instance = await createApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const firstWorkspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Directory Alpha Workspace",
      description: "First directory workspace",
    },
  });
  assert.equal(firstWorkspaceResponse.statusCode, 200);

  const secondWorkspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Directory Beta Workspace",
      description: "Second directory workspace",
    },
  });
  assert.equal(secondWorkspaceResponse.statusCode, 200);

  const pagedResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: "/api/workspaces?page=1&pageSize=1",
  });
  assert.equal(pagedResponse.statusCode, 200);
  const pagedPayload = pagedResponse.json() as {
    items: Array<{ workspace: { name: string } }>;
    workspaces: Array<{ workspace: { name: string } }>;
    pageInfo: { page: number; pageSize: number; total: number; totalPages: number };
  };
  assert.equal(pagedPayload.items.length, 1);
  assert.equal(pagedPayload.workspaces.length, 1);
  assert.equal(pagedPayload.pageInfo.page, 1);
  assert.equal(pagedPayload.pageInfo.pageSize, 1);
  assert.equal(pagedPayload.pageInfo.total >= 2, true);
  assert.equal(pagedPayload.pageInfo.totalPages >= 2, true);

  const filteredResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: "/api/workspaces?q=Beta&page=1&pageSize=25",
  });
  assert.equal(filteredResponse.statusCode, 200);
  const filteredPayload = filteredResponse.json() as {
    items: Array<{ workspace: { name: string } }>;
    workspaces: Array<{ workspace: { name: string } }>;
    pageInfo: { total: number };
  };
  assert.deepEqual(
    filteredPayload.items.map(item => item.workspace.name),
    ["Directory Beta Workspace"],
  );
  assert.deepEqual(
    filteredPayload.workspaces.map(item => item.workspace.name),
    ["Directory Beta Workspace"],
  );
  assert.equal(filteredPayload.pageInfo.total, 1);
});

test("hosted API can generate a bounded remediation changeset from a completed report", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance(
    undefined,
    {
      AI_WORKER_CODEX_BYPASS_SANDBOX: "true",
      SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS: "true",
    },
    { startRunner: true },
  );
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Remediation Workspace",
      description: "Hosted workspace for remediation validation",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const sourceOwner = await ensureAuthenticatedPortalUser();
  const sourceRecord = await createSourceForUserForTests(workspacePayload.workspace.id, sourceOwner.id, {
    type: "git-public",
    displayName: "Compat fixture",
    location: fixtureUrl,
  });
  const sourcePayload = { source: { id: sourceRecord.id } };

  const analysisResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      agentId: "agent-universal-standard",
    },
  });
  assert.equal(analysisResponse.statusCode, 200);
  const analysisPayload = analysisResponse.json() as {
    job: {
      job: { id: string };
    };
  };

  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  assert.equal(completedPayload.job.job.status, "succeeded");
  const reportId = completedPayload.job.report?.id;
  assert.ok(reportId);

  const remediateResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/reports/${reportId}/remediate`,
    payload: {
      sourceId: sourcePayload.source.id,
      baseRef: "HEAD",
      maxIterations: 1,
      outputMode: "changeset",
      publishRemote: false,
    },
  });
  assert.equal(remediateResponse.statusCode, 200);
  const remediatePayload = remediateResponse.json() as {
    job: {
      job: {
        id: string;
        jobKind: string;
        parentReportId: string | null;
        executionPath: string;
      };
    };
  };
  assert.equal(remediatePayload.job.job.jobKind, "remediation");
  assert.equal(remediatePayload.job.job.parentReportId, reportId);
  assert.equal(remediatePayload.job.job.executionPath, "unified-agent");

  const completedRemediationPayload = await waitForJob(app, remediatePayload.job.job.id);
  assert.equal(completedRemediationPayload.job.job.status, "succeeded");
  assert.equal(completedRemediationPayload.job.job.jobKind, "remediation");
  assert.equal(completedRemediationPayload.job.job.parentReportId, reportId);
  assert.equal(completedRemediationPayload.job.job.changeset?.changedFiles.includes("SPECLENS_REMEDIATION.md"), true);
  assert.equal(completedRemediationPayload.job.job.changeset?.iterationCount, 1);
  assert.equal(completedRemediationPayload.job.artifacts.length >= 4, true);
  assert.equal(
    completedRemediationPayload.job.artifacts.some((artifact: { key: string }) => artifact.key.endsWith("patch-bundle.diff")),
    true,
  );
  assert.equal(
    completedRemediationPayload.job.artifacts.some((artifact: { key: string }) => artifact.key.endsWith("changeset-manifest.json")),
    true,
  );

  const remediationArtifactsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${remediatePayload.job.job.id}/artifacts`,
  });
  assert.equal(remediationArtifactsResponse.statusCode, 200);
  const remediationArtifactsPayload = remediationArtifactsResponse.json() as {
    artifacts: Array<{ key: string }>;
  };
  assert.equal(remediationArtifactsPayload.artifacts.length >= 4, true);

  const remediationArtifactContentResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${remediatePayload.job.job.id}/artifacts/0`,
  });
  assert.equal(remediationArtifactContentResponse.statusCode, 200);

  const codeReviewResponse: any = await waitForCodeReview(
    app,
    `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=${encodeURIComponent(sourcePayload.source.id)}&reportId=${encodeURIComponent(reportId)}`,
  );
  const codeReviewPayload = codeReviewResponse.json() as {
    review: {
      changesets: Array<{
        jobId: string;
        changedFiles: string[];
      }>;
      findings: Array<{ id: string }>;
      tree: Array<{ path: string }>;
    };
  };
  assert.equal(codeReviewPayload.review.changesets.some(item => item.jobId === remediatePayload.job.job.id), true);
  assert.equal(codeReviewPayload.review.changesets.some(item => item.changedFiles.includes("SPECLENS_REMEDIATION.md")), true);
  assert.equal(codeReviewPayload.review.findings.length > 0, true);
  assert.equal(codeReviewPayload.review.tree.length > 0, true);
  assert.equal(codeReviewPayload.review.tree.some(item => item.path.trim().length > 0), true);

  const refreshedReportResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/reports/${reportId}`,
  });
  assert.equal(refreshedReportResponse.statusCode, 200);
  const refreshedReportPayload = refreshedReportResponse.json() as {
    report: {
      summary: {
        latestRemediationJobId: string | null;
        changeset: {
          changedFiles: string[];
        } | null;
      };
    };
  };
  assert.equal(refreshedReportPayload.report.summary.latestRemediationJobId, remediatePayload.job.job.id);
  assert.deepEqual(refreshedReportPayload.report.summary.changeset?.changedFiles, ["SPECLENS_REMEDIATION.md"]);
});

test("hosted API rejects removed analysis control payloads", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const sourceOwner = await ensureAuthenticatedPortalUser();
  const workspace = await createWorkspaceForUser(sourceOwner, {
    name: "Removed Controls Workspace",
    description: "Verifies rejected hosted analysis control payloads",
  });
  const sourceRecord = await createSourceForUserForTests(workspace.id, sourceOwner.id, {
    type: "git-public",
    displayName: "Static fixture",
    location: fixtureUrl,
  });
  const sourcePayload = { source: { id: sourceRecord.id } };

  const analysisResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      preset: "generic",
      engine: "core",
    },
  });
  assert.equal(analysisResponse.statusCode, 400);
});

test("workspace code review rejects invalid source selections and navigates nested directories", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Code Review Workspace",
      description: "Validates code review source selection",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };
  await enableProWorkspace(app, workspacePayload.workspace.id);

  const sourcePayload = await uploadGitArchiveSource(
    app,
    workspacePayload.workspace.id,
    fixtureArchivePath,
    "tagtwo-mini.tar.gz",
  );

  const invalidSourceResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=missing-source`,
  });
  assert.equal(invalidSourceResponse.statusCode, 404);

  const invalidPrResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=${encodeURIComponent(sourcePayload.source.id)}&pr=12`,
  });
  assert.equal([400, 404].includes(invalidPrResponse.statusCode), true);

  const nestedDirectoryResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=${encodeURIComponent(sourcePayload.source.id)}&path=${encodeURIComponent("packages")}`,
  });
  assert.equal(nestedDirectoryResponse.statusCode, 200);
  const nestedDirectoryPayload = nestedDirectoryResponse.json() as {
    review: {
      selectedPath: string | null;
      tree: Array<{ path: string }>;
      selectedPullRequest: unknown | null;
    };
  };
  assert.equal(nestedDirectoryPayload.review.selectedPath, "packages");
  assert.equal(
    nestedDirectoryPayload.review.tree.some(entry => entry.path.startsWith("packages/allowed-lib")),
    true,
  );
  assert.equal(nestedDirectoryPayload.review.selectedPullRequest, null);

  const pullsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/pulls?sourceId=${encodeURIComponent(sourcePayload.source.id)}`,
  });
  assert.equal(pullsResponse.statusCode, 200);
  assert.deepEqual(pullsResponse.json(), {
    prSupport: "unavailable",
    pullRequests: [],
  });

  const analysisResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      agentId: "agent-universal-smoke",
    },
  });
  assert.equal(analysisResponse.statusCode, 200);
  const analysisPayload = analysisResponse.json() as { job: { job: { id: string } } };
  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  const reportId = completedPayload.job.report?.id;
  assert.ok(reportId);
  const findingId = completedPayload.job.report?.findings[0]?.id;
  assert.ok(findingId);

  const invalidReportResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=${encodeURIComponent(sourcePayload.source.id)}&reportId=missing-report`,
  });
  assert.equal(invalidReportResponse.statusCode, 404);

  const invalidFindingResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=${encodeURIComponent(sourcePayload.source.id)}&reportId=${encodeURIComponent(reportId)}&findingId=missing-finding`,
  });
  assert.equal(invalidFindingResponse.statusCode, 404);

  const focusedFindingResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/code/review?sourceId=${encodeURIComponent(sourcePayload.source.id)}&reportId=${encodeURIComponent(reportId)}&findingId=${encodeURIComponent(findingId)}`,
  });
  assert.equal(focusedFindingResponse.statusCode, 200);
  const focusedFindingPayload = focusedFindingResponse.json() as {
    review: {
      activeReportId: string | null;
      activeFindingId: string | null;
    };
  };
  assert.equal(focusedFindingPayload.review.activeReportId, reportId);
  assert.equal(focusedFindingPayload.review.activeFindingId, findingId);
});

test("hosted API filters default versus verbose logs and exposes source-scoped learnables", async t => {
  const instance = await createApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const user = await ensureAuthenticatedPortalUser();
  const workspace = await createWorkspaceForUser(user, {
    name: "Learnables Workspace",
  });
  const source = await createSourceForUserForTests(workspace.id, user.id, {
    type: "git-public",
    displayName: "Browser fixture",
    location: browserFixtureUrl,
  });
  const secondSource = await createSourceForUserForTests(workspace.id, user.id, {
    type: "git-public",
    displayName: "Second Browser fixture",
    location: browserFixtureUrl,
  });
  const job = await createAgentJobForUser(workspace.id, user.id, "agent-universal-standard", {
    sourceId: source.id,
  });

  await appendAnalysisJobLogs(job.job.id, [
    {
      id: "log_default_test",
      jobId: job.job.id,
      level: "info",
      scope: "learnables",
      message: "Stored 2 learnable(s) for future runs.",
      visibility: "default",
      createdAt: new Date().toISOString(),
    },
    {
      id: "log_verbose_test",
      jobId: job.job.id,
      level: "warn",
      scope: "codex",
      message: "Repo inventory: raw file listing omitted from the default console.",
      visibility: "verbose",
      createdAt: new Date(Date.now() + 1_000).toISOString(),
    },
  ]);

  await replaceSourceLearnables(workspace.id, source.id, job.job.id, [{
    statement: "Install dependencies with npm install from . for deps.",
    category: "runtime",
    evidence: ["package.json"],
  }]);
  await replaceSourceLearnables(workspace.id, secondSource.id, job.job.id, [{
    statement: "Frontend login starts at /auth/login.",
    category: "auth",
    evidence: ["/auth/login"],
  }]);
  await replaceSourceLearnables(workspace.id, source.id, job.job.id, [{
    statement: "Start the repository with npm run dev:web from . for start web.",
    category: "runtime",
    evidence: ["package.json"],
  }]);

  const defaultLogsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${job.job.id}/logs`,
  });
  assert.equal(defaultLogsResponse.statusCode, 200);
  const defaultLogsPayload = defaultLogsResponse.json() as { logs: Array<{ message: string; visibility: string }> };
  assert.equal(defaultLogsPayload.logs.some(log => log.message.includes("Stored 2 learnable(s)")), true);
  assert.equal(defaultLogsPayload.logs.some(log => log.visibility === "verbose"), false);

  const verboseLogsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${job.job.id}/logs?verbosity=verbose`,
  });
  assert.equal(verboseLogsResponse.statusCode, 200);
  const verboseLogsPayload = verboseLogsResponse.json() as { logs: Array<{ message: string; visibility: string }> };
  assert.equal(verboseLogsPayload.logs.some(log => log.message.includes("raw file listing")), true);
  assert.equal(verboseLogsPayload.logs.some(log => log.visibility === "default"), false);

  const learnablesResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspace.id}/sources/${source.id}/learnables`,
  });
  assert.equal(learnablesResponse.statusCode, 200);
  const learnablesPayload = learnablesResponse.json() as {
    learnables: Array<{ statement: string }>;
  };
  assert.deepEqual(
    learnablesPayload.learnables.map(learnable => learnable.statement),
    ["Start the repository with npm run dev:web from . for start web."],
  );
});

test("hosted API provisions the current user from the portal session cookie", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const cookie = makePortalSessionCookie({
    provider: "keycloak",
    subject: "user-123",
    email: "alice@example.com",
    displayName: "Alice Example",
  });

  const meResponse: any = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: {
      cookie,
    },
  });
  assert.equal(meResponse.statusCode, 200);
  const mePayload = meResponse.json() as { user: { id: string; identityProvider: string; identitySubject: string; email: string } };
  assert.equal(mePayload.user.identityProvider, "keycloak");
  assert.equal(mePayload.user.identitySubject, "user-123");
  assert.equal(mePayload.user.email, "alice@example.com");

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    headers: {
      cookie,
    },
    payload: {
      name: "Alice Workspace",
      description: "Created from the provisioned cookie user",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { ownerUserId: string } };
  assert.equal(workspacePayload.workspace.ownerUserId, mePayload.user.id);
});

test("hosted API can run browser parity analysis with stored workspace credentials", async t => {
  let playwrightAvailable = true;
  try {
    const playwright = await import("@playwright/test");
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
  } catch {
    playwrightAvailable = false;
  }

  if (!playwrightAvailable) {
    t.skip("Playwright browser runtime is not available in this environment.");
    return;
  }

  const instance = await createStubbedAiWorkerApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  await ensureAuthenticatedPortalUser();
  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Browser Workspace",
      description: "Hosted browser parity workspace",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };
  await enableProWorkspace(app, workspacePayload.workspace.id);

  const sourcePayload = await uploadGitArchiveSource(
    app,
    workspacePayload.workspace.id,
    browserFixtureArchivePath,
    "browser-parity-app.tar.gz",
  );

  const secretResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets`,
    payload: {
      name: "Fixture credentials",
      kind: "credential-pair",
      value: "{\"username\":\"demo\",\"password\":\"secret\"}",
    },
  });
  assert.equal(secretResponse.statusCode, 200);
  const secretPayload = secretResponse.json() as { secret: { id: string } };

  const analysisResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      agentId: "agent-universal-exhaustive",
      runtimeMode: "browser",
      secretRefs: [secretPayload.secret.id],
    },
  });
  assert.equal(analysisResponse.statusCode, 200);
  const analysisPayload = analysisResponse.json() as {
    job: {
      job: { id: string };
      report: null;
    };
  };

  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  assert.equal(completedPayload.job.job.executionPath, "unified-agent");
  assert.equal(completedPayload.job.job.runtimeMode, "browser");
  const browserSection = completedPayload.job.report?.sections.find((section: { title?: string }) =>
    section.title === "Browser QA execution" || section.title === "Browser self-check");
  assert.ok(browserSection);
  assert.equal(browserSection?.status, "ready");
  assert.equal(Boolean((browserSection?.data as { authenticated?: boolean }).authenticated), true);
});

test("hosted API billing and github install intent routes update local state", async t => {
  const instance = await createApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Commercial Workspace",
      description: "Workspace for billing and install tests",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const checkoutResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      workspaceId: workspacePayload.workspace.id,
      plan: "pro",
    },
  });
  assert.equal(checkoutResponse.statusCode, 200);
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string; checkoutUrl: string; plan: string };
  assert.equal(checkoutPayload.plan, "pro");
  assert.equal(checkoutPayload.checkoutUrl.includes(checkoutPayload.checkoutSessionId), true);

  const stripeWebhookResponse: any = await postCheckoutCompletedWebhook(app, checkoutPayload.checkoutSessionId);
  assert.equal(stripeWebhookResponse.statusCode, 200);
  const stripeWebhookPayload = stripeWebhookResponse.json() as { entitlement: string };
  assert.equal(stripeWebhookPayload.entitlement, "pro");

  const billingPortalResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/portal",
    payload: {
      workspaceId: workspacePayload.workspace.id,
    },
  });
  assert.equal(billingPortalResponse.statusCode, 200);
  const billingPortalPayload = billingPortalResponse.json() as { manageUrl: string };
  assert.equal(billingPortalPayload.manageUrl.includes(`/portal/workspaces/${workspacePayload.workspace.id}/settings`), true);

  const meResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: "/api/me",
  });
  assert.equal(meResponse.statusCode, 200);
  const mePayload = meResponse.json() as { user: { entitlement: string } };
  assert.equal(mePayload.user.entitlement, "pro");

  const member = await ensureAuthenticatedPortalUser({ cookie: workspaceMemberCookie });
  const membershipResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/members`,
    payload: {
      email: member.email,
    },
  });
  assert.equal(membershipResponse.statusCode, 200);

  const memberBillingPortalResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/portal",
    headers: {
      cookie: workspaceMemberCookie,
    },
    payload: {
      workspaceId: workspacePayload.workspace.id,
    },
  });
  assert.equal(memberBillingPortalResponse.statusCode, 403);

  const installUrlResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/integrations/github/install?workspaceId=${workspacePayload.workspace.id}`,
  });
  assert.equal(installUrlResponse.statusCode, 200);
  const installUrlPayload = installUrlResponse.json() as { installUrl: string; state: string };
  assert.equal(installUrlPayload.installUrl.includes("state="), true);
  assert.equal(installUrlPayload.installUrl.includes(workspacePayload.workspace.id), false);
  assert.equal(typeof installUrlPayload.state, "string");

  const githubWebhookResponse: any = await postGithubInstallationWebhook(app, {
    action: "created",
    installation: {
      id: 12345,
      account: {
        login: "example-org",
      },
    },
  });
  assert.equal(githubWebhookResponse.statusCode, 200);
  const githubWebhookPayload = githubWebhookResponse.json() as { ignored: boolean; provider: string };
  assert.equal(githubWebhookPayload.provider, "github");
  assert.equal(githubWebhookPayload.ignored, true);

  const installationRecord = await getPrismaClient().githubInstallation.create({
    data: {
      workspaceId: workspacePayload.workspace.id,
      githubInstallationId: `unlink-${Date.now()}`,
      githubAccountLogin: "example-org",
    },
  });

  const memberUnlinkResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/integrations/github/installations/${installationRecord.id}`,
    headers: {
      cookie: workspaceMemberCookie,
    },
  });
  assert.equal(memberUnlinkResponse.statusCode, 403);

  const unlinkResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/integrations/github/installations/${installationRecord.id}`,
  });
  assert.equal(unlinkResponse.statusCode, 200);
  const deletedInstallation = await getPrismaClient().githubInstallation.findUnique({
    where: { id: installationRecord.id },
  });
  assert.equal(deletedInstallation, null);
});

test("hosted API billing checkout fallback URLs stay on the configured app origin and preserve query strings", async t => {
  const instance = await createApiAppInstance(createTestDatabaseName("billing_urls"), {
    APP_URL: "https://portal.speclens.test",
    API_URL: "https://api.speclens.test",
    SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH: "true",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const checkoutResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      plan: "pro",
    },
  });
  assert.equal(checkoutResponse.statusCode, 200);
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string; checkoutUrl: string; cancelUrl: string };
  const checkoutUrl = new URL(checkoutPayload.checkoutUrl);
  assert.equal(checkoutUrl.origin, "https://portal.speclens.test");
  assert.equal(checkoutUrl.pathname, "/portal");
  assert.equal(checkoutUrl.searchParams.get("billing"), "success");
  assert.equal(checkoutUrl.searchParams.get("session_id"), checkoutPayload.checkoutSessionId);
  assert.equal(checkoutUrl.searchParams.get("plan"), "pro");
  assert.equal(checkoutPayload.checkoutUrl.includes("billing=success?session_id="), false);

  const cancelUrl = new URL(checkoutPayload.cancelUrl);
  assert.equal(cancelUrl.origin, "https://portal.speclens.test");
  assert.equal(cancelUrl.pathname, "/pricing");
  assert.equal(cancelUrl.searchParams.get("billing"), "cancelled");
});

test("hosted API aggregates repositories across linked GitHub installations and honors the selected installation", async t => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const originalFetch = global.fetch;
  const instance = await createApiAppInstance(undefined, {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({
      format: "pem",
      type: "pkcs8",
    }).toString(),
  });
  const { app } = instance;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.includes("/app/installations/install_org/access_tokens")) {
      return new Response(JSON.stringify({ token: "token-org" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/app/installations/install_user/access_tokens")) {
      return new Response(JSON.stringify({ token: "token-user" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/installation/repositories")) {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "token token-org") {
        return new Response(JSON.stringify({
          repositories: [
            {
              id: 101,
              name: "platform",
              full_name: "acme-org/platform",
              html_url: "https://github.com/acme-org/platform",
              clone_url: "https://github.com/acme-org/platform.git",
              private: true,
              default_branch: "main",
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (authorization === "token token-user") {
        return new Response(JSON.stringify({
          repositories: [
            {
              id: 202,
              name: "private-app",
              full_name: "shared-space/private-app",
              html_url: "https://github.com/shared-space/private-app",
              clone_url: "https://github.com/shared-space/private-app.git",
              private: true,
              default_branch: "main",
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    if (url.endsWith("/repos/shared-space/private-app")) {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "token token-user") {
        return new Response(JSON.stringify({
          id: 202,
          full_name: "shared-space/private-app",
          private: true,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    throw new Error(`Unexpected GitHub fetch during test: ${url}`);
  }) as typeof fetch;

  t.after(async () => {
    global.fetch = originalFetch;
    await instance.close();
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "GitHub multi-install workspace",
      description: "Aggregates private repositories across linked installations.",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  await enableProWorkspace(app, workspacePayload.workspace.id);

  await getPrismaClient().githubInstallation.createMany({
    data: [
      {
        workspaceId: workspacePayload.workspace.id,
        githubInstallationId: "install_org",
        githubAccountLogin: "acme-org",
      },
      {
        workspaceId: workspacePayload.workspace.id,
        githubInstallationId: "install_user",
        githubAccountLogin: "platform-admin",
      },
    ],
  });

  const repositoriesResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/integrations/github/repositories?page=1&pageSize=10`,
  });
  assert.equal(repositoriesResponse.statusCode, 200);
  const repositoriesPayload = repositoriesResponse.json() as {
    items: Array<{
      fullName: string;
      githubInstallationId: string;
      githubAccountLogin: string;
    }>;
    pageInfo: { total: number };
  };
  assert.deepEqual(
    repositoriesPayload.items.map(repository => ({
      fullName: repository.fullName,
      githubInstallationId: repository.githubInstallationId,
      githubAccountLogin: repository.githubAccountLogin,
    })),
    [
      {
        fullName: "acme-org/platform",
        githubInstallationId: "install_org",
        githubAccountLogin: "acme-org",
      },
      {
        fullName: "shared-space/private-app",
        githubInstallationId: "install_user",
        githubAccountLogin: "platform-admin",
      },
    ],
  );
  assert.equal(repositoriesPayload.pageInfo.total, 2);

  const filteredRepositoriesResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/integrations/github/repositories?installationId=install_user&q=private-app&page=1&pageSize=10`,
  });
  assert.equal(filteredRepositoriesResponse.statusCode, 200);
  const filteredRepositoriesPayload = filteredRepositoriesResponse.json() as {
    items: Array<{
      githubInstallationId: string;
      fullName: string;
      githubAccountLogin: string;
    }>;
  };
  assert.deepEqual(
    filteredRepositoriesPayload.items.map(repository => ({
      githubInstallationId: repository.githubInstallationId,
      fullName: repository.fullName,
      githubAccountLogin: repository.githubAccountLogin,
    })),
    [{
      githubInstallationId: "install_user",
      fullName: "shared-space/private-app",
      githubAccountLogin: "platform-admin",
    }],
  );

  const createSourceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources`,
    payload: {
      type: "github-private",
      displayName: "Shared-space private app",
      location: "https://github.com/shared-space/private-app.git",
      githubInstallationId: "install_user",
    },
  });
  assert.equal(createSourceResponse.statusCode, 200);
  const createSourcePayload = createSourceResponse.json() as {
    source: {
      id: string;
      type: string;
      githubInstallationId: string | null;
      verificationStatus: string;
      location: string;
    };
  };
  assert.equal(createSourcePayload.source.type, "github-private");
  assert.equal(createSourcePayload.source.githubInstallationId, "install_user");
  assert.equal(createSourcePayload.source.verificationStatus, "verified");
  assert.equal(createSourcePayload.source.location, "https://github.com/shared-space/private-app.git");

  const linkedInstallation = await getPrismaClient().githubInstallation.findUnique({
    where: { githubInstallationId: "install_user" },
  });
  assert.ok(linkedInstallation);

  const unlinkResponse: any = await authenticatedInject(app, {
    method: "DELETE",
    url: `/api/workspaces/${workspacePayload.workspace.id}/integrations/github/installations/${linkedInstallation?.id}`,
  });
  assert.equal(unlinkResponse.statusCode, 200);

  const repairedSourceListResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources?q=private-app&page=1&pageSize=10`,
  });
  assert.equal(repairedSourceListResponse.statusCode, 200);
  const repairedSourceListPayload = repairedSourceListResponse.json() as {
    items: Array<{ id: string; verificationStatus: string; verificationError: string | null }>;
  };
  assert.equal(repairedSourceListPayload.items[0]?.id, createSourcePayload.source.id);
  assert.equal(repairedSourceListPayload.items[0]?.verificationStatus, "failed");
  assert.match(repairedSourceListPayload.items[0]?.verificationError ?? "", /Reconnect/i);

  const verifyWithoutInstallResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources/${createSourcePayload.source.id}/verify`,
    payload: {},
  });
  assert.equal(verifyWithoutInstallResponse.statusCode, 400);

  await getPrismaClient().githubInstallation.create({
    data: {
      id: "ghinst_relinked",
      workspaceId: workspacePayload.workspace.id,
      githubInstallationId: "install_user",
      githubAccountLogin: "platform-admin",
    },
  });

  const verifyAfterRelinkResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources/${createSourcePayload.source.id}/verify`,
    payload: {},
  });
  assert.equal(verifyAfterRelinkResponse.statusCode, 200);
  const verifyAfterRelinkPayload = verifyAfterRelinkResponse.json() as {
    source: { verificationStatus: string; verificationError: string | null };
  };
  assert.equal(verifyAfterRelinkPayload.source.verificationStatus, "verified");
  assert.equal(verifyAfterRelinkPayload.source.verificationError, null);
});

test("hosted API verifies signed Stripe webhooks when a webhook secret is configured", async t => {
  const instance = await createApiAppInstance(undefined, {
    STRIPE_WEBHOOK_SECRET: "whsec_speclens_signed",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const checkoutResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      plan: "pro",
    },
  });
  assert.equal(checkoutResponse.statusCode, 200);
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string };

  const eventPayload = JSON.stringify({
    id: "evt_signed_checkout",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutPayload.checkoutSessionId,
        object: "checkout.session",
        metadata: {},
        subscription: "sub_signed_checkout",
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: "whsec_speclens_signed",
  });

  const webhookResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/stripe",
    payload: eventPayload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
  });
  assert.equal(webhookResponse.statusCode, 200);
  const webhookPayload = webhookResponse.json() as { entitlement: string; provider: string };
  assert.equal(webhookPayload.provider, "stripe");
  assert.equal(webhookPayload.entitlement, "pro");

  const missingSignatureResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/stripe",
    payload: eventPayload,
    headers: {
      "content-type": "application/json",
    },
  });
  assert.equal(missingSignatureResponse.statusCode, 401);
});

test("hosted API verifies GitHub webhook signatures and safely acknowledges install events that await callback linking", async t => {
  const instance = await createApiAppInstance(undefined, {
    GITHUB_APP_WEBHOOK_SECRET: "github_webhook_secret_test",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const installPayload = JSON.stringify({
    action: "created",
    installation: {
      id: 12345,
      account: {
        login: "example-org",
      },
    },
  });
  const validSignature = `sha256=${createHmac("sha256", "github_webhook_secret_test").update(installPayload).digest("hex")}`;

  const webhookResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/github",
    payload: installPayload,
    headers: {
      "content-type": "application/json",
      "x-github-event": "installation",
      "x-hub-signature-256": validSignature,
    },
  });
  assert.equal(webhookResponse.statusCode, 200);
  const webhookPayload = webhookResponse.json() as {
    provider: string;
    ignored: boolean;
    reason: string;
  };
  assert.equal(webhookPayload.provider, "github");
  assert.equal(webhookPayload.ignored, true);
  assert.equal(webhookPayload.reason, "installation-created-awaiting-callback-link");

  const invalidSignatureResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/github",
    payload: installPayload,
    headers: {
      "content-type": "application/json",
      "x-github-event": "installation",
      "x-hub-signature-256": "sha256=invalid",
    },
  });
  assert.equal(invalidSignatureResponse.statusCode, 401);
});

test("hosted API rejects GitHub webhooks when no webhook secret is configured", async t => {
  const instance = await createApiAppInstance(undefined, {
    GITHUB_APP_WEBHOOK_SECRET: "",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const installPayload = JSON.stringify({
    action: "created",
    installation: {
      id: 12345,
      account: {
        login: "example-org",
      },
    },
  });

  const webhookResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/webhooks/github",
    payload: installPayload,
    headers: {
      "content-type": "application/json",
      "x-github-event": "installation",
      "x-hub-signature-256": `sha256=${createHmac("sha256", "unused").update(installPayload).digest("hex")}`,
    },
  });
  assert.equal(webhookResponse.statusCode, 503);
});

test("hosted API can retry pending public source verification from the sources surface", async t => {
  const instance = await createApiAppInstance();
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const meResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: "/api/me",
  });
  assert.equal(meResponse.statusCode, 200);
  const mePayload = meResponse.json() as { user: { id: string } };

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Source Verification Workspace",
      description: "Retries pending public source verification",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const source = await createSourceForUserForTests(workspacePayload.workspace.id, mePayload.user.id, {
    type: "git-public",
    displayName: "Fixture source",
    location: fixtureUrl,
  });
  await getPrismaClient().source.update({
    where: { id: source.id },
    data: {
      verificationStatus: "pending",
      verificationError: "stalled verification",
    },
  });

  const verifyResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources/${source.id}/verify`,
    payload: {},
  });
  assert.equal(verifyResponse.statusCode, 200);
  const verifyPayload = verifyResponse.json() as {
    source: {
      verificationStatus: string;
      verificationError: string | null;
    };
  };
  assert.equal(verifyPayload.source.verificationStatus, "verified");
  assert.equal(verifyPayload.source.verificationError, null);
});

test("hosted API only reflects trusted CORS origins", async t => {
  const instance = await createApiAppInstance(undefined, {
    API_AUTH_MODE: "keycloak",
    APP_URL: "https://portal.speclens.test",
    API_URL: "https://api.speclens.test",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const allowedResponse: any = await app.inject({
    method: "OPTIONS",
    url: "/api/me",
    headers: {
      origin: "https://portal.speclens.test",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(allowedResponse.headers["access-control-allow-origin"], "https://portal.speclens.test");

  const deniedResponse: any = await app.inject({
    method: "OPTIONS",
    url: "/api/me",
    headers: {
      origin: "https://evil.example.test",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(deniedResponse.headers["access-control-allow-origin"], undefined);
});

test("hosted API test factory resets env between sequential app instances", async t => {
  const first = await createApiAppInstance(undefined, {
    API_AUTH_MODE: "keycloak",
    APP_URL: "https://portal.speclens.test",
    API_URL: "https://api.speclens.test",
  });
  await first.close();

  const second = await createApiAppInstance();
  t.after(async () => {
    await second.close();
  });

  const meResponse: any = await authenticatedInject(second.app, {
    method: "GET",
    url: "/api/me",
  });
  assert.equal(meResponse.statusCode, 200);
});

test("hosted API registers local webhook targets and redirects gateway callbacks to the intended local app", async t => {
  const instance = await createApiAppInstance(undefined, {
    GITHUB_GATEWAY_URL: "https://github.speclens.tinamk.no",
    GITHUB_GATEWAY_DOMAIN: "github.speclens.tinamk.no",
    GITHUB_GATEWAY_REGISTRATION_TOKEN: "gateway-register-secret",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Gateway Workspace",
      description: "Gateway callback validation",
    },
    headers: {
      host: "localhost:8080",
      "x-forwarded-host": "localhost:8080",
      "x-forwarded-proto": "http",
      "x-forwarded-port": "8080",
    },
  });
  const workspaceId = (workspaceResponse.json() as { workspace: { id: string } }).workspace.id;

  const installUrlResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/integrations/github/install?workspaceId=${workspaceId}`,
    headers: {
      host: "localhost:8080",
      "x-forwarded-host": "localhost:8080",
      "x-forwarded-proto": "http",
      "x-forwarded-port": "8080",
    },
  });
  assert.equal(installUrlResponse.statusCode, 200);
  const installUrlPayload = installUrlResponse.json() as { state: string };

  const registerResponse: any = await app.inject({
    method: "POST",
    url: "/api/integrations/github/gateway/register",
    headers: {
      authorization: "Bearer gateway-register-secret",
    },
    payload: {
      environmentLabel: "local-test",
      appUrl: "http://localhost:8080",
      webhookForwardUrl: "https://smee.io/example",
      kind: "local",
    },
  });
  assert.equal(registerResponse.statusCode, 200);

  const callbackResponse: any = await app.inject({
    method: "GET",
    url: `/auth/github/callback?state=${encodeURIComponent(installUrlPayload.state)}&installation_id=12345&setup_action=install`,
    headers: {
      host: "github.speclens.tinamk.no",
      "x-forwarded-host": "github.speclens.tinamk.no",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(callbackResponse.statusCode, 302);
  assert.equal(
    callbackResponse.headers.location,
    `http://localhost:8080/auth/github/callback?state=${encodeURIComponent(installUrlPayload.state)}&installation_id=12345&setup_action=install`,
  );
});

test("hosted API persists workspace state across app restarts", async t => {
  const databaseName = createTestDatabaseName("speclens_persist");
  const first = await createApiAppInstance(databaseName);

  const workspaceResponse: any = await authenticatedInject(first.app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Persistent Workspace",
      description: "Should survive app recreation",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  await first.close();

  const second = await createApiAppInstance(databaseName, {}, { reuseDatabase: true });
  t.after(async () => {
    await second.close();
  });

  const detailResponse: any = await authenticatedInject(second.app, {
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}`,
  });
  assert.equal(detailResponse.statusCode, 200);
  const detailPayload = detailResponse.json() as { workspace: { id: string } };
  assert.equal(detailPayload.workspace.id, workspacePayload.workspace.id);
});

test("hosted API exposes artifacts and supports Git repository archive upload for pro workspaces", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance(createTestDatabaseName("speclens_upload"));
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Upload Workspace",
      description: "Artifact and upload validation",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const archiveBuffer = fs.readFileSync(browserFixtureArchivePath);
  const boundary = "----SpecLensDeniedUploadBoundary";
  const multipartPayload = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="browser-parity-app.tar.gz"\r\n'),
    Buffer.from("Content-Type: application/gzip\r\n\r\n"),
    archiveBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const deniedUpload: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/uploads`,
    payload: multipartPayload,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  });
  assert.equal(deniedUpload.statusCode, 403);

  const checkoutResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      workspaceId: workspacePayload.workspace.id,
      plan: "pro",
    },
  });
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string };
  await postCheckoutCompletedWebhook(app, checkoutPayload.checkoutSessionId);

  const uploadPayload = await uploadGitArchiveSource(
    app,
    workspacePayload.workspace.id,
    browserFixtureArchivePath,
    "browser-parity-app.tar.gz",
  );
  assert.equal(uploadPayload.source.location, "browser-parity-app.tar.gz");
  assert.ok(uploadPayload.source.uploadObjectKey);

  const analysisResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: uploadPayload.source.id,
      agentId: "agent-universal-standard",
    },
  });
  const analysisPayload = analysisResponse.json() as { job: { job: { id: string } } };
  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  assert.equal(completedPayload.job.job.executionPath, "unified-agent");
  assert.ok(completedPayload.job.report);

  const artifactsResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/artifacts`,
  });
  assert.equal(artifactsResponse.statusCode, 200);
  const artifactsPayload = artifactsResponse.json() as { artifacts: Array<{ key: string }> };
  assert.equal(artifactsPayload.artifacts.length > 0, true);

  const artifactContentResponse: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/artifacts/0`,
  });
  assert.equal(artifactContentResponse.statusCode, 200);
});

test("hosted API supports queued job cancellation and retry", async t => {
  const instance = await createStubbedAiWorkerApiAppInstance(createTestDatabaseName("speclens_queue"), {
    API_MAX_CONCURRENT_ANALYSES: "1",
  });
  const { app } = instance;
  t.after(async () => {
    await instance.close();
    fs.rmSync(instance.tempRoot, { recursive: true, force: true });
  });

  const workspaceResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Queue Control Workspace",
      description: "Used for cancellation and retry tests",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  await enableProWorkspace(app, workspacePayload.workspace.id);

  const sourcePayload = await uploadGitArchiveSource(
    app,
    workspacePayload.workspace.id,
    fixtureArchivePath,
    "tagtwo-mini.tar.gz",
  );

  const agents = await listAiAgents();
  const runtimeAgent = agents.find(agent => agent.id === "agent-universal-standard");
  assert.ok(runtimeAgent, "Expected the universal audit standard agent to be seeded.");
  const runtimeScoutRole = runtimeAgent.roles.find(role => role.id === "runtime-scout");
  assert.ok(runtimeScoutRole, "Expected the universal audit standard agent to include the runtime-scout role.");
  const queueProbeAgent = await createAiAgent({
    name: "Queue control runtime-scout probe",
    description: "Minimal agent for queue cancellation and retry coverage.",
    roleIds: [runtimeScoutRole?.id ?? "runtime-scout"],
  });

  const firstJobResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      agentId: queueProbeAgent.id,
    },
  });
  const firstJobPayload = firstJobResponse.json() as { job: { job: { id: string; executionPath: string } } };
  assert.equal(firstJobPayload.job.job.executionPath, "unified-agent");
  const firstJobId = firstJobPayload.job.job.id;

  const secondJobResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      agentId: queueProbeAgent.id,
    },
  });
  const secondJobPayload = secondJobResponse.json() as { job: { job: { id: string; status: string; executionPath: string } } };
  assert.equal(secondJobPayload.job.job.executionPath, "unified-agent");
  const secondJobId = secondJobPayload.job.job.id;

  const cancelResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/jobs/${secondJobId}/cancel`,
  });
  assert.equal(cancelResponse.statusCode, 200);
  const cancelPayload = cancelResponse.json() as { job: { job: { status: string; executionPath: string } } };
  assert.equal(cancelPayload.job.job.status, "cancelled");
  assert.equal(cancelPayload.job.job.executionPath, "unified-agent");

  const retryResponse: any = await authenticatedInject(app, {
    method: "POST",
    url: `/api/jobs/${secondJobId}/retry`,
  });
  assert.equal(retryResponse.statusCode, 200);
  const retryPayload = retryResponse.json() as { job: { job: { id: string; status: string; executionPath: string } } };
  assert.equal(["pending", "queued"].includes(retryPayload.job.job.status), true);
  assert.equal(retryPayload.job.job.executionPath, "unified-agent");
  assert.notEqual(retryPayload.job.job.id, secondJobId);

  await waitForJob(app, firstJobId);
  const retriedCompleted = await waitForJob(app, retryPayload.job.job.id);
  assert.equal(retriedCompleted.job.job.status, "succeeded");
  assert.equal(retriedCompleted.job.job.executionPath, "unified-agent");
});
