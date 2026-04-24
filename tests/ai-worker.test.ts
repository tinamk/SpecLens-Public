import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { createHomeTempDirSync } from "@speclens/core";
import { parseAnalysisExecutionStepEvent, standardizedAgentHandoffSchema } from "@speclens/contracts";
import {
  createAgentJobForUser,
  createAiAgent,
  createWorkspaceForUser,
  createWorkspaceSecretForUser,
  getJobEnvelopeForUser,
  initializeDatabase,
  listActiveSourceLearnables,
  listAiAgents,
  resolveObjectStoragePath,
  upsertUserIdentity,
} from "@speclens/db";
import aiWorker from "../apps/ai-worker/src/services/worker";
import { createSourceForUserForTests } from "../packages/db/src/testing";
import { createCommittedGitFixture, toFileGitUrl } from "./helpers/git-fixtures";
import { ensureTestAuthSecrets } from "./helpers/portal-auth";
import {
  createTestDatabaseName,
  preparePrismaTestDatabase,
  stopHostedTestRuntime,
} from "./helpers/hosted-runtime";

after(async () => {
  await stopHostedTestRuntime();
});

const browserFixtureRepoPath = createCommittedGitFixture(
  path.join(process.cwd(), "fixtures", "browser-parity-app"),
  "speclens-ai-worker-browser-repo-",
);
const browserFixtureRepoUrl = toFileGitUrl(browserFixtureRepoPath);

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
    "if (!outputPath) {",
    "  console.error('Missing --output-last-message');",
    "  process.exit(2);",
    "}",
    "const roleId = /role-(.+)\\.json$/.exec(outputPath)?.[1] ?? 'unknown';",
    "let payload;",
    "if (roleId === 'runtime-scout') {",
    "  payload = {",
    "    summary: 'Runtime contract identified',",
    "    sections: [{",
    "      title: 'Runtime scout',",
    "      status: 'ready',",
    "      summary: 'Structured runtime contract prepared.',",
    "      data: {",
    "        installCommands: [{ label: 'install', command: 'npm install', workingDirectory: '.', purpose: 'deps' }],",
    "        buildCommands: [],",
    "        startCommands: [{ label: 'compose stack', command: 'npm run dev:compose', workingDirectory: '.', purpose: 'start full stack' }, { label: 'web', command: 'npm run start', workingDirectory: '.', purpose: 'start web' }],",
    "        verificationCommands: [{ label: 'typecheck', command: 'npm run typecheck', workingDirectory: '.', purpose: 'verify' }],",
    "        packageManagers: ['npm'],",
    "        targets: [{ label: 'compose stack', kind: 'web', workingDirectory: '.', startCommand: 'npm run dev:compose', baseUrl: null, healthUrls: [], framework: 'docker-compose' }, { label: 'web', kind: 'web', workingDirectory: '.', startCommand: 'npm run start', baseUrl: 'http://127.0.0.1:4173', healthUrls: ['http://127.0.0.1:4173'], framework: 'node' }],",
    "        workingDirectories: ['.'],",
    "        serviceDependencies: [],",
    "        envFiles: [],",
    "        ports: [4173],",
    "        baseUrls: ['http://127.0.0.1:4173'],",
    "      },",
    "    }],",
    "    findings: [{ severity: 'low', title: 'Stub finding runtime-scout', message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['package.json'] }],",
    "  };",
    "} else if (roleId === 'auth-cartographer') {",
    "  payload = {",
    "    summary: 'Auth map identified',",
    "    sections: [{",
    "      title: 'Auth map',",
    "      status: 'ready',",
    "      summary: 'Structured auth data prepared.',",
    "      data: {",
    "        frontend: { strategy: 'form-login', loginRoutes: ['/login'], callbackRoutes: [], protectedRoutes: ['/secure'], secretRefs: ['Demo credentials'], bootstrapSteps: ['Open the login route.'], userActions: ['Complete sign-in.'] },",
    "        api: { strategy: 'none', loginRoutes: [], callbackRoutes: [], protectedRoutes: [], secretRefs: [], bootstrapSteps: [], userActions: [] },",
    "      },",
    "    }],",
    "    findings: [{ severity: 'low', title: 'Stub finding auth-cartographer', message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['server.mjs'] }],",
    "  };",
    "} else if (roleId === 'navigation-qa-planner') {",
    "  payload = {",
    "    summary: 'Navigation QA plan prepared',",
    "    sections: [{",
    "      title: 'Navigation QA plan',",
    "      status: 'ready',",
    "      summary: 'Route and journey coverage prepared.',",
    "      data: {",
    "        navigationTargets: [{ path: '/', purpose: 'home', requiresAuth: false, source: 'router' }, { path: '/settings', purpose: 'settings', requiresAuth: false, source: 'router' }, { path: '/secure', purpose: 'secure workspace', requiresAuth: true, source: 'router' }, { path: '/broken', purpose: 'console error route', requiresAuth: false, source: 'router' }, { path: '/portal/:path* (middleware redirect to /api/auth/login when session cookie is missing)', purpose: 'route pattern', requiresAuth: true, source: 'docs' }, { path: '/workspaces/[workspaceId]', purpose: 'dynamic route pattern', requiresAuth: true, source: 'router' }, { path: '/api/status', purpose: 'api health', requiresAuth: false, source: 'docs' }],",
    "        journeys: [{ title: 'Login and inspect secure workspace', steps: ['Open /login', 'Submit credentials', 'Open /secure'], requiresAuth: true, priority: 'high', successSignals: ['Secure workspace heading visible'] }],",
    "        assertions: ['Home page loads with an h1.', 'Secure workspace is reachable after login.', 'Console errors are captured when they occur.'],",
    "        detectedSurfaces: [{ label: 'Fixture app', kind: 'repo-app', location: '.', companion: false, confidence: 'high' }],",
    "      },",
    "    }],",
    "    findings: [{ severity: 'low', title: 'Stub finding navigation-qa-planner', message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['server.mjs'] }],",
    "  };",
    "} else if (roleId === 'playwright-operator') {",
    "  payload = {",
    "    summary: 'Playwright operator plan prepared',",
    "    sections: [{",
    "      title: 'Playwright operator plan',",
    "      status: 'ready',",
    "      summary: 'Playwright coverage metadata prepared.',",
    "      data: {",
    "        readiness: 'partial',",
    "        present: false,",
    "        packageManager: 'npm',",
    "        configPaths: [],",
    "        setupCommands: [],",
    "        commands: [],",
    "        workingDirectories: ['.'],",
    "        baseUrlStrategy: 'PLAYWRIGHT_BASE_URL',",
    "        authStrategy: 'login via credential form',",
    "        testTargets: ['browser fixture crawl'],",
    "        reporters: [],",
    "        artifacts: ['browser screenshots', 'trace', 'storage state'],",
    "        prerequisites: ['Runtime target must be reachable on the documented base URL.'],",
    "        coverageGaps: ['No repository-native Playwright suite is present in the fixture app.'],",
    "      },",
    "    }],",
    "    findings: [{ severity: 'low', title: 'Stub finding playwright-operator', message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['package.json'] }],",
    "  };",
    "} else if (roleId === 'artifact-auditor') {",
    "  payload = {",
    "    summary: 'Artifact expectations prepared',",
    "    sections: [{",
    "      title: 'Artifact expectations',",
    "      status: 'ready',",
    "      summary: 'Browser artifact expectations prepared.',",
    "      data: {",
    "        artifactExpectations: [{ kind: 'screenshot', required: true, detail: 'Representative page screenshots', sourcePath: 'generated/browser' }, { kind: 'trace', required: true, detail: 'Browser trace', sourcePath: 'generated/browser' }],",
    "      },",
    "    }],",
    "    findings: [{ severity: 'low', title: 'Stub finding artifact-auditor', message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['README.md'] }],",
    "  };",
    "} else if (roleId === 'release-gate-scorer') {",
    "  payload = {",
    "    summary: 'Release gate prepared',",
    "    sections: [{",
    "      title: 'Release gate recommendation',",
    "      status: 'ready',",
    "      summary: 'Bundle recommendation prepared.',",
    "      data: {",
    "        releaseGateDecision: { status: 'warn', reason: 'Browser execution evidence still needs to run.', confidence: 'medium', blockingFindingIds: [] },",
    "      },",
    "    }],",
    "    findings: [{ severity: 'low', title: 'Stub finding release-gate-scorer', message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['README.md'] }],",
    "  };",
    "} else {",
    "  payload = {",
    "    summary: `Stub summary for ${roleId}`,",
    "    sections: [{ title: `Stub section ${roleId}`, status: 'ready', summary: 'ok', data: { roleId } }],",
    "    findings: [{ severity: 'low', title: `Stub finding ${roleId}`, message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['README.md'] }],",
    "  };",
    "}",
    "fs.writeFileSync(outputPath, JSON.stringify(payload));",
  ].join("\n");
  fs.writeFileSync(stubPath, script, { encoding: "utf8" });
  fs.chmodSync(stubPath, 0o755);
}

