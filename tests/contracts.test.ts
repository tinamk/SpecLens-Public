import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisLogEventSchema,
  assertGoodAgentReport,
  addSourceInputSchema,
  analysisReportSchema,
  billingCheckoutInputSchema,
  billingPortalSessionInputSchema,
  adminRunAgentInputSchema,
  createAgentJobInputSchema,
  createAiRoleInputSchema,
  createRemediationTaskInputSchema,
  createWorkspaceMemberInputSchema,
  createWorkspaceInputSchema,
  createWorkspaceSecretInputSchema,
  pageInfoSchema,
  isCompatibilityJob,
  queueAnalysisTaskInputSchema,
  reportExportResponseSchema,
  resolveJobExecutionPath,
  analysisRuntimeModeSchema,
  githubInstallQuerySchema,
  githubWebhookInputSchema,
  learnableSchema,
  licenseEntitlementSchema,
  sourceTypeSchema,
  standardizedAgentHandoffSchema,
  stripeWebhookInputSchema,
  updateWorkspaceSecretInputSchema,
  updateSourceInputSchema,
} from "@speclens/contracts";

test("contracts expose the dual-license entitlement tiers", () => {
  assert.deepEqual(licenseEntitlementSchema.options, ["free", "pro", "commercial"]);
});

test("contracts accept hosted workspace creation and source registration inputs", () => {
  const workspace = createWorkspaceInputSchema.parse({
    name: "Hosted Team",
    description: "Portal workspace",
  });
  assert.equal(workspace.name, "Hosted Team");

  const source = addSourceInputSchema.parse({
    type: sourceTypeSchema.enum["git-public"],
    displayName: "SpecLens repo",
    location: "https://github.com/example/repo",
  });
  assert.equal(source.type, "git-public");

  const privateSource = addSourceInputSchema.parse({
    type: sourceTypeSchema.enum["github-private"],
    displayName: "Private SpecLens repo",
    location: "https://github.com/example/private-repo",
    githubInstallationId: "installation_123",
  });
  assert.equal(privateSource.type, "github-private");
  assert.equal(privateSource.githubInstallationId, "installation_123");
  assert.throws(() => addSourceInputSchema.parse({
    type: sourceTypeSchema.enum["github-private"],
    displayName: "Missing install",
    location: "https://github.com/example/private-repo",
  }));

  const pairedJob = createAgentJobInputSchema.parse({
    sourceId: "source_primary",
    companionSourceId: "source_companion",
  });
  assert.equal(pairedJob.companionSourceId, "source_companion");

  const taskJob = queueAnalysisTaskInputSchema.parse({
    sourceId: "source_primary",
    companionSourceId: "source_companion",
    agentId: "agent-universal-standard",
  });
  assert.equal(taskJob.agentId, "agent-universal-standard");

  const directAgentJob = createAgentJobInputSchema.parse({
    sourceId: "source_primary",
  });
  assert.equal(directAgentJob.sourceId, "source_primary");
  assert.throws(() => adminRunAgentInputSchema.parse({
    sourceId: "source_primary",
  }));
  const adminAgentRun = adminRunAgentInputSchema.parse({
    workspaceId: "workspace_primary",
    sourceId: "source_primary",
  });
  assert.equal(adminAgentRun.workspaceId, "workspace_primary");

  const remediationTask = createRemediationTaskInputSchema.parse({
    sourceId: "source_primary",
  });
  assert.equal(remediationTask.maxIterations, 2);
  assert.equal(remediationTask.outputMode, "changeset");
});

test("contracts reject non-hosted source types during hosted source registration", () => {
  assert.throws(() => addSourceInputSchema.parse({
    type: "workspace",
    displayName: "Local repo",
    location: "/tmp/local-repo",
  }));
  assert.throws(() => addSourceInputSchema.parse({
    type: "web-public",
    displayName: "Website",
    location: "https://example.com",
  }));
  assert.throws(() => addSourceInputSchema.parse({
    type: "archive-public",
    displayName: "Archive",
    location: "https://example.com/source.zip",
  }));
});

