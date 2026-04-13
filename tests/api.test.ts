import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath = path.join(process.cwd(), "fixtures", "tagtwo-mini");
const browserFixturePath = path.join(process.cwd(), "fixtures", "browser-parity-app");

function makeTempStatePath(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "hosted-api-state.json");
}

function makePortalSessionCookie(payload: {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
}): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `speclens_portal_session=${encoded}`;
}

async function createApiAppInstance(
  statePath = makeTempStatePath("speclens-api-state-"),
  env: Record<string, string> = {},
) {
  process.env.APP_STATE_PATH = statePath;
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  const apiAppModule = await import("../apps/api/src/app");
  const candidate = apiAppModule.default as {
    createApiApp?: () => Promise<{ app: any; state: any }>;
    default?: () => Promise<{ app: any; state: any }>;
  } | (() => Promise<{ app: any; state: any }>);
  const createApiApp = typeof candidate === "function"
    ? candidate
    : typeof candidate.createApiApp === "function"
      ? candidate.createApiApp
      : candidate.default;

  assert.equal(typeof createApiApp, "function");
  return createApiApp!();
}

async function waitForJob(app: any, jobId: string, timeoutMs = 15000): Promise<any> {
  const startedAt = Date.now();
  for (;;) {
    const response = await app.inject({
      method: "GET",
      url: `/api/jobs/${jobId}`,
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as { job: { job: { status: string } } };
    if (payload.job.job.status === "succeeded" || payload.job.job.status === "failed" || payload.job.job.status === "cancelled") {
      return payload;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for job ${jobId}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test("hosted API supports queued workspace analysis, logs, report, and export flow", async t => {
  const { app } = await createApiAppInstance();
  t.after(async () => {
    await app.close();
  });

  const presetsResponse: any = await app.inject({
    method: "GET",
    url: "/api/presets",
  });
  assert.equal(presetsResponse.statusCode, 200);
  const presetsPayload = presetsResponse.json() as { presets: Array<{ id: string }> };
  assert.equal(presetsPayload.presets.some(item => item.id === "tagtwo"), true);

  const capabilitiesResponse: any = await app.inject({
    method: "GET",
    url: "/api/capabilities",
  });
  assert.equal(capabilitiesResponse.statusCode, 200);
  const capabilitiesPayload = capabilitiesResponse.json() as { capabilities: Array<{ id: string }> };
  assert.equal(capabilitiesPayload.capabilities.some(item => item.id === "license-policy"), true);

  const workspaceResponse: any = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Portal Workspace",
      description: "Hosted workspace for API validation",
    },
  });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string; slug: string } };

  const sourceResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources`,
    payload: {
      type: "workspace",
      displayName: "Fixture upload",
      location: fixturePath,
      visibility: "private",
    },
  });
  assert.equal(sourceResponse.statusCode, 200);
  const sourcePayload = sourceResponse.json() as { source: { id: string } };

  const secretResponse: any = await app.inject({
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

  const analysisResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      preset: "tagtwo",
      secretRefs: [secretPayload.secret.id],
    },
  });
  assert.equal(analysisResponse.statusCode, 200);
  const analysisPayload = analysisResponse.json() as {
    job: {
      job: { id: string; status: string; preset: string };
      report: null;
    };
  };
  assert.equal(analysisPayload.job.job.status, "queued");
  assert.equal(analysisPayload.job.job.preset, "tagtwo");

  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  assert.equal(completedPayload.job.job.status, "succeeded");
  assert.ok(completedPayload.job.report);
  assert.equal(completedPayload.job.report?.sections.length > 0, true);

  const logsResponse: any = await app.inject({
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/logs`,
  });
  assert.equal(logsResponse.statusCode, 200);
  const logsPayload = logsResponse.json() as { logs: Array<{ id: string; message: string }> };
  assert.equal(logsPayload.logs.length > 1, true);
  assert.equal(logsPayload.logs.some(log => log.message.includes("queued")), true);

  const reportId = completedPayload.job.report!.id;
  const reportResponse: any = await app.inject({
    method: "GET",
    url: `/api/reports/${reportId}`,
  });
  assert.equal(reportResponse.statusCode, 200);
  const reportPayload = reportResponse.json() as { report: { id: string; capabilities: string[] } | null };
  assert.equal(reportPayload.report?.id, reportId);
  assert.equal(reportPayload.report?.capabilities.includes("browser-self-check"), true);

  const exportResponse: any = await app.inject({
    method: "POST",
    url: `/api/reports/${reportId}/export`,
  });
  assert.equal(exportResponse.statusCode, 200);
  const exportPayload = exportResponse.json() as { export: { exportId: string; operations: unknown[] } };
  assert.ok(exportPayload.export.exportId);
  assert.equal(exportPayload.export.operations.length > 0, true);
});