function writeFailingCodexStub(stubPath: string, failingRoleId: string): void {
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
    "if (!outputPath) {",
    "  console.error('Missing --output-last-message');",
    "  process.exit(2);",
    "}",
    "const roleId = /role-(.+)\\.json$/.exec(outputPath)?.[1] ?? 'unknown';",
    `if (roleId === ${JSON.stringify(failingRoleId)}) {`,
    "  console.error(`Intentional role failure for ${roleId}`);",
    "  process.exit(17);",
    "}",
    "fs.writeFileSync(outputPath, JSON.stringify({",
    "  summary: `Fallback summary for ${roleId}`,",
    "  sections: [{ title: `Fallback section ${roleId}`, status: 'ready', summary: 'ok', data: { roleId } }],",
    "  findings: [],",
    "}));",
  ].join("\n");
  fs.writeFileSync(stubPath, script, { encoding: "utf8" });
  fs.chmodSync(stubPath, 0o755);
}

function writeFlakyJsonCodexStub(stubPath: string, flakyRoleId: string): void {
  const markerPath = `${stubPath}.attempts`;
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
    "if (!outputPath) {",
    "  console.error('Missing --output-last-message');",
    "  process.exit(2);",
    "}",
    "const roleId = /role-(.+)\\.json$/.exec(outputPath)?.[1] ?? 'unknown';",
    `const flakyRoleId = ${JSON.stringify(flakyRoleId)};`,
    `const markerPath = ${JSON.stringify(markerPath)};`,
    "if (roleId === flakyRoleId) {",
    "  const attempts = fs.existsSync(markerPath) ? Number(fs.readFileSync(markerPath, 'utf8')) : 0;",
    "  fs.writeFileSync(markerPath, String(attempts + 1));",
    "  if (attempts === 0) {",
    "    fs.writeFileSync(outputPath, '{\"summary\":\"broken\",\"sections\": [');",
    "    process.exit(0);",
    "  }",
    "}",
    "fs.writeFileSync(outputPath, JSON.stringify({",
    "  summary: `Recovered summary for ${roleId}`,",
    "  sections: [{ title: `Recovered section ${roleId}`, status: 'ready', summary: 'ok', data: { roleId } }],",
    "  findings: [{ severity: 'low', title: `Recovered finding ${roleId}`, message: 'Stub message', suggestion: 'Stub suggestion', evidence: ['README.md'] }],",
    "}));",
  ].join("\n");
  fs.writeFileSync(stubPath, script, { encoding: "utf8" });
  fs.chmodSync(stubPath, 0o755);
}