test("contracts expose runtime modes and workspace secrets", () => {
  assert.equal(analysisRuntimeModeSchema.options.includes("browser"), true);

  const secret = createWorkspaceSecretInputSchema.parse({
    name: "Demo credentials",
    kind: "credential-pair",
    value: "{\"username\":\"demo\",\"password\":\"secret\"}",
  });
  assert.equal(secret.kind, "credential-pair");

  const rotatedSecret = updateWorkspaceSecretInputSchema.parse({
    name: "Rotated credentials",
    kind: "api-token",
    value: "token-v2",
  });
  assert.equal(rotatedSecret.kind, "api-token");
});

test("contracts resolve the unified execution path", () => {
  assert.equal(resolveJobExecutionPath({ agentId: "agent-universal-standard" }), "unified-agent");
  assert.equal(resolveJobExecutionPath({ executionPath: "unified-agent", agentId: null }), "unified-agent");
  assert.equal(isCompatibilityJob({ agentId: "agent-universal-standard" }), false);
  assert.equal(isCompatibilityJob({ agentId: null }), false);
});

test("contracts accept billing and github integration payloads", () => {
  const checkout = billingCheckoutInputSchema.parse({
    workspaceId: "workspace_demo",
    plan: "pro",
  });
  assert.equal(checkout.plan, "pro");

  const billingPortal = billingPortalSessionInputSchema.parse({
    workspaceId: "workspace_demo",
  });
  assert.equal(billingPortal.workspaceId, "workspace_demo");

  const stripeWebhook = stripeWebhookInputSchema.parse({
    type: "checkout.session.completed",
    sessionId: "checkout_123",
  });
  assert.equal(stripeWebhook.type, "checkout.session.completed");

  const githubInstall = githubInstallQuerySchema.parse({
    workspaceId: "workspace_demo",
  });
  assert.equal(githubInstall.workspaceId, "workspace_demo");

  const githubWebhook = githubWebhookInputSchema.parse({
    workspaceId: "workspace_demo",
    action: "created",
    installationId: "12345",
    accountLogin: "example-org",
  });
  assert.equal(githubWebhook.action, "created");
});

test("contracts accept member creation, source rename, and durable export payloads", () => {
  const member = createWorkspaceMemberInputSchema.parse({
    email: "member@example.com",
  });
  assert.equal(member.email, "member@example.com");

  const renamedSource = updateSourceInputSchema.parse({
    displayName: "Renamed source",
  });
  assert.equal(renamedSource.displayName, "Renamed source");

  const exportPayload = reportExportResponseSchema.parse({
    artifact: {
      key: "exports/reports/report_demo.tar.gz",
      bucket: "local",
      region: "local",
      mimeType: "application/gzip",
      sizeBytes: 1024,
    },
    downloadUrl: "/api/proxy/api/jobs/job_demo/artifacts/4",
  });
  assert.equal(exportPayload.artifact.key.includes("exports/reports/"), true);

  const pageInfo = pageInfoSchema.parse({
    page: 2,
    pageSize: 25,
    total: 60,
    totalPages: 3,
  });
  assert.equal(pageInfo.totalPages, 3);
});

