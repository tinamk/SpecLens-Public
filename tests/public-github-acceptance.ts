import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  disconnectDatabase,
  parseCodexAuthFile,
  storeCodexTokens,
} from "@speclens/db";
import { assertGoodAgentReport, type AnalysisReport } from "@speclens/contracts";
import { createHomeTempDirSync } from "@speclens/core";
import { installApiTestEnv } from "./helpers/api-test-env";
import { authenticatedInject } from "./helpers/portal-auth";
import { createTestDatabaseName, preparePrismaTestDatabase, stopHostedTestRuntime } from "./helpers/hosted-runtime";
import { publicGithubFixtures } from "./helpers/public-github-fixtures";

async function createApiAppInstance() {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("publicaccept"));
  const restoreEnv = await installApiTestEnv({
    DATABASE_URL: databaseUrl,
  });

  const apiAppModule = await import("../apps/api/src/app");
  const createApiApp = apiAppModule.createApiApp ?? apiAppModule.default;
  assert.equal(typeof createApiApp, "function");
  const instance = await createApiApp();

  return {
    app: instance.app as { inject: (options: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> },
    databaseUrl,
    close: async () => {
      await instance.app.close();
      await disconnectDatabase();
      await restoreEnv();
    },
  };
}

async function startAiWorkerProcess(env: Record<string, string>): Promise<{
  close: () => Promise<void>;
  assertRunning: () => void;
}> {
  const workerModuleUrl = pathToFileURL(path.resolve(process.cwd(), "apps/ai-worker/src/services/worker.ts")).href;
  const bootstrap = [
    `const worker = await import('${workerModuleUrl}');`,
    "const start = worker.startAgentLoop ?? worker.default?.startAgentLoop;",
    "if (typeof start !== 'function') { throw new Error('Missing startAgentLoop export.'); }",
    "Promise.resolve(start.call(worker.default ?? worker)).catch(error => { console.error(error); process.exit(1); });",
    "setInterval(() => {}, 1 << 30);",
  ].join(" ");
  const child = spawn("node", ["--import", "tsx", "--eval", bootstrap], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let exitMessage: string | null = null;
  child.stdout.on("data", chunk => {
    const text = chunk.toString();
    output += text;
  });
  child.stderr.on("data", chunk => {
    output += chunk.toString();
  });
  child.once("exit", code => {
    exitMessage = `AI worker exited with code ${code ?? "unknown"}.\n${output}`;
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    const startedAt = Date.now();
    const healthPort = Number(env.AI_WORKER_HEALTH_PORT);

    const poll = () => {
      if (exitMessage) {
        reject(new Error(exitMessage));
        return;
      }
      void fetch(`http://127.0.0.1:${healthPort}/ready`)
        .then(response => {
          if (response.ok) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 30_000) {
            reject(new Error(`Timed out waiting for AI worker health readiness.\n${output}`));
            return;
          }
          setTimeout(poll, 200);
        })
        .catch(() => {
          if (Date.now() - startedAt > 30_000) {
            reject(new Error(`Timed out waiting for AI worker health readiness.\n${output}`));
            return;
          }
          setTimeout(poll, 200);
        });
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
        new Promise<void>(resolve => child.once("exit", () => resolve())),
        new Promise<void>(resolve => setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000)),
      ]);
    },
    assertRunning: () => {
      if (exitMessage) {
        throw new Error(exitMessage);
      }
    },
  };
}

