import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { createHomeTempDirSync } from "@speclens/core";
import { parseAnalysisExecutionStepEvent, standardizedAgentHandoffSchema, type Learnable } from "@speclens/contracts";
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

function makeLearnable(statement: string, category: Learnable["category"], order: number): Learnable {
  const timestamp = new Date(0).toISOString();
  return {
    id: `learnable-${order}`,
    workspaceId: "workspace-test",
    sourceId: "source-test",
    statement,
    category,
    evidence: [`evidence-${order}`],
    learnedFromJobId: "job-test",
    order,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("ai-worker derives finding paths and role categories from normalized role output", () => {
  assert.deepEqual(
    aiWorker.extractFindingPathsForTest([
      "`docs/FILE_MAP.md` app inventory is stale.",
      "primary/apps/web/app/page.tsx renders the route.",
    ]),
    ["docs/FILE_MAP.md", "apps/web/app/page.tsx"],
  );

  assert.deepEqual(
    aiWorker.buildFindingEvidenceRefsForTest(
      ["GET https://example.test/api failed", "`docs/FILE_MAP.md` app inventory is stale."],
      ["playwright-report/index.html"],
    ).map(ref => ({ kind: ref.kind, value: ref.value, sourcePath: ref.sourcePath })),
    [
      { kind: "test-report", value: "playwright-report/index.html", sourcePath: "playwright-report/index.html" },
      { kind: "repo-file", value: "docs/FILE_MAP.md", sourcePath: "docs/FILE_MAP.md" },
      { kind: "network", value: "GET https://example.test/api failed", sourcePath: null },
    ],
  );

  const output = aiWorker.normalizeRoleOutputForTest({
    summary: "Dependency review complete.",
    sections: [],
    findings: [{
      severity: "medium",
      title: "Dependency issue",
      message: "package.json needs review.",
      suggestion: "Review the dependency contract.",
      evidence: ["package.json"],
    }],
  }, "dependency-risk-reviewer");

  assert.equal(output.findings[0]?.category, "dependency");
});

test("ai-worker does not promote unknown role section statuses to ready", () => {
  const output = aiWorker.normalizeRoleOutputForTest({
    summary: "Partial review complete.",
    sections: [{
      title: "Unknown state section",
      status: "needs-human-review",
      summary: "This status is not part of the role contract.",
    }],
    findings: [],
  }, "runtime-scout");

  assert.equal(output.sections[0]?.status, "planned");
});

test("ai-worker recognizes expired Codex auth failures", () => {
  assert.equal(
    aiWorker.isCodexAuthFailureForTest({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "Provided authentication token is expired. code: token_expired. Please sign in again.",
      timedOut: false,
    }),
    true,
  );
  assert.equal(
    aiWorker.isCodexAuthFailureForTest({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "selected model is at capacity",
      timedOut: false,
    }),
    false,
  );
});

test("ai-worker keeps distinct capability gaps even when titles match", () => {
  const gaps = aiWorker.buildCapabilityGapsForTest({
    coverageGaps: [
      "Authenticated portal journeys were not exercised with workspace credentials.",
      "Compose-backed replay was unavailable in the sandbox environment.",
    ],
  });

  assert.deepEqual(
    gaps.map(gap => gap.summary),
    [
      "Authenticated portal journeys were not exercised with workspace credentials.",
      "Compose-backed replay was unavailable in the sandbox environment.",
    ],
  );
  assert.equal(new Set(gaps.map(gap => gap.id)).size, 2);
});

test("ai-worker records an auth capability gap when protected browser routes are skipped", () => {
  const gaps = aiWorker.buildCapabilityGapsForTest({
    coverageGaps: ["A lower-priority role note should not hide the auth blocker."],
    sections: [{
      id: "section_browser_qa",
      roleId: "browser-executor",
      title: "Browser QA execution",
      status: "ready",
      summary: "Direct browser QA ran, but protected routes were skipped.",
      data: {
        authenticated: false,
        authCoverage: {
          authenticated: false,
          method: "none",
          protectedRouteCount: 2,
          skippedProtectedRouteCount: 2,
          blockedReason: "No credential-pair or session-state workspace secret was provided, so protected browser routes were skipped.",
        },
        skippedNavigationTargets: [{
          url: "http://127.0.0.1:3000/portal",
          reason: "protected route requires authenticated browser state",
        }],
      },
    }],
  });

  assert.equal(gaps[0]?.scope, "auth");
  assert.equal(gaps[0]?.severity, "high");
  assert.equal(gaps[0]?.title, "Authenticated browser coverage blocked");
  assert.deepEqual(gaps[0]?.affectedSurfaces, ["http://127.0.0.1:3000/portal"]);
  assert.equal(
    gaps.some(gap => gap.title === "Browser coverage gap"),
    true,
  );
});

test("ai-worker persists execution-derived learnables alongside standardized handoff facts", () => {
  const handoff = standardizedAgentHandoffSchema.parse({
    schemaVersion: "speclens.agent-handoff.v1",
    generatedBy: {
      agentId: "agent-test",
      agentName: "Test agent",
      roleId: "standardized-json-output",
      roleName: "Standardized JSON output",
    },
    runtime: {
      startCommands: [{
        label: "Start",
        command: "npm run dev",
        workingDirectory: ".",
        purpose: "serve app",
      }],
    },
    auth: {
      frontend: {},
      api: {},
    },
    playwright: {
      detected: true,
      present: true,
      runnable: true,
      passed: true,
      suiteStatus: "passed",
      readiness: "ready",
    },
  });

  const learnables = aiWorker.synthesizeLearnablesFromReportForTest({
    sections: [
      {
        id: "section_browser_qa",
        roleId: "browser-executor",
        title: "Browser QA execution",
        status: "ready",
        summary: "Direct browser QA ran, but protected routes were skipped.",
        data: {
          authenticated: false,
          tracePath: "generated/browser/job/browser-trace.zip",
          authCoverage: {
            authenticated: false,
            method: "none",
            protectedRouteCount: 1,
            queuedProtectedRouteCount: 0,
            skippedProtectedRouteCount: 1,
            blockedReason: "No credential-pair or session-state workspace secret was provided, so protected browser routes were skipped.",
          },
          skippedNavigationTargets: [{
            url: "http://127.0.0.1:3000/portal",
            reason: "protected route requires authenticated browser state",
          }],
        },
      },
      {
        id: "section_handoff",
        roleId: "standardized-json-output",
        title: "Standardized JSON handoff",
        status: "ready",
        summary: "Standardized handoff ready.",
        data: {
          standardizedOutput: handoff,
        },
      },
    ],
    capabilityGaps: [{
      id: "capgap_auth",
      scope: "auth",
      severity: "high",
      title: "Authenticated browser coverage blocked",
      summary: "Protected portal routes were skipped because authenticated browser state was unavailable.",
      missingCapabilities: ["workspace-secret", "authenticated-browser-state"],
      affectedSurfaces: ["http://127.0.0.1:3000/portal"],
      suggestedActions: ["Attach a valid browser auth secret and rerun the analysis."],
      evidence: ["http://127.0.0.1:3000/portal"],
    }],
  });

  assert.equal(
    learnables.some(learnable =>
      learnable.category === "auth"
      && learnable.statement.includes("Caution: Browser QA skipped 1/1 protected target(s)")),
    true,
  );
  assert.equal(
    learnables.some(learnable =>
      learnable.category === "runtime"
      && learnable.statement === "Start the repository with npm run dev from . for serve app."),
    true,
  );
  assert.equal(
    learnables.some(learnable =>
      learnable.statement.includes("Current audit capability gap (auth): Authenticated browser coverage blocked")),
    true,
  );
  assert.equal(learnables[0]?.category, "auth");
});

test("ai-worker compacts prior role prompt context around execution evidence", () => {
  const browserSection = {
    title: "Browser QA execution",
    status: "ready",
    summary: "Direct browser QA visited many pages.",
    data: {
      baseUrl: "http://app.test",
      authenticated: true,
      authCoverage: { authenticated: true, method: "session-state", protectedRouteCount: 4 },
      tracePath: "generated/browser/browser-trace.zip",
      inputStorageStateUsed: true,
      capturedStorageStateSummary: { cookieCount: 2, originCount: 1 },
      pages: Array.from({ length: 20 }, (_, index) => ({
        url: `http://app.test/page-${index}`,
        finalUrl: `http://app.test/page-${index}`,
        status: 200,
        title: `Page ${index}`,
        h1: `Heading ${index}`,
        screenshot: `generated/browser/page-${index}.png`,
        discoveredLinks: Array.from({ length: 20 }, (_item, linkIndex) => `http://app.test/page-${index}/link-${linkIndex}`),
      })),
      interactions: Array.from({ length: 12 }, (_, index) => ({
        pageUrl: `http://app.test/page-${index}`,
        label: `Action ${index}`,
        action: "click",
        success: index % 2 === 0,
        error: index % 2 === 0 ? null : `Failure ${index}`,
        beforeScreenshot: `generated/browser/action-${index}-before.png`,
        afterScreenshot: `generated/browser/action-${index}-after.png`,
      })),
      navigationTargets: Array.from({ length: 20 }, (_, index) => ({ url: `http://app.test/nav-${index}` })),
      skippedNavigationTargets: Array.from({ length: 8 }, (_, index) => ({
        url: `http://app.test/protected-${index}`,
        reason: "protected route requires authenticated browser state",
      })),
    },
  };
  const artifactSection = {
    title: "Artifact expectations",
    status: "ready",
    summary: "Artifact expectations were synthesized.",
    data: {
      expectedKinds: ["screenshot", "trace", "auth-coverage"],
      presentGeneratedKinds: ["screenshot", "trace", "auth-coverage"],
      missingGeneratedKinds: [],
      generatedArtifacts: Array.from({ length: 20 }, (_, index) => ({
        path: `generated/browser/artifact-${index}`,
        kind: index % 3 === 0 ? "screenshot" : index % 3 === 1 ? "trace" : "auth-coverage",
      })),
      sourcePaths: Array.from({ length: 30 }, (_, index) => `generated/browser/source-${index}`),
      artifactExpectations: Array.from({ length: 12 }, (_, index) => ({
        kind: "screenshot",
        required: true,
        label: `Expectation ${index}`,
      })),
    },
  };
  const priorOutputs = [{
    roleId: "browser-executor",
    roleName: "Browser executor",
    output: aiWorker.normalizeRoleOutputForTest({
      summary: "Browser output ".repeat(80),
      sections: [
        ...Array.from({ length: 12 }, (_, index) => ({
          title: `Supporting section ${index}`,
          status: "ready",
          summary: `Supporting detail ${index}`,
          data: { detail: "extra context ".repeat(60) },
        })),
        browserSection,
        artifactSection,
      ],
      findings: Array.from({ length: 16 }, (_, index) => ({
        severity: index % 5 === 0 ? "high" : index % 2 === 0 ? "medium" : "low",
        title: `Finding ${index}`,
        message: `Finding message ${index} ${"details ".repeat(80)}`,
        suggestion: `Suggestion ${index}`,
          evidence: Array.from({ length: 12 }, (_item, evidenceIndex) => `evidence-${index}-${evidenceIndex}`),
        })),
    }),
  }];

  const serialized = aiWorker.formatPriorRoleOutputsForPromptForTest(priorOutputs, "release-gate-scorer");
  const parsed = JSON.parse(serialized) as Array<{
    sectionCount: number;
    findingCount: number;
    truncatedSections: number;
    truncatedFindings: number;
    sections: Array<{ title: string; data: Record<string, unknown> }>;
    findings: Array<{ severity: string }>;
  }>;
  const roleContext = parsed[0];
  assert.ok(roleContext, "Expected compact role context.");
  assert.equal(roleContext.sectionCount, 14);
  assert.equal(roleContext.sections.length, 10);
  assert.equal(roleContext.truncatedSections, 4);
  assert.equal(roleContext.findingCount, 16);
  assert.equal(roleContext.findings.length, 12);
  assert.equal(roleContext.truncatedFindings, 4);
  assert.equal(roleContext.findings[0]?.severity, "high");

  const compactBrowserSection = roleContext.sections.find(section => section.title === "Browser QA execution");
  assert.equal(compactBrowserSection?.data.pageCount, 20);
  assert.equal((compactBrowserSection?.data.pages as unknown[] | undefined)?.length, 10);
  assert.equal(compactBrowserSection?.data.failedInteractionCount, 6);
  assert.equal((compactBrowserSection?.data.failedInteractions as unknown[] | undefined)?.length, 4);
  assert.equal(serialized.includes("/page-0"), true);
  assert.equal(serialized.includes("/page-19"), false);

  const compactArtifactSection = roleContext.sections.find(section => section.title === "Artifact expectations");
  assert.equal(compactArtifactSection?.data.generatedArtifactCount, 20);
  assert.deepEqual(compactArtifactSection?.data.generatedArtifactsByKind, {
    screenshot: 7,
    trace: 7,
    "auth-coverage": 6,
  });
  assert.equal((compactArtifactSection?.data.generatedArtifacts as unknown[] | undefined)?.length, 10);
});

test("ai-worker prioritizes role-relevant learnables in prompts", () => {
  const learnables = [
    makeLearnable("Ops handoff exists.", "ops", 0),
    makeLearnable("Auth uses session-state secrets.", "auth", 1),
    makeLearnable("Runtime starts with npm run dev.", "runtime", 2),
    makeLearnable("Router lives under apps/web/app.", "repo-shape", 3),
    makeLearnable("Playwright suite writes traces.", "playwright", 4),
  ];

  const runtimeLearnables = JSON.parse(
    aiWorker.formatLearnablesForPromptForTest(learnables, "runtime-scout"),
  ) as Array<{ statement: string; category: Learnable["category"] }>;
  assert.equal(runtimeLearnables[0]?.category, "runtime");
  assert.equal(runtimeLearnables[1]?.category, "repo-shape");
  assert.equal(runtimeLearnables[2]?.category, "ops");

  const browserLearnables = JSON.parse(
    aiWorker.formatLearnablesForPromptForTest(learnables, "browser-executor"),
  ) as Array<{ statement: string; category: Learnable["category"] }>;
  assert.equal(browserLearnables[0]?.category, "playwright");
  assert.equal(browserLearnables[1]?.category, "auth");
  assert.equal(browserLearnables[2]?.category, "runtime");
});

test("ai-worker exposes a structured role-output schema for Codex output constraints", () => {
  const schema = aiWorker.buildRoleOutputJsonSchemaForTest() as {
    required?: string[];
    properties?: {
      sections?: { items?: { properties?: { status?: { enum?: string[] } } } };
      findings?: { items?: { properties?: { severity?: { enum?: string[] }; category?: { enum?: string[] } } } };
    };
  };

  assert.deepEqual(schema.required, ["summary", "sections", "findings"]);
  assert.deepEqual(schema.properties?.sections?.items?.properties?.status?.enum, ["ready", "planned", "skipped"]);
  assert.deepEqual(schema.properties?.findings?.items?.properties?.severity?.enum, ["high", "medium", "low"]);
  assert.equal(schema.properties?.findings?.items?.properties?.category?.enum?.includes("code"), true);
});

test("ai-worker fast-paths deterministic hybrid native outputs only when contract-ready", () => {
  const readyOutput = aiWorker.normalizeRoleOutputForTest({
    summary: "Repository inventory complete.",
    sections: [{
      title: "Repository inventory",
      status: "ready",
      summary: "Inventory ready.",
      data: { apps: [{ name: "web" }], packages: [] },
    }],
    findings: [],
  }, "source-topology-scout");

  assert.equal(
    aiWorker.shouldUseHybridNativeFastPathForTest({
      roleId: "source-topology-scout",
      nativeExecutorId: "native-repo-inventory",
      output: readyOutput,
    }),
    true,
  );
  assert.equal(
    aiWorker.shouldUseHybridNativeFastPathForTest({
      roleId: "source-topology-scout",
      nativeExecutorId: "native-repo-inventory",
      output: readyOutput,
      enabled: false,
    }),
    false,
  );
  assert.equal(
    aiWorker.shouldUseHybridNativeFastPathForTest({
      roleId: "source-topology-scout",
      nativeExecutorId: "native-browser-suite",
      output: readyOutput,
    }),
    false,
  );

  const incompleteOutput = aiWorker.normalizeRoleOutputForTest({
    summary: "Wrong section.",
    sections: [{
      title: "Wrong section",
      status: "ready",
      summary: "Not contract-ready.",
      data: {},
    }],
    findings: [],
  }, "runtime-scout");
  assert.equal(
    aiWorker.shouldUseHybridNativeFastPathForTest({
      roleId: "runtime-scout",
      nativeExecutorId: "native-repo-inventory",
      output: incompleteOutput,
    }),
    false,
  );
});

test("ai-worker excludes raw storage-state files from generated artifact snapshots", () => {
  const tempRoot = createHomeTempDirSync("speclens-ai-worker-artifacts-");
  const browserDir = path.join(tempRoot, "generated", "browser", "job-test");
  fs.mkdirSync(browserDir, { recursive: true });
  const rawStorageState = JSON.stringify({
    cookies: [{ name: "session", value: "secret" }],
    origins: [],
  });
  fs.writeFileSync(path.join(browserDir, "input-storage-state.json"), rawStorageState);
  fs.writeFileSync(path.join(browserDir, "captured-storage-state.json"), rawStorageState);
  fs.writeFileSync(path.join(browserDir, "playwright-storage-state.json"), rawStorageState);
  fs.writeFileSync(path.join(browserDir, "browser-auth-coverage.json"), JSON.stringify({ authenticated: true }));
  fs.writeFileSync(path.join(browserDir, "browser-trace.zip"), "trace");

  const artifacts = aiWorker.buildGeneratedArtifactSnapshotForTest(tempRoot);

  assert.deepEqual(
    artifacts.map(artifact => path.posix.basename(artifact.path)).sort(),
    ["browser-auth-coverage.json", "browser-trace.zip"],
  );
  assert.equal(
    artifacts.find(artifact => path.posix.basename(artifact.path) === "browser-auth-coverage.json")?.kind,
    "auth-coverage",
  );
  assert.equal(artifacts.some(artifact => artifact.kind === "storage-state"), false);
});

test("ai-worker treats valid session-state secrets as authenticated browser material", () => {
  const result = aiWorker.resolveBrowserAuthCoverageForTest({
    secrets: [{
      kind: "session-state",
      value: JSON.stringify({
        cookies: [],
        origins: [{
          origin: "http://127.0.0.1:3000",
          localStorage: [{ name: "speclens-session", value: "test-session" }],
        }],
      }),
    }],
    protectedRoutes: ["/portal"],
    navigationTargets: [{ path: "/portal/workspaces", requiresAuth: true }],
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.authCoverage.method, "session-state");
  assert.equal(result.authCoverage.sessionStateAccepted, true);
  assert.equal(result.authCoverage.sessionStateContainsStorage, true);
  assert.equal(result.authCoverage.protectedRouteCount, 2);
  assert.equal(result.authCoverage.queuedProtectedRouteCount, 2);
  assert.equal(result.authCoverage.skippedProtectedRouteCount, 0);
  assert.equal(result.authCoverage.blockedReason, null);
  assert.equal(
    result.skippedNavigationTargets.some(target => target.reason === "protected route requires authenticated browser state"),
    false,
  );
});

test("ai-worker reports malformed browser auth secrets without marking protected routes authenticated", () => {
  const result = aiWorker.resolveBrowserAuthCoverageForTest({
    secrets: [{
      kind: "session-state",
      value: "not-json",
    }],
    protectedRoutes: ["/portal"],
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.authCoverage.method, "none");
  assert.equal(result.authCoverage.sessionStateProvided, true);
  assert.equal(result.authCoverage.sessionStateAccepted, false);
  assert.equal(result.authCoverage.sessionStateError, "Session-state workspace secret is not valid JSON.");
  assert.equal(result.authCoverage.skippedProtectedRouteCount, 1);
  assert.match(result.authCoverage.blockedReason ?? "", /not valid JSON/);
});

test("ai-worker does not count empty session-state files as authenticated browser coverage", () => {
  const result = aiWorker.resolveBrowserAuthCoverageForTest({
    secrets: [{
      kind: "session-state",
      value: JSON.stringify({ cookies: [], origins: [] }),
    }],
    protectedRoutes: ["/portal"],
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.authCoverage.sessionStateAccepted, true);
  assert.equal(result.authCoverage.sessionStateContainsStorage, false);
  assert.equal(result.authCoverage.skippedProtectedRouteCount, 1);
  assert.match(result.authCoverage.blockedReason ?? "", /did not contain cookies/);
});

test("ai-worker marks timed-out Playwright preflight as blocked, not passed", async () => {
  const tempRoot = createHomeTempDirSync("speclens-playwright-preflight-timeout-");
  const repoRoot = path.join(tempRoot, "repo");
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: {
        e2e: "node slow-playwright.mjs",
      },
    }),
  );
  fs.writeFileSync(
    path.join(repoRoot, "slow-playwright.mjs"),
    "/* playwright test */\nsetTimeout(() => {}, 10_000);\n",
  );

  const originalEnv = { ...process.env };
  process.env.AI_WORKER_TEMP_ROOT = path.join(tempRoot, "worker");
  process.env.AI_WORKER_PLAYWRIGHT_COMMAND_TIMEOUT_MS = "1";

  try {
    const output = await aiWorker.augmentWithPlaywrightPreflightForTest({
      jobId: "job_preflight_timeout",
      logs: [],
      repoPath: repoRoot,
      tempDir: tempRoot,
      output: {
        summary: "Playwright role output.",
        sections: [],
        findings: [],
      },
      primarySourceId: "source_primary",
      companionSourceId: null,
    });
    const preflight = output.sections.find(section => section.title === "Playwright preflight");
    const data = preflight?.data as Record<string, unknown> | undefined;

    assert.equal(preflight?.status, "planned");
    assert.equal(data?.timedOut, true);
    assert.equal(data?.runnable, false);
    assert.equal(data?.passed, false);
    assert.equal(data?.suiteStatus, "blocked");
    assert.equal(data?.readiness, "blocked");
    assert.equal(
      output.findings.some(finding => finding.title === "Playwright preflight timed out"),
      true,
    );
  } finally {
    process.env = originalEnv;
  }
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
    "        navigationTargets: [{ path: '/', purpose: 'home', requiresAuth: false, source: 'router' }, { path: '/settings', purpose: 'settings', requiresAuth: false, source: 'router' }, { path: '/secure', purpose: 'secure workspace', requiresAuth: true, source: 'router' }, { path: '/broken', purpose: 'console error route', requiresAuth: false, source: 'router' }, { path: '/portal/:path* (middleware redirect to /api/auth/login when session cookie is missing)', purpose: 'route pattern', requiresAuth: true, source: 'docs' }, { path: '/, /pricing, /license', purpose: 'bad prose route list', requiresAuth: false, source: 'docs' }, { path: '/workspaces/[workspaceId]', purpose: 'dynamic route pattern', requiresAuth: true, source: 'router' }, { path: '/api/status', purpose: 'api health', requiresAuth: false, source: 'docs' }],",
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
    "        coverageGaps: ['No repository-native Playwright suite is present in the fixture app.', 'No Playwright execution was performed in this role pass; readiness is based on repo contracts and existing artifacts only.', 'No newly generated browser artifacts were produced in this run.', JSON.stringify({ gap: 'No Playwright suite executed in this role handoff step.', evidence: ['No `npm run e2e:*` command executed in this step'] })],",
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
    const firstCapturedPrompts = readPromptCapture(promptCapturePath);
    const navigationPrompt = firstCapturedPrompts.find(item => item.roleId === "navigation-qa-planner");
    const remediationPrompt = firstCapturedPrompts.find(item => item.roleId === "remediation-planner");
    assert.equal(navigationPrompt?.prompt.includes("Preferred limits: at most 12 navigation targets"), true);
    assert.equal(remediationPrompt?.prompt.includes("Preferred limits: at most 5 packs"), true);
    assert.deepEqual(
      firstCapturedPrompts
        .filter(item => [
          "source-topology-scout",
          "license-governor",
          "component-cartographer",
          "copy-consistency-auditor",
        ].includes(item.roleId))
        .map(item => item.roleId),
      [],
      "Expected deterministic hybrid roles to use native fast-path instead of spending Codex turns.",
    );
    assert.ok(firstResult.report?.summary.qualityScorecard, "Expected a computed quality scorecard.");
    assert.equal((firstResult.report?.summary.qualityScorecard?.overallScore ?? 0) > 0, true);
    assert.ok(
      firstResult.report?.summary.qualityScorecard?.roleScores.some(role => role.roleId === "runtime-scout" && role.status === "ready"),
      "Expected role scorecard to mark runtime-scout contract ready.",
    );
    assert.ok(firstResult.report?.summary.artifactAnalysis, "Expected artifact analysis in the report summary.");
    assert.equal((firstResult.report?.summary.artifactAnalysis?.producedCount ?? 0) >= 0, true);
    assert.ok(Array.isArray(firstResult.report?.summary.capabilityGaps), "Expected capability gap analysis on the report summary.");
    assert.equal(
      firstResult.report?.summary.capabilityGaps.some(gap => gap.summary.includes("No Playwright execution was performed")),
      false,
      "Expected live sandbox browser execution evidence to suppress stale role-level Playwright coverage gaps.",
    );
    assert.equal(
      firstResult.report?.summary.capabilityGaps.some(gap => gap.summary.includes("No newly generated browser artifacts")),
      false,
      "Expected generated browser artifacts to suppress stale role-level browser artifact gaps.",
    );
    assert.equal(
      firstResult.report?.summary.capabilityGaps.some(gap => gap.summary.includes("No Playwright suite executed")),
      false,
      "Expected repository-native Playwright execution evidence to suppress stale role-handoff Playwright gaps.",
    );
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
    const authCoverage = browserExecutionSection?.data.authCoverage as { authenticated?: boolean; method?: string; credentialLoginSucceeded?: boolean } | undefined;
    assert.equal(authCoverage?.authenticated, true);
    assert.equal(authCoverage?.method, "credential-pair");
    assert.equal(authCoverage?.credentialLoginSucceeded, true);
    assert.equal(
      "capturedStorageStatePath" in (browserExecutionSection?.data ?? {}),
      false,
      "Expected hosted Browser QA to keep raw captured storage state out of report data.",
    );
    assert.equal(
      "inputStorageStatePath" in (browserExecutionSection?.data ?? {}),
      false,
      "Expected hosted Browser QA to keep input storage state out of report data.",
    );
    assert.equal(typeof (browserExecutionSection?.data as { authCoveragePath?: unknown } | undefined)?.authCoveragePath, "string");
    const browserNavigationTargets = (browserExecutionSection?.data.navigationTargets as string[] | undefined) ?? [];
    assert.equal(
      browserNavigationTargets.some(target =>
        target.includes(":path")
        || target.includes("[workspaceId]")
        || target.includes("/api/status")
        || target.includes("%2C")
        || target.includes("/,%20/pricing")),
      false,
      "Expected hosted browser QA to skip API endpoints, unresolved route patterns, and prose route lists.",
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
    assert.ok(
      (firstResult.report?.artifacts ?? []).some(artifact => path.posix.basename(artifact.key) === "browser-auth-coverage.json"),
      "Expected a redacted browser auth coverage artifact from hosted execution.",
    );
    assert.ok(
      (firstResult.report?.artifacts ?? []).some(artifact => artifact.kind === "auth-coverage"),
      "Expected hosted Browser QA to classify redacted auth coverage explicitly.",
    );
    assert.equal(
      (firstResult.report?.artifacts ?? []).some(artifact => artifact.key.includes("storage-state")),
      false,
      "Expected hosted Browser QA to avoid persisting raw Playwright storage-state artifacts.",
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
