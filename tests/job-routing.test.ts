import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { analysisReportSummarySchema } from "@speclens/contracts";
import {
  addWorkspaceMember,
  createAgentJobForUser,
  createRemediationJobForUser,
  createSourceForUser,
  createWorkspaceForUser,
  getPrismaClient,
  getJobEnvelopeById,
  getWorkspaceDetailForUser,
  initializeDatabase,
  storeCodexTokens,
  storeUserCodexTokens,
  upsertUserIdentity,
} from "@speclens/db";
import { createHomeTempDirSync } from "@speclens/core";
import { createSourceForUserForTests } from "../packages/db/src/testing";
import {
  createTestDatabaseName,
  preparePrismaTestDatabase,
} from "./helpers/hosted-runtime";
import { createCommittedGitFixture, toFileGitUrl } from "./helpers/git-fixtures";

const staticFixtureRepoPath = createCommittedGitFixture(
  path.join(process.cwd(), "fixtures", "tagtwo-mini"),
  "speclens-job-routing-static-repo-",
);
const browserFixtureRepoPath = createCommittedGitFixture(
  path.join(process.cwd(), "fixtures", "browser-parity-app"),
  "speclens-job-routing-browser-repo-",
);
const staticFixtureRepoUrl = toFileGitUrl(staticFixtureRepoPath);
const browserFixtureRepoUrl = toFileGitUrl(browserFixtureRepoPath);

test("task-native standard analysis jobs use the unified agent runtime", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-"), "state.json");

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-static",
      email: "job-routing-static@speclens.dev",
      displayName: "Job Routing Static",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Static Fixture",
      location: staticFixtureRepoUrl,
    });

    const job = await createAgentJobForUser(workspace.id, user.id, "agent-universal-standard", {
      sourceId: source.id,
    });
    assert.equal(job.job.executionPath, "unified-agent");
    assert.equal(job.job.agentId, "agent-universal-standard");
  } finally {
    process.env = originalEnv;
  }
});

test("hosted source creation rejects local filesystem paths", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-invalid-source-"), "state.json");

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-invalid-source",
      email: "job-routing-invalid-source@speclens.dev",
      displayName: "Job Routing Invalid Source",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing Invalid Source Workspace",
    });

    await assert.rejects(
      () => createSourceForUser(workspace.id, user.id, {
        type: "git-public",
        displayName: "Invalid Hosted Source",
        location: path.join(process.cwd(), "fixtures", "tagtwo-mini"),
      }),
      /Public Git sources must use an https Git repository URL/i,
    );

    await assert.rejects(
      () => createSourceForUser(workspace.id, user.id, {
        type: "git-public",
        displayName: "Invalid File URL Source In Test Mode",
        location: staticFixtureRepoUrl,
      }),
      /Public Git sources must use an https Git repository URL/i,
    );

  } finally {
    process.env = originalEnv;
  }
});

test("hosted public Git sources reject unsupported remote hosts and ssh transports", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-invalid-remote-"), "state.json");

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-invalid-remote",
      email: "job-routing-invalid-remote@speclens.dev",
      displayName: "Job Routing Invalid Remote",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing Invalid Remote Workspace",
    });

    await assert.rejects(
      () => createSourceForUser(workspace.id, user.id, {
        type: "git-public",
        displayName: "Unsupported Host",
        location: "https://git.internal.example.com/org/repo.git",
      }),
      /Public Git sources must use an https Git repository URL/i,
    );

    await assert.rejects(
      () => createSourceForUser(workspace.id, user.id, {
        type: "git-public",
        displayName: "SSH Remote",
        location: "git@github.com:example/private-repo.git",
      }),
      /Public Git sources must use an https Git repository URL/i,
    );
  } finally {
    process.env = originalEnv;
  }
});

test("private GitHub sources require an installation that matches the repository owner", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-github-owner-"), "state.json");

  try {
    await initializeDatabase();
    const prisma = getPrismaClient();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-github-owner",
      email: "job-routing-github-owner@speclens.dev",
      displayName: "Job Routing GitHub Owner",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing GitHub Owner Workspace",
    });

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { entitlement: "pro" },
    });
    await prisma.githubInstallation.create({
      data: {
        id: "installation_mismatch",
        workspaceId: workspace.id,
        githubInstallationId: "12345",
        githubAccountLogin: "different-owner",
      },
    });

    await assert.rejects(
      () => createSourceForUser(workspace.id, user.id, {
        type: "github-private",
        displayName: "Mismatched private repo",
        location: "https://github.com/example/private-repo.git",
        githubInstallationId: "not-linked",
      }),
      /matching GitHub App installation/i,
    );
  } finally {
    process.env = originalEnv;
  }
});

test("agent-native jobs remain unified when no companion source is present", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-default-"), "state.json");

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-default",
      email: "job-routing-default@speclens.dev",
      displayName: "Job Routing Default",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing Default Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Default Fixture",
      location: staticFixtureRepoUrl,
    });

    const job = await createAgentJobForUser(workspace.id, user.id, "agent-universal-standard", {
      sourceId: source.id,
    });
    assert.equal(job.job.executionPath, "unified-agent");
    assert.equal(job.job.agentId, "agent-universal-standard");
  } finally {
    process.env = originalEnv;
  }
});