function readPromptCapture(capturePath: string): Array<{ roleId: string; roleName: string; prompt: string }> {
  if (!fs.existsSync(capturePath)) {
    return [];
  }
  return fs.readFileSync(capturePath, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as { roleId: string; roleName: string; prompt: string });
}

test("ai-worker persists learnables and injects them into follow-up runtime agent runs", async () => {
  const tempRoot = createHomeTempDirSync("speclens-ai-worker-");
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("aiworker"));
  const stubPath = path.join(tempRoot, "codex-stub.js");
  const promptCapturePath = path.join(tempRoot, "prompt-capture.jsonl");
  writeCodexStub(stubPath);

  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  ensureTestAuthSecrets();
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(tempRoot, "state.json");
  process.env.CODEX_BIN = stubPath;
  process.env.AI_WORKER_TEMP_ROOT = path.join(tempRoot, "worker");
  process.env.AI_WORKER_CODEX_TIMEOUT_MS = "10000";
  process.env.AI_WORKER_PROMPT_CAPTURE_PATH = promptCapturePath;

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "ai-worker-test",
      email: "ai-worker-test@speclens.dev",
      displayName: "AI Worker Test",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "AI Worker Test Workspace",
    });
    const secret = await createWorkspaceSecretForUser(workspace.id, user.id, {
      name: "Demo credentials",
      kind: "credential-pair",
      value: JSON.stringify({ username: "demo", password: "secret" }),
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Fixture Repo",
      location: browserFixtureRepoUrl,
    });
    const agents = await listAiAgents();
    assert.ok(agents.length > 0, "Expected at least one seeded AI agent.");
    const runtimeAgent = agents.find(agent => agent.id === "agent-universal-standard");
    assert.ok(runtimeAgent, "Expected the universal audit standard agent to be seeded.");
    const fastToolingAgent = agents.find(agent => agent.id === "agent-e2e-runtime-tooling-fast");
    assert.ok(fastToolingAgent, "Expected the runtime tooling fast agent to be seeded.");
    assert.deepEqual(
      fastToolingAgent.roles.map(role => role.id),
      [
        "runtime-scout",
        "browser-executor",
        "playwright-operator",
        "artifact-auditor",
        "standardized-json-output",
      ],
    );
    const agentId = runtimeAgent?.id ?? agents[0]?.id ?? "agent-universal-exhaustive";
    const firstJob = await createAgentJobForUser(workspace.id, user.id, agentId, {
      sourceId: source.id,
      secretRefs: [secret.id],
    });

    const firstResult = await aiWorker.runAgentJobForTest(firstJob.job.id);
    assert.equal(firstResult.job.status, "succeeded");
    assert.ok(firstResult.report, "Expected a report to be persisted.");
    assert.ok(firstResult.report?.findings.length, "Expected at least one finding from the stub.");
    assert.ok(firstResult.report?.roles.length, "Expected role definitions on the report.");
    assert.deepEqual(
      firstResult.report?.roles.map(role => role.id),
      [
        "source-topology-scout",
        "runtime-scout",
        "auth-cartographer",
        "live-surface-resolver",
        "license-governor",
        "dependency-risk-reviewer",
        "architecture-reviewer",
        "code-health-reviewer",
        "component-cartographer",
        "design-system-auditor",
        "copy-consistency-auditor",
        "accessibility-auditor",
        "navigation-qa-planner",
        "browser-executor",
        "playwright-operator",
        "visual-qa-critic",
        "ux-friction-reviewer",
        "cross-surface-consistency-reviewer",
        "artifact-auditor",
        "remediation-planner",
        "release-gate-scorer",
        "standardized-json-output",
      ],
    );
    assert.equal(firstResult.report?.summary.auditBundleId, "standard");
    assert.equal(Boolean(firstResult.report?.summary.releaseGateDecision), true);
    assert.equal((firstResult.report?.summary.remediationPacks.length ?? 0) > 0, true);
    assert.ok(firstResult.report?.summary.qualityScorecard, "Expected a computed quality scorecard.");
    assert.equal((firstResult.report?.summary.qualityScorecard?.overallScore ?? 0) > 0, true);
    assert.ok(
      firstResult.report?.summary.qualityScorecard?.roleScores.some(role => role.roleId === "runtime-scout" && role.status === "ready"),
      "Expected role scorecard to mark runtime-scout contract ready.",
    );
    assert.ok(firstResult.report?.summary.artifactAnalysis, "Expected artifact analysis in the report summary.");
    assert.equal((firstResult.report?.summary.artifactAnalysis?.producedCount ?? 0) >= 0, true);
    assert.ok(Array.isArray(firstResult.report?.summary.capabilityGaps), "Expected capability gap analysis on the report summary.");
    assert.ok((firstResult.report?.summary.executionSteps.length ?? 0) > 0, "Expected persisted execution steps in the report summary.");
    assert.equal(firstResult.report?.summary.executionSteps.some(step => step.agentId === agentId), true);
    assert.equal(firstResult.report?.summary.executionSteps.some(step => step.executorKind === "native"), true);
    const artifactBasenames = new Set((firstResult.report?.artifacts ?? []).map(artifact => path.posix.basename(artifact.key)));
    assert.ok(artifactBasenames.has(`${firstJob.job.id}.generated-spec-pack.json`), "Expected a generated spec pack artifact.");
    assert.ok(artifactBasenames.has("report.json"), "Expected a report.json artifact.");
    assert.ok(artifactBasenames.has("report.md"), "Expected a report.md artifact.");
    assert.ok(artifactBasenames.has("report.html"), "Expected a report.html artifact.");
    const standardizedSection = firstResult.report?.sections.find(section => section.title === "Standardized JSON handoff");
    assert.ok(standardizedSection, "Expected a standardized JSON handoff section.");
    assert.equal((standardizedSection?.data.standardizedOutput as { schemaVersion?: string } | undefined)?.schemaVersion, "speclens.agent-handoff.v1");
    const roleContractSection = firstResult.report?.sections.find(section => section.title === "Role contract audit");
    assert.ok(roleContractSection, "Expected a role contract audit section.");
    assert.equal(
      ((roleContractSection?.data.roleContracts as Array<{ roleId?: string; status?: string }> | undefined) ?? [])
        .some(contract => contract.roleId === "runtime-scout" && contract.status === "ready"),
      true,
      "Expected role contract audit to include ready runtime-scout coverage.",
    );
    const runtimeExecutionSection = firstResult.report?.sections.find(section => section.title === "Runtime execution");
    assert.equal(runtimeExecutionSection?.status, "ready");
    assert.equal(
      (runtimeExecutionSection?.data.target as { startCommand?: string } | undefined)?.startCommand,
      "npm run start",
      "Expected hosted runtime execution to prefer the direct app script over compose/infra targets.",
    );
    const browserExecutionSection = firstResult.report?.sections.find(section => section.title === "Browser QA execution");
    assert.equal(browserExecutionSection?.status, "ready");
    assert.equal(Array.isArray((browserExecutionSection?.data.pages as unknown[] | undefined)), true);
    assert.equal((browserExecutionSection?.data.authenticated as boolean | undefined), true);
    const browserNavigationTargets = (browserExecutionSection?.data.navigationTargets as string[] | undefined) ?? [];
    assert.equal(
      browserNavigationTargets.some(target => target.includes(":path") || target.includes("[workspaceId]") || target.includes("/api/status")),
      false,
      "Expected hosted browser QA to skip API endpoints and unresolved route patterns.",
    );
    const skippedNavigationTargets = (browserExecutionSection?.data.skippedNavigationTargets as Array<{ reason?: string }> | undefined) ?? [];
    assert.equal(
      skippedNavigationTargets.some(target => target.reason === "unresolved route pattern"),
      true,
      "Expected hosted browser QA to explain skipped route patterns.",
    );
    const executionAttributedFindings = (firstResult.report?.findings ?? []).filter(finding =>
      finding.title.includes("Runtime execution")
      || finding.title.includes("Browser ")
      || finding.title.includes("HTTP failure")
      || finding.title.includes("Console error")
      || finding.title.includes("Request failure")
      || finding.title.includes("Visited page"),
    );
    assert.equal(executionAttributedFindings.every(finding => finding.sourceIds.includes(source.id)), true);
    assert.ok(
      (firstResult.report?.artifacts ?? []).some(artifact => artifact.mimeType === "image/png"),
      "Expected browser screenshot artifacts from hosted execution.",
    );
    assert.ok(
      (firstResult.report?.artifacts ?? []).some(artifact => artifact.key.endsWith("browser-trace.zip")),
      "Expected a browser trace artifact from hosted execution.",
    );

    const firstEnvelope = await getJobEnvelopeForUser(firstJob.job.id, user.id);
    assert.ok((firstEnvelope.report?.artifacts.length ?? 0) >= 4, "Expected persisted agent artifacts on the job envelope.");
    assert.equal(firstEnvelope.logs.some(log => log.scope === "learnables" && log.message.includes("Stored")), true);
    assert.ok(firstEnvelope.timing.estimatedTotalMs !== null, "Expected a job timing estimate on the envelope.");
    assert.ok(firstEnvelope.timing.elapsedMs >= 0, "Expected non-negative elapsed job timing.");
    assert.ok(firstEnvelope.qualityScorecard, "Expected the envelope to expose the quality scorecard.");
    assert.ok(firstEnvelope.artifactAnalysis, "Expected the envelope to expose artifact analysis.");
    assert.ok(firstEnvelope.executionSteps.length > 0, "Expected execution steps on the job envelope.");
    assert.equal(firstEnvelope.executionSteps.some(step => step.roleId === "browser-executor"), true);

    const storedLearnables = await listActiveSourceLearnables(source.id);
    assert.ok(storedLearnables.length > 0, "Expected learnables to be synthesized after the first runtime run.");

    const runtimeScoutRole = runtimeAgent.roles.find(role => role.id === "runtime-scout");
    assert.ok(runtimeScoutRole, "Expected the universal audit standard agent to include the runtime-scout role.");
    const learnablesProbeAgent = await createAiAgent({
      name: "Learnables runtime-scout probe",
      description: "Minimal follow-up agent for learnables prompt injection coverage.",
      roleIds: [runtimeScoutRole?.id ?? "runtime-scout"],
    });

    fs.writeFileSync(promptCapturePath, "", "utf8");
    const secondJob = await createAgentJobForUser(workspace.id, user.id, learnablesProbeAgent.id, {
      sourceId: source.id,
      secretRefs: [secret.id],
    });
    const secondResult = await aiWorker.runAgentJobForTest(secondJob.job.id);
    assert.equal(secondResult.job.status, "succeeded");

    const capturedPrompts = readPromptCapture(promptCapturePath);
    const runtimeScoutPrompt = capturedPrompts.find(item => item.roleId === "runtime-scout");
    assert.ok(runtimeScoutPrompt, "Expected the second run to capture the runtime-scout prompt.");
    assert.equal(runtimeScoutPrompt?.prompt.includes("Active source learnables (JSON):"), true);
    assert.equal(runtimeScoutPrompt?.prompt.includes("Role output contract:"), true);
    assert.equal(runtimeScoutPrompt?.prompt.includes("Required section title: Runtime scout"), true);
    assert.equal(runtimeScoutPrompt?.prompt.includes("Required data keys in that section: packageManagers, workingDirectories, targets"), true);
    assert.equal(
      runtimeScoutPrompt?.prompt.includes(storedLearnables[0]?.statement ?? ""),
      true,
      "Expected a persisted learnable statement to be injected into the follow-up prompt.",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("ai-worker detects nested Playwright setups and package managers for preflight", () => {
  const repoRoot = createHomeTempDirSync("speclens-playwright-preflight-");
  const appDir = path.join(repoRoot, "apps", "portal");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({
      name: "portal",
      scripts: {
        "e2e:local": "playwright test",
      },
    }, null, 2),
    "utf8",
  );
  fs.writeFileSync(path.join(appDir, "playwright.config.ts"), "export default {};\n", "utf8");

  const plan = (
    aiWorker as typeof aiWorker & {
      detectPlaywrightPreflightForTest: (repoPath: string) => {
        packageManager: string;
        source: string;
        label: string;
        command: string;
        workingDirectory: string;
      } | null;
    }
  ).detectPlaywrightPreflightForTest(repoRoot);
  assert.ok(plan, "Expected a nested Playwright setup to be detected.");
  assert.equal(plan?.packageManager, "pnpm");
  assert.equal(plan?.source, "package-script");
  assert.equal(plan?.label, "e2e:local");
  assert.equal(plan?.command, "pnpm e2e:local -- --list");
  assert.equal(plan?.workingDirectory, appDir);
});