test("hosted API provisions the current user from the portal session cookie", async t => {
  const { app } = await createApiAppInstance();
  t.after(async () => {
    await app.close();
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

  const workspaceResponse: any = await app.inject({
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

  const { app } = await createApiAppInstance();
  t.after(async () => {
    await app.close();
  });

  const workspaceResponse: any = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Browser Workspace",
      description: "Hosted browser parity workspace",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const sourceResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources`,
    payload: {
      type: "workspace",
      displayName: "Browser fixture",
      location: browserFixturePath,
      visibility: "private",
    },
  });
  const sourcePayload = sourceResponse.json() as { source: { id: string } };

  const secretResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/secrets`,
    payload: {
      name: "Fixture credentials",
      kind: "credential-pair",
      value: "{\"username\":\"demo\",\"password\":\"secret\"}",
    },
  });
  const secretPayload = secretResponse.json() as { secret: { id: string } };

  const analysisResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      preset: "tagtwo",
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
  assert.equal(completedPayload.job.job.runtimeMode, "browser");
  const browserSection = completedPayload.job.report?.sections.find((section: { capability: string }) => section.capability === "browser-self-check");
  assert.ok(browserSection);
  assert.equal(browserSection?.status, "ready");
  assert.equal(Boolean((browserSection?.data as { authenticated?: boolean }).authenticated), true);
});

test("hosted API billing and github integration routes update local state", async t => {
  const { app } = await createApiAppInstance();
  t.after(async () => {
    await app.close();
  });

  const workspaceResponse: any = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Commercial Workspace",
      description: "Workspace for billing and install tests",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const checkoutResponse: any = await app.inject({
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

  const stripeWebhookResponse: any = await app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    payload: {
      type: "checkout.session.completed",
      sessionId: checkoutPayload.checkoutSessionId,
    },
  });
  assert.equal(stripeWebhookResponse.statusCode, 200);
  const stripeWebhookPayload = stripeWebhookResponse.json() as { entitlement: string };
  assert.equal(stripeWebhookPayload.entitlement, "pro");

  const meResponse: any = await app.inject({
    method: "GET",
    url: "/api/me",
  });
  assert.equal(meResponse.statusCode, 200);
  const mePayload = meResponse.json() as { user: { entitlement: string } };
  assert.equal(mePayload.user.entitlement, "pro");

  const installUrlResponse: any = await app.inject({
    method: "GET",
    url: `/api/integrations/github/install?workspaceId=${workspacePayload.workspace.id}`,
  });
  assert.equal(installUrlResponse.statusCode, 200);
  const installUrlPayload = installUrlResponse.json() as { installUrl: string };
  assert.equal(installUrlPayload.installUrl.includes(workspacePayload.workspace.id), true);

  const githubWebhookResponse: any = await app.inject({
    method: "POST",
    url: "/api/webhooks/github",
    payload: {
      workspaceId: workspacePayload.workspace.id,
      action: "created",
      installationId: "12345",
      accountLogin: "example-org",
    },
  });
  assert.equal(githubWebhookResponse.statusCode, 200);
  const githubWebhookPayload = githubWebhookResponse.json() as { installationCount: number; provider: string };
  assert.equal(githubWebhookPayload.provider, "github");
  assert.equal(githubWebhookPayload.installationCount, 1);
});

test("hosted API persists workspace state across app restarts", async t => {
  const statePath = makeTempStatePath("speclens-persist-");
  const first = await createApiAppInstance(statePath);
  t.after(async () => {
    await first.app.close();
  });

  const workspaceResponse: any = await first.app.inject({
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Persistent Workspace",
      description: "Should survive app recreation",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  await first.app.close();

  const second = await createApiAppInstance(statePath);
  t.after(async () => {
    await second.app.close();
  });

  const detailResponse: any = await second.app.inject({
    method: "GET",
    url: `/api/workspaces/${workspacePayload.workspace.id}`,
  });
  assert.equal(detailResponse.statusCode, 200);
  const detailPayload = detailResponse.json() as { workspace: { id: string } };
  assert.equal(detailPayload.workspace.id, workspacePayload.workspace.id);
});

test("hosted API exposes artifacts and supports archive upload for pro workspaces", async t => {
  const statePath = makeTempStatePath("speclens-upload-");
  const { app } = await createApiAppInstance(statePath);
  t.after(async () => {
    await app.close();
  });

  const workspaceResponse: any = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Upload Workspace",
      description: "Artifact and upload validation",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const deniedUpload: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources`,
    payload: {
      type: "github-private",
      displayName: "Private repo",
      location: "https://github.com/example/private",
      visibility: "private",
    },
  });
  assert.equal(deniedUpload.statusCode, 403);

  const checkoutResponse: any = await app.inject({
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      workspaceId: workspacePayload.workspace.id,
      plan: "pro",
    },
  });
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string };
  await app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    payload: {
      type: "checkout.session.completed",
      sessionId: checkoutPayload.checkoutSessionId,
    },
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "speclens-archive-"));
  const archivePath = path.join(tempDir, "browser-parity-app.tar.gz");
  const archiveResult = spawnSync("tar", ["-czf", archivePath, "-C", path.dirname(browserFixturePath), path.basename(browserFixturePath)], { encoding: "utf8" });
  assert.equal(archiveResult.status, 0);
  const archiveBuffer = fs.readFileSync(archivePath);
  const boundary = "----SpecLensBoundary";
  const multipartPayload = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="browser-parity-app.tar.gz"\r\n`),
    Buffer.from("Content-Type: application/gzip\r\n\r\n"),
    archiveBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const uploadResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/uploads`,
    payload: multipartPayload,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  });
  assert.equal(uploadResponse.statusCode, 200);
  const uploadPayload = uploadResponse.json() as { source: { id: string; location: string } };
  assert.equal(fs.existsSync(uploadPayload.source.location), true);

  const analysisResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: uploadPayload.source.id,
      preset: "tagtwo",
    },
  });
  const analysisPayload = analysisResponse.json() as { job: { job: { id: string } } };
  const completedPayload = await waitForJob(app, analysisPayload.job.job.id);
  assert.ok(completedPayload.job.report);

  const artifactsResponse: any = await app.inject({
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/artifacts`,
  });
  assert.equal(artifactsResponse.statusCode, 200);
  const artifactsPayload = artifactsResponse.json() as { artifacts: Array<{ key: string }> };
  assert.equal(artifactsPayload.artifacts.length > 0, true);

  const artifactContentResponse: any = await app.inject({
    method: "GET",
    url: `/api/jobs/${analysisPayload.job.job.id}/artifacts/0`,
  });
  assert.equal(artifactContentResponse.statusCode, 200);
});

test("hosted API supports queued job cancellation and retry", async t => {
  const statePath = makeTempStatePath("speclens-queue-");
  const { app } = await createApiAppInstance(statePath, {
    API_MAX_CONCURRENT_ANALYSES: "1",
  });
  t.after(async () => {
    await app.close();
  });

  const workspaceResponse: any = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    payload: {
      name: "Queue Control Workspace",
      description: "Used for cancellation and retry tests",
    },
  });
  const workspacePayload = workspaceResponse.json() as { workspace: { id: string } };

  const sourceResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/sources`,
    payload: {
      type: "workspace",
      displayName: "Browser fixture",
      location: browserFixturePath,
      visibility: "private",
    },
  });
  const sourcePayload = sourceResponse.json() as { source: { id: string } };

  const checkoutResponse: any = await app.inject({
    method: "POST",
    url: "/api/billing/checkout",
    payload: {
      workspaceId: workspacePayload.workspace.id,
      plan: "pro",
    },
  });
  const checkoutPayload = checkoutResponse.json() as { checkoutSessionId: string };
  await app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    payload: {
      type: "checkout.session.completed",
      sessionId: checkoutPayload.checkoutSessionId,
    },
  });

  const firstJobResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      preset: "tagtwo",
    },
  });
  const firstJobId = (firstJobResponse.json() as { job: { job: { id: string } } }).job.job.id;

  const secondJobResponse: any = await app.inject({
    method: "POST",
    url: `/api/workspaces/${workspacePayload.workspace.id}/analyze`,
    payload: {
      sourceId: sourcePayload.source.id,
      preset: "tagtwo",
    },
  });
  const secondJobId = (secondJobResponse.json() as { job: { job: { id: string; status: string } } }).job.job.id;

  const cancelResponse: any = await app.inject({
    method: "POST",
    url: `/api/jobs/${secondJobId}/cancel`,
  });
  assert.equal(cancelResponse.statusCode, 200);
  const cancelPayload = cancelResponse.json() as { job: { job: { status: string } } };
  assert.equal(cancelPayload.job.job.status, "cancelled");

  const retryResponse: any = await app.inject({
    method: "POST",
    url: `/api/jobs/${secondJobId}/retry`,
  });
  assert.equal(retryResponse.statusCode, 200);
  const retryPayload = retryResponse.json() as { job: { job: { id: string; status: string } } };
  assert.equal(retryPayload.job.job.status, "queued");
  assert.notEqual(retryPayload.job.job.id, secondJobId);

  await waitForJob(app, firstJobId);
  const retriedCompleted = await waitForJob(app, retryPayload.job.job.id);
  assert.equal(retriedCompleted.job.job.status, "succeeded");
});