test("contracts accept AI role dependencies and standardized handoff payloads", () => {
  const role = createAiRoleInputSchema.parse({
    name: "Playwright operator",
    prompt: "Run the browser path.",
    consoleVisibility: "quiet",
    executorKind: "hybrid",
    nativeExecutorId: "native-browser-suite",
    dependsOnRoleIds: ["runtime-scout", "auth-cartographer"],
    skillIds: ["skill-playwright-operator"],
  });
  assert.deepEqual(role.dependsOnRoleIds, ["runtime-scout", "auth-cartographer"]);
  assert.equal(role.consoleVisibility, "quiet");
  assert.equal(role.executorKind, "hybrid");
  assert.equal(role.nativeExecutorId, "native-browser-suite");

  const handoff = standardizedAgentHandoffSchema.parse({
    schemaVersion: "speclens.agent-handoff.v1",
    auditBundleId: "standard",
    generatedBy: {
      agentId: "agent-universal-standard",
      agentName: "Universal audit standard agent",
      roleId: "standardized-json-output",
      roleName: "Standardized JSON output",
    },
    runtime: {
      installCommands: [{ label: "install", command: "npm install", workingDirectory: ".", purpose: "deps" }],
      buildCommands: [],
      startCommands: [],
      verificationCommands: [],
      packageManagers: ["npm"],
      targets: [{
        label: "web",
        kind: "web",
        workingDirectory: ".",
        startCommand: "npm run dev:web",
        baseUrl: "http://127.0.0.1:3000",
        healthUrls: ["http://127.0.0.1:3000/api/health"],
        framework: "nextjs",
      }],
      workingDirectories: ["."],
      serviceDependencies: ["postgres"],
      envFiles: [".env.example"],
      ports: [3000],
      baseUrls: ["http://127.0.0.1:3000"],
    },
    auth: {
      frontend: {
        strategy: "oidc",
        loginRoutes: ["/api/auth/login"],
        callbackRoutes: ["/api/auth/callback"],
        protectedRoutes: ["/portal"],
        secretRefs: ["AUTH_SECRET"],
        bootstrapSteps: ["Sign in through the hosted login route."],
        userActions: ["Complete Keycloak login."],
      },
      api: {
        strategy: "bearer",
        loginRoutes: [],
        callbackRoutes: [],
        protectedRoutes: ["/api/proxy/api"],
        secretRefs: ["KEYCLOAK_CLIENT_SECRET"],
        bootstrapSteps: ["Forward the portal bearer token."],
        userActions: [],
      },
    },
    playwright: {
      readiness: "ready",
      present: true,
      packageManager: "npm",
      configPaths: ["playwright.config.ts"],
      setupCommands: [{ label: "install browsers", command: "npx playwright install --with-deps", workingDirectory: ".", purpose: "browser setup" }],
      commands: [{ label: "hosted-local", command: "npm run e2e:hosted:local", workingDirectory: ".", purpose: "e2e" }],
      workingDirectories: ["."],
      baseUrlStrategy: "PLAYWRIGHT_BASE_URL",
      authStrategy: "login through Keycloak",
      testTargets: ["tests/e2e"],
      navigationTargets: [{
        path: "/portal/workspaces",
        purpose: "Workspace list",
        requiresAuth: true,
        source: "router",
      }],
      journeys: [{
        title: "Create workspace and queue analysis",
        steps: ["Log in", "Open the workspaces page", "Queue analysis"],
        requiresAuth: true,
        priority: "high",
        successSignals: ["Workspace row is visible", "Job succeeds"],
      }],
      assertions: ["Workspace navigation remains visible after login."],
      reporters: ["list", "html"],
      artifacts: ["playwright-report"],
      prerequisites: ["Web and API services must be running."],
      coverageGaps: ["Stripe checkout completion remains boundary-tested."],
    },
    detectedSurfaces: [{
      label: "Hosted portal",
      kind: "authenticated-site",
      location: "/portal/workspaces",
      companion: false,
      confidence: "high",
    }],
    executionCoverage: {
      attempted: [{
        id: "runtime-execution",
        title: "Runtime execution",
        status: "attempted",
        detail: "Planned runtime boot.",
        evidence: [],
      }],
      skipped: [],
    },
    artifactExpectations: [{
      kind: "screenshot",
      label: "Representative screenshots",
      required: true,
      detail: "Representative screenshots",
      sourcePath: "generated/browser",
    }],
    remediationPacks: [{
      id: "pack-navigation",
      title: "Navigation remediation",
      summary: "Fix route and queueing gaps.",
      priority: "medium",
      category: "navigation",
      ownerRoleId: "navigation-qa-planner",
      findingIds: [],
      actions: ["Re-run browser QA after navigation fixes."],
      testingNotes: ["Verify protected route navigation."],
    }],
    releaseGateDecision: {
      status: "warn",
      reason: "Medium-severity navigation gaps remain open.",
      confidence: "medium",
      blockingFindingIds: [],
    },
    blockers: [],
    recommendations: [{ title: "Seed users", action: "Run npm run seed:keycloak-users", priority: "medium" }],
  });
  assert.equal(handoff.playwright.readiness, "ready");
});