test("ai-worker detects Playwright wrapper scripts for preflight", () => {
  const repoRoot = createHomeTempDirSync("speclens-playwright-wrapper-");
  const scriptsDir = path.join(repoRoot, "scripts", "e2e");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      name: "wrapper-app",
      scripts: {
        "e2e:production": "node scripts/e2e/run-production.mjs tests/e2e/public-site.spec.ts",
      },
    }, null, 2),
    "utf8",
  );
  fs.writeFileSync(path.join(repoRoot, "playwright.config.ts"), "export default {};\n", "utf8");
  fs.writeFileSync(
    path.join(scriptsDir, "run-production.mjs"),
    [
      "const playwrightArgs = ['playwright', 'test', ...process.argv.slice(2)];",
      "console.log(playwrightArgs.join(' '));",
    ].join("\n"),
    "utf8",
  );

  const plan = (
    aiWorker as typeof aiWorker & {
      detectPlaywrightPreflightForTest: (repoPath: string) => {
        packageManager: string;
        source: string;
        label: string;
        command: string;
        workingDirectory: string;
        configPath: string | null;
      } | null;
    }
  ).detectPlaywrightPreflightForTest(repoRoot);
  assert.ok(plan, "Expected a Playwright wrapper script to be detected.");
  assert.equal(plan?.packageManager, "npm");
  assert.equal(plan?.source, "package-script");
  assert.equal(plan?.label, "e2e:production");
  assert.equal(plan?.command, "npm run e2e:production -- --list");
  assert.equal(plan?.workingDirectory, repoRoot);
  assert.equal(plan?.configPath, "playwright.config.ts");
});