test("task-native browser analysis jobs can target the exhaustive bundle", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-browser-"), "state.json");

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-browser",
      email: "job-routing-browser@speclens.dev",
      displayName: "Job Routing Browser",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing Browser Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Browser Fixture",
      location: browserFixtureRepoUrl,
    });

    const job = await createAgentJobForUser(workspace.id, user.id, "agent-universal-exhaustive", {
      sourceId: source.id,
      runtimeMode: "browser",
    });
    assert.equal(job.job.executionPath, "unified-agent");
    assert.equal(job.job.agentId, "agent-universal-exhaustive");
  } finally {
    process.env = originalEnv;
  }
});

test("workspace detail filters historical jobs with invalid persisted companion source types", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-historical-job-"), "state.json");

  try {
    await initializeDatabase();
    const prisma = getPrismaClient();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-historical-job",
      email: "job-routing-historical-job@speclens.dev",
      displayName: "Job Routing Historical Job",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "Job Routing Legacy Job Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Legacy Job Fixture",
      location: staticFixtureRepoUrl,
    });

    await prisma.analysisJob.create({
      data: {
        id: "job_historical_invalid_companion",
        workspaceId: workspace.id,
        sourceId: source.id,
        companionSourceId: null,
        parentReportId: null,
        jobKind: "audit",
        status: "failed",
        agentId: "agent-universal-standard",
        sourceType: "git-public",
        sourceLocation: source.location,
        companionSourceType: "archive-public",
        companionSourceLocation: "https://example.com/archive.zip",
        rolesJson: [],
        runtimeMode: "static",
        secretRefsJson: [],
        requestedByUserId: user.id,
      },
    });

    const detail = await getWorkspaceDetailForUser(workspace.id, user.id);
    assert.equal(detail.jobs.length, 0);
  } finally {
    process.env = originalEnv;
  }
});

test("remediation jobs do not inherit another user's personal Codex auth binding", async () => {
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("jobrouting"));
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(createHomeTempDirSync("speclens-job-routing-remediation-auth-"), "state.json");
  process.env.APP_STATE_ENCRYPTION_KEY = "speclens-job-routing-remediation-auth-secret";

  try {
    await initializeDatabase();
    const prisma = getPrismaClient();
    const owner = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-remediation-owner",
      email: "job-routing-remediation-owner@speclens.dev",
      displayName: "Job Routing Remediation Owner",
    });
    const member = await upsertUserIdentity({
      provider: "local-dev",
      subject: "job-routing-remediation-member",
      email: "job-routing-remediation-member@speclens.dev",
      displayName: "Job Routing Remediation Member",
    });
    const workspace = await createWorkspaceForUser(owner, {
      name: "Job Routing Remediation Auth Workspace",
    });
    await addWorkspaceMember(workspace.id, owner.id, { email: member.email });
    const source = await createSourceForUserForTests(workspace.id, owner.id, {
      type: "git-public",
      displayName: "Remediation Auth Fixture",
      location: staticFixtureRepoUrl,
    });

    await storeUserCodexTokens(member.id, {
      accessToken: "member.header.payload.signature",
      refreshToken: null,
      idToken: null,
      accountId: "member-account",
    });
    await storeCodexTokens({
      accessToken: "global.header.payload.signature",
      refreshToken: null,
      idToken: null,
      accountId: "global-account",
    });

    const memberJob = await createAgentJobForUser(workspace.id, member.id, "agent-universal-standard", {
      sourceId: source.id,
      codexAuthScope: "user",
    });
    assert.equal(memberJob.job.codexAuthScope, "user");

    const reportId = "report_remediation_auth_scope";
    await prisma.analysisJob.update({
      where: { id: memberJob.job.id },
      data: {
        reportId,
        status: "succeeded",
      },
    });
    await prisma.analysisReport.create({
      data: {
        id: reportId,
        workspaceId: workspace.id,
        jobId: memberJob.job.id,
        status: "ready",
        rolesJson: [],
        runtimeMode: "static",
        title: "Remediation auth scope report",
        summaryJson: analysisReportSummarySchema.parse({
          totalFindings: 0,
          high: 0,
          medium: 0,
          low: 0,
        }),
        findingsJson: [],
        sectionsJson: [],
      },
    });

    const remediationJob = await createRemediationJobForUser(reportId, owner.id, {
      sourceId: source.id,
      baseRef: "HEAD",
      selectionMode: "auto-priority",
      selectedFindingIds: [],
      maxIterations: 2,
      outputMode: "changeset",
      publishRemote: false,
    });
    assert.equal(remediationJob.job.codexAuthScope, "global");

    const persisted = await getJobEnvelopeById(remediationJob.job.id);
    assert.equal(persisted.job.codexAuthScope, "global");
    const remediationRecord = await prisma.analysisJob.findUnique({
      where: { id: remediationJob.job.id },
      select: { metadataJson: true },
    });
    assert.deepEqual(remediationRecord?.metadataJson, {
      codexAuth: {
        scope: "global",
        recordId: "codex:global",
      },
      remediation: {
        reportId,
        sourceId: source.id,
        baseRef: "HEAD",
        selectionMode: "auto-priority",
        selectedFindingIds: [],
        maxIterations: 2,
        outputMode: "changeset",
        publishRemote: false,
        changeset: null,
      },
    });
  } finally {
    process.env = originalEnv;
  }
});