test("contracts expose log visibility and learnable schemas", () => {
  const log = analysisLogEventSchema.parse({
    id: "log_123",
    jobId: "job_123",
    level: "info",
    scope: "agent",
    message: "Stored 3 learnable(s) for future runs.",
    visibility: "verbose",
    createdAt: new Date().toISOString(),
  });
  assert.equal(log.visibility, "verbose");

  const learnable = learnableSchema.parse({
    id: "learnable_123",
    workspaceId: "workspace_123",
    sourceId: "source_123",
    statement: "Install dependencies with npm install from . for deps.",
    category: "runtime",
    evidence: ["package.json"],
    learnedFromJobId: "job_123",
    order: 0,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(learnable.category, "runtime");
});

test("contracts validate good agent reports through the shared helper", () => {
  const report = analysisReportSchema.parse({
    id: "report_123",
    workspaceId: "workspace_123",
    jobId: "job_123",
    status: "ready",
    runtimeMode: "static",
    title: "Runtime operations report",
    summary: {
      totalFindings: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    roles: [],
    findings: [],
    sections: [{
      id: "section_123",
      roleId: "standardized-json-output",
      title: "Standardized JSON handoff",
      status: "ready",
      summary: "Canonical handoff prepared.",
      data: {
        standardizedOutput: {
          schemaVersion: "speclens.agent-handoff.v1",
          auditBundleId: "standard",
          generatedBy: {
            agentId: "agent-universal-standard",
            agentName: "Universal audit standard agent",
            roleId: "standardized-json-output",
            roleName: "Standardized JSON output",
          },
          runtime: {
            installCommands: [],
            buildCommands: [],
            startCommands: [],
            verificationCommands: [],
            packageManagers: [],
            targets: [],
            workingDirectories: ["."],
            serviceDependencies: [],
            envFiles: [],
            ports: [],
            baseUrls: [],
          },
          auth: {
            frontend: {
              strategy: "oidc",
              loginRoutes: ["/api/auth/login"],
              callbackRoutes: ["/api/auth/callback"],
              protectedRoutes: ["/portal"],
              secretRefs: [],
              bootstrapSteps: [],
              userActions: [],
            },
            api: {
              strategy: "bearer",
              loginRoutes: [],
              callbackRoutes: [],
              protectedRoutes: ["/api"],
              secretRefs: [],
              bootstrapSteps: [],
              userActions: [],
            },
          },
          playwright: {
            readiness: "partial",
            present: false,
            packageManager: null,
            configPaths: [],
            setupCommands: [],
            commands: [],
            workingDirectories: [],
            baseUrlStrategy: null,
            authStrategy: null,
            testTargets: [],
            navigationTargets: [],
            journeys: [],
            assertions: [],
            reporters: [],
            artifacts: [],
            prerequisites: [],
            coverageGaps: [],
          },
          detectedSurfaces: [],
          executionCoverage: {
            attempted: [],
            skipped: [],
          },
          artifactExpectations: [],
          remediationPacks: [],
          releaseGateDecision: null,
          blockers: [],
          recommendations: [],
        },
      },
    }],
    artifacts: [],
    createdAt: new Date().toISOString(),
  });

  const handoff = assertGoodAgentReport(report);
  assert.equal(handoff.schemaVersion, "speclens.agent-handoff.v1");
  assert.equal(report.summary.qualityScorecard, null);
  assert.deepEqual(report.summary.capabilityGaps, []);
  assert.equal(report.summary.artifactAnalysis, null);
});