async function waitForJob(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  jobId: string,
  options: {
    fixtureLabel: string;
    assertWorkerRunning: () => void;
    timeoutMs?: number;
  },
): Promise<{
  job: {
    job: {
      id: string;
      status: string;
      executionPath: string;
      reportId: string | null;
      failureReason: string | null;
    };
    report: AnalysisReport | null;
  };
}> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 1_200_000;
  let lastStatus = "";
  for (;;) {
    options.assertWorkerRunning();
    const response: any = await authenticatedInject(app, {
      method: "GET",
      url: `/api/jobs/${jobId}`,
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      job: {
        job: {
          id: string;
          status: string;
          executionPath: string;
          reportId: string | null;
          failureReason: string | null;
        };
        report: AnalysisReport | null;
      };
    };
    if (payload.job.job.status !== lastStatus) {
      lastStatus = payload.job.job.status;
      console.log(`[acceptance] ${options.fixtureLabel} -> ${lastStatus}`);
    }
    if (["succeeded", "failed", "cancelled"].includes(payload.job.job.status)) {
      return payload;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for job ${jobId}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}

async function waitForSourceVerified(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  workspaceId: string,
  sourceId: string,
  timeoutMs = 120_000,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const response: any = await authenticatedInject(app, {
      method: "GET",
      url: `/api/workspaces/${workspaceId}`,
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      sources?: Array<{ id: string; verificationStatus?: string; verificationError?: string | null }>;
      workspace?: {
        sources?: Array<{ id: string; verificationStatus?: string; verificationError?: string | null }>;
      };
    };
    const sources = Array.isArray(payload.sources)
      ? payload.sources
      : Array.isArray(payload.workspace?.sources)
        ? payload.workspace.sources
        : [];
    const source = sources.find(candidate => candidate.id === sourceId);
    assert.ok(source, `Expected source ${sourceId} to exist.`);
    if (source.verificationStatus === "verified" || !source.verificationStatus) {
      return;
    }
    if (source.verificationStatus === "failed") {
      throw new Error(source.verificationError || `Source ${sourceId} failed verification.`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for source ${sourceId} verification.`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function readVerboseLogTail(
  app: { inject: (options: Record<string, unknown>) => Promise<unknown> },
  jobId: string,
): Promise<string> {
  const response: any = await authenticatedInject(app, {
    method: "GET",
    url: `/api/jobs/${jobId}/logs?verbosity=verbose`,
  });
  if (response.statusCode !== 200) {
    return `Could not fetch verbose logs (${response.statusCode}).`;
  }
  const payload = response.json() as {
    logs: Array<{ level: string; scope: string; message: string }>;
  };
  return payload.logs.slice(-20).map(log => `[${log.level}] ${log.scope}: ${log.message}`).join("\n");
}

function resolveAmbientCodexAuthPath(): string | null {
  const candidates = [
    process.env.CODEX_AUTH_PATH ?? "",
    path.join(os.homedir(), ".codex", "auth.json"),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

async function seedCodexAuthFromAmbientFile(): Promise<void> {
  const authPath = resolveAmbientCodexAuthPath();
  if (!authPath) {
    throw new Error("No ambient Codex auth file was found. Set CODEX_AUTH_PATH or sign in with Codex first.");
  }
  const parsed = parseCodexAuthFile(fs.readFileSync(authPath, "utf8"));
  if (!parsed) {
    throw new Error(`Unable to parse Codex auth from ${authPath}.`);
  }
  await storeCodexTokens(parsed);
  console.log(`[acceptance] seeded Codex auth from ${authPath}`);
}

async function main(): Promise<void> {
  const requestedFixtureIds = (process.env.PUBLIC_GITHUB_FIXTURE_IDS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const fixtures = requestedFixtureIds.length > 0
    ? publicGithubFixtures.filter(fixture => requestedFixtureIds.includes(fixture.id))
    : publicGithubFixtures;
  if (fixtures.length === 0) {
    throw new Error("No public GitHub fixtures matched PUBLIC_GITHUB_FIXTURE_IDS.");
  }
  const instance = await createApiAppInstance();
  const workerTempRoot = createHomeTempDirSync("speclens-public-acceptance-worker-");
  const workerHealthPort = String(4600 + Math.floor(Math.random() * 200));
  const workerId = process.env.AI_WORKER_ID?.trim() || `acceptance-worker-${Date.now()}`;
  const worker = await startAiWorkerProcess({
    DATABASE_URL: instance.databaseUrl,
    API_AUTH_MODE: "local-dev",
    OBJECT_STORAGE_PROVIDER: "local",
    AI_WORKER_ID: workerId,
    AI_WORKER_TEMP_ROOT: workerTempRoot,
    AI_WORKER_CODEX_BYPASS_SANDBOX: "true",
    SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS: "true",
    AI_WORKER_CODEX_TIMEOUT_MS: process.env.AI_WORKER_CODEX_TIMEOUT_MS ?? "1800000",
    AI_WORKER_HEALTH_PORT: workerHealthPort,
  });

  try {
    await seedCodexAuthFromAmbientFile();

    const workspaceResponse: any = await authenticatedInject(instance.app, {
      method: "POST",
      url: "/api/workspaces",
      payload: {
        name: `Public GitHub acceptance ${Date.now()}`,
        description: "Runtime operations agent acceptance against fixed public GitHub fixtures.",
      },
    });
    assert.equal(workspaceResponse.statusCode, 200);
    const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };
    const workspaceId = workspacePayload.workspace.id;

    const failures: string[] = [];

    for (const fixture of fixtures) {
      console.log(`[acceptance] starting ${fixture.label}`);
      try {
        const sourceResponse: any = await authenticatedInject(instance.app, {
          method: "POST",
          url: `/api/workspaces/${workspaceId}/sources`,
          payload: {
            type: "git-public",
            displayName: fixture.label,
            location: fixture.url,
          },
        });
        assert.equal(sourceResponse.statusCode, 200);
        const sourcePayload = sourceResponse.json() as { source: { id: string } };
        await waitForSourceVerified(instance.app, workspaceId, sourcePayload.source.id);

        const analysisResponse: any = await authenticatedInject(instance.app, {
          method: "POST",
          url: `/api/workspaces/${workspaceId}/analyze`,
          payload: {
            sourceId: sourcePayload.source.id,
            agentId: "agent-universal-standard",
          },
        });
        assert.equal(analysisResponse.statusCode, 200);
        const analysisPayload = analysisResponse.json() as {
          job: {
            job: {
              id: string;
            };
          };
        };

        const completed = await waitForJob(instance.app, analysisPayload.job.job.id, {
          fixtureLabel: fixture.label,
          assertWorkerRunning: worker.assertRunning,
        });
        assert.equal(completed.job.job.executionPath, "unified-agent");
        if (completed.job.job.status !== "succeeded" || !completed.job.job.reportId) {
          const tail = await readVerboseLogTail(instance.app, analysisPayload.job.job.id);
          throw new Error([
            `Job finished with status ${completed.job.job.status}.`,
            completed.job.job.failureReason ?? "No failureReason recorded.",
            tail,
          ].filter(Boolean).join("\n"));
        }

        const reportResponse: any = await authenticatedInject(instance.app, {
          method: "GET",
          url: `/api/reports/${completed.job.job.reportId}`,
        });
        assert.equal(reportResponse.statusCode, 200);
        const reportPayload = reportResponse.json() as { report: AnalysisReport | null };
        if (!reportPayload.report) {
          throw new Error("Report payload was empty.");
        }

        const handoff = assertGoodAgentReport(reportPayload.report);
        console.log(
          `[acceptance] passed ${fixture.label} -> start commands: ${handoff.runtime.startCommands.length}, blockers: ${handoff.blockers.length}, recommendations: ${handoff.recommendations.length}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${fixture.label}\n${message}`);
        console.error(`[acceptance] failed ${fixture.label}\n${message}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Public GitHub acceptance failed for ${failures.length} repo(s).\n\n${failures.join("\n\n---\n\n")}`);
    }

    console.log(`[acceptance] all ${fixtures.length} public GitHub fixtures produced good reports`);
  } finally {
    await worker.close();
    await instance.close();
    fs.rmSync(workerTempRoot, { recursive: true, force: true });
    await stopHostedTestRuntime();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