test("ai-worker treats optional Playwright artifacts as non-blocking in artifact analysis", () => {
  const analysis = (
    aiWorker as typeof aiWorker & {
      buildArtifactAnalysisForTest: (
        handoff: ReturnType<typeof standardizedAgentHandoffSchema.parse>,
        artifacts: Array<{ kind: string; key: string; sizeBytes: number; mimeType: string; bucket: string; region: string }>,
      ) => {
        expectedKinds: string[];
        missingKinds: string[];
      };
    }
  ).buildArtifactAnalysisForTest(
    standardizedAgentHandoffSchema.parse({
      schemaVersion: "speclens.agent-handoff.v1",
      generatedBy: {
        agentId: "agent-test",
        agentName: "Test Agent",
        roleId: "role-test",
        roleName: "Test Role",
      },
      runtime: {},
      auth: {
        frontend: {},
        api: {},
      },
      playwright: {},
      artifactExpectations: [
        { kind: "validation-log", label: "Playwright preflight log", required: true },
        { kind: "playwright-report", label: "HTML Playwright report", required: false },
        { kind: "test-results", label: "Playwright test results", required: false },
      ],
    }),
    [],
  );

  assert.deepEqual(analysis.expectedKinds, ["validation-log", "playwright-report", "test-results"]);
  assert.deepEqual(analysis.missingKinds, ["validation-log"]);
});

