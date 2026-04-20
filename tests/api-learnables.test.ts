import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import {
  appendAnalysisJobLogs,
  createAgentJobForUser,
  createWorkspaceForUser,
  disconnectDatabase,
  replaceSourceLearnables,
} from "@speclens/db";
import { createSourceForUserForTests } from "../packages/db/src/testing";
import { installApiTestEnv } from "./helpers/api-test-env";
import { authenticatedInject, ensureAuthenticatedPortalUser } from "./helpers/portal-auth";
import {
  createTestDatabaseName,
  preparePrismaTestDatabase,
  stopHostedTestRuntime,
} from "./helpers/hosted-runtime";
import { createCommittedGitFixture, toFileGitUrl } from "./helpers/git-fixtures";

async function createApiAppInstance() {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("apilearnables"));
  const restoreEnv = await installApiTestEnv({
    DATABASE_URL: databaseUrl,
  });

  const apiAppModule = await import("../apps/api/src/app");
  const createApiApp = apiAppModule.createApiApp ?? apiAppModule.default;
  assert.equal(typeof createApiApp, "function");
  const instance = await createApiApp();
  return {
    app: instance.app as { inject: (options: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> },
    close: async () => {
      await instance.app.close();
      await disconnectDatabase();
      await restoreEnv();
    },
  };
}

after(async () => {
  await stopHostedTestRuntime();
});

const browserFixtureRepoPath = createCommittedGitFixture(
  path.join(process.cwd(), "fixtures", "browser-parity-app"),
  "speclens-api-learnables-browser-repo-",
);
const browserFixtureRepoUrl = toFileGitUrl(browserFixtureRepoPath);

test("hosted API filters default versus verbose logs and exposes replaced source learnables", async t => {
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
    location: browserFixtureRepoUrl,
  });
  const secondSource = await createSourceForUserForTests(workspace.id, user.id, {
    type: "git-public",
    displayName: "Second Browser fixture",
    location: browserFixtureRepoUrl,
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
  const learnablesPayload = learnablesResponse.json() as { learnables: Array<{ statement: string }> };
  assert.deepEqual(
    learnablesPayload.learnables.map(learnable => learnable.statement),
    ["Start the repository with npm run dev:web from . for start web."],
  );
});