test("ai-worker keeps smoke-agent handoff synthesis deterministic without hosted execution follow-up", async () => {
  const tempRoot = createHomeTempDirSync("speclens-ai-worker-smoke-");
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("aiworkersmoke"));
  const stubPath = path.join(tempRoot, "codex-stub.js");
  writeCodexStub(stubPath);

  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  ensureTestAuthSecrets();
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(tempRoot, "state.json");
  process.env.CODEX_BIN = stubPath;
  process.env.AI_WORKER_TEMP_ROOT = path.join(tempRoot, "worker");
  process.env.AI_WORKER_CODEX_TIMEOUT_MS = "10000";

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "ai-worker-smoke-test",
      email: "ai-worker-smoke-test@speclens.dev",
      displayName: "AI Worker Smoke Test",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "AI Worker Smoke Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Fixture Repo",
      location: browserFixtureRepoUrl,
    });
    const smokeJob = await createAgentJobForUser(workspace.id, user.id, "agent-universal-smoke", {
      sourceId: source.id,
    });

    const result = await aiWorker.runAgentJobForTest(smokeJob.job.id);
    assert.equal(result.job.status, "succeeded");
    assert.ok(result.report, "Expected a smoke-agent report.");
    assert.ok(
      result.report?.sections.some(section => section.title === "Standardized JSON handoff"),
      "Expected the deterministic standardized handoff to remain present for smoke-agent runs.",
    );
    assert.equal(
      result.report?.sections.some(section => section.title === "Runtime execution"),
      false,
      "Smoke-agent runs should not execute hosted runtime follow-up.",
    );
    assert.equal(
      result.report?.sections.some(section => section.title === "Browser QA execution"),
      false,
      "Smoke-agent runs should not execute hosted browser follow-up.",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("ai-worker persists execution diagnostics when a role fails", async () => {
  const tempRoot = createHomeTempDirSync("speclens-ai-worker-failure-");
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("aiworkerfailure"));
  const stubPath = path.join(tempRoot, "codex-failing-stub.js");
  writeFailingCodexStub(stubPath, "runtime-scout");

  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  ensureTestAuthSecrets();
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(tempRoot, "state.json");
  process.env.CODEX_BIN = stubPath;
  process.env.AI_WORKER_TEMP_ROOT = path.join(tempRoot, "worker");
  process.env.AI_WORKER_CODEX_TIMEOUT_MS = "10000";

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "ai-worker-failure-test",
      email: "ai-worker-failure-test@speclens.dev",
      displayName: "AI Worker Failure Test",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "AI Worker Failure Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Fixture Repo",
      location: browserFixtureRepoUrl,
    });
    const runtimeAgent = (await listAiAgents()).find(agent => agent.id === "agent-universal-standard");
    const runtimeScoutRole = runtimeAgent?.roles.find(role => role.id === "runtime-scout");
    assert.ok(runtimeScoutRole, "Expected the universal audit standard agent to include the runtime-scout role.");
    const failureProbeAgent = await createAiAgent({
      name: "Failure diagnostics runtime-scout probe",
      description: "Minimal agent for failed role diagnostics coverage.",
      roleIds: [runtimeScoutRole?.id ?? "runtime-scout"],
    });
    const failureJob = await createAgentJobForUser(workspace.id, user.id, failureProbeAgent.id, {
      sourceId: source.id,
    });

    const result = await aiWorker.runAgentJobForTest(failureJob.job.id);
    assert.equal(result.job.status, "failed");
    assert.match(result.job.failureReason ?? "", /Runtime scout failed: Intentional role failure for runtime-scout/);

    const envelope = await getJobEnvelopeForUser(failureJob.job.id, user.id, { logVisibility: "all" });
    assert.equal(
      envelope.executionSteps.some(step => step.id === "stage:materialize-source" && step.status === "succeeded"),
      true,
      "Expected materialization telemetry to remain on failed jobs.",
    );
    assert.equal(
      envelope.executionSteps.some(step => step.id === "role:runtime-scout" && step.status === "failed"),
      true,
      "Expected failed role telemetry to remain on failed jobs.",
    );
    const diagnosticArtifact = envelope.artifacts.find(artifact => artifact.key.endsWith("agent-failure.json"));
    assert.ok(diagnosticArtifact, "Expected failed agent jobs to persist a diagnostic artifact.");
    assert.equal(diagnosticArtifact?.kind, "runtime-log");
    const diagnosticPath = resolveObjectStoragePath({
      objectStorageProvider: "local",
      objectStorageBucket: null,
      objectStorageEndpoint: null,
      objectStoragePublicEndpoint: null,
      objectStorageRegion: null,
      objectStorageForcePathStyle: false,
    }, diagnosticArtifact?.key ?? "");
    const diagnosticPayload = JSON.parse(fs.readFileSync(diagnosticPath, "utf8")) as {
      schemaVersion?: string;
      jobId?: string;
      status?: string;
      failureReason?: string;
      executionSteps?: Array<{ id?: string; status?: string }>;
      logs?: Array<{ scope?: string; message?: string }>;
    };
    assert.equal(diagnosticPayload.schemaVersion, "speclens.agent-failure.v1");
    assert.equal(diagnosticPayload.jobId, failureJob.job.id);
    assert.equal(diagnosticPayload.status, "failed");
    assert.match(diagnosticPayload.failureReason ?? "", /Intentional role failure for runtime-scout/);
    assert.equal(
      diagnosticPayload.executionSteps?.some(step => step.id === "role:runtime-scout" && step.status === "failed"),
      true,
    );
    assert.equal(
      diagnosticPayload.logs?.some(log => log.scope === "agent" && (log.message ?? "").includes("Runtime scout failed")),
      true,
    );
  } finally {
    process.env = originalEnv;
  }
});

test("ai-worker retries invalid Codex role JSON before accepting role execution", async () => {
  const tempRoot = createHomeTempDirSync("speclens-ai-worker-flaky-json-");
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("aiworkerflakyjson"));
  const stubPath = path.join(tempRoot, "codex-flaky-json-stub.js");
  writeFlakyJsonCodexStub(stubPath, "architecture-reviewer");

  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  ensureTestAuthSecrets();
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(tempRoot, "state.json");
  process.env.CODEX_BIN = stubPath;
  process.env.AI_WORKER_TEMP_ROOT = path.join(tempRoot, "worker");
  process.env.AI_WORKER_CODEX_TIMEOUT_MS = "10000";
  process.env.AI_WORKER_CODEX_MAX_ATTEMPTS = "2";
  process.env.AI_WORKER_CODEX_RETRY_DELAY_MS = "1";

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "ai-worker-flaky-json-test",
      email: "ai-worker-flaky-json-test@speclens.dev",
      displayName: "AI Worker Flaky JSON Test",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "AI Worker Flaky JSON Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Fixture Repo",
      location: browserFixtureRepoUrl,
    });
    const runtimeAgent = (await listAiAgents()).find(agent => agent.id === "agent-universal-standard");
    const architectureRole = runtimeAgent?.roles.find(role => role.id === "architecture-reviewer");
    assert.ok(architectureRole, "Expected the universal audit standard agent to include the architecture-reviewer role.");
    const retryProbeAgent = await createAiAgent({
      name: "Flaky JSON role retry probe",
      description: "Minimal agent for invalid role artifact retry coverage.",
      roleIds: [architectureRole?.id ?? "architecture-reviewer"],
    });
    const retryJob = await createAgentJobForUser(workspace.id, user.id, retryProbeAgent.id, {
      sourceId: source.id,
    });

    const result = await aiWorker.runAgentJobForTest(retryJob.job.id);
    assert.equal(result.job.status, "succeeded");
    assert.equal(fs.readFileSync(`${stubPath}.attempts`, "utf8"), "2");

    const envelope = await getJobEnvelopeForUser(retryJob.job.id, user.id, { logVisibility: "all" });
    assert.equal(
      envelope.logs.some(log =>
        log.scope === "agent"
        && (log.message ?? "").includes("emitted invalid role output on attempt 1/2")),
      true,
      "Expected invalid role JSON to be retried and logged.",
    );
    assert.equal(
      envelope.executionSteps.some(step => step.id === "role:architecture-reviewer" && step.status === "succeeded"),
      true,
      "Expected the retried role to succeed after valid JSON is emitted.",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("ai-worker keeps quiet roles out of the default console but exposes them in verbose logs", async () => {
  const tempRoot = createHomeTempDirSync("speclens-ai-worker-");
  const databaseUrl = await preparePrismaTestDatabase(createTestDatabaseName("aiworker"));
  const stubPath = path.join(tempRoot, "codex-stub.js");
  writeCodexStub(stubPath);

  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  ensureTestAuthSecrets();
  process.env.OBJECT_STORAGE_PROVIDER = "local";
  process.env.APP_STATE_PATH = path.join(tempRoot, "state.json");
  process.env.CODEX_BIN = stubPath;
  process.env.AI_WORKER_TEMP_ROOT = path.join(tempRoot, "worker");
  process.env.AI_WORKER_CODEX_TIMEOUT_MS = "10000";

  try {
    await initializeDatabase();
    const user = await upsertUserIdentity({
      provider: "local-dev",
      subject: "ai-worker-console-test",
      email: "ai-worker-console-test@speclens.dev",
      displayName: "AI Worker Console Test",
    });
    const workspace = await createWorkspaceForUser(user, {
      name: "AI Worker Console Workspace",
    });
    const source = await createSourceForUserForTests(workspace.id, user.id, {
      type: "git-public",
      displayName: "Fixture Repo",
      location: browserFixtureRepoUrl,
    });
    const repoReviewJob = await createAgentJobForUser(workspace.id, user.id, "agent-universal-exhaustive", {
      sourceId: source.id,
    });

    const result = await aiWorker.runAgentJobForTest(repoReviewJob.job.id);
    assert.equal(result.job.status, "succeeded");

    const defaultEnvelope = await getJobEnvelopeForUser(repoReviewJob.job.id, user.id);
    const verboseEnvelope = await getJobEnvelopeForUser(repoReviewJob.job.id, user.id, { logVisibility: "verbose" });

    assert.equal(
      defaultEnvelope.logs
        .filter(log => !parseAnalysisExecutionStepEvent(log.message))
        .some(log => log.message.includes("Source topology scout")),
      false,
      "Expected quiet source-topology logs to stay out of the default console.",
    );
    assert.equal(
      defaultEnvelope.executionSteps.some(step => step.roleId === "source-topology-scout"),
      true,
      "Expected execution step telemetry to stay visible even for quiet roles.",
    );
    assert.equal(
      verboseEnvelope.logs.some(log => log.message.includes("Source topology scout")),
      true,
      "Expected verbose logs to retain source-topology activity.",
    );
  } finally {
    process.env = originalEnv;
  }
});
