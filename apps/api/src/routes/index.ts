import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  addSourceInputSchema,
  billingCheckoutInputSchema,
  createAnalysisJobInputSchema,
  createWorkspaceSecretInputSchema,
  createWorkspaceInputSchema,
  githubInstallQuerySchema,
  githubWebhookInputSchema,
  stripeWebhookInputSchema,
} from "@speclens/contracts";
import { createWorkspace as createWorkspaceHandle, exportPatch, listAiProviders, listCapabilities, listPresets } from "@speclens/core";
import {
  addSourceRecord,
  addWorkspaceSecretRecord,
  applyGithubWebhook,
  applyStripeWebhook,
  createCheckoutSession,
  createGithubInstallUrl,
  createWorkspaceRecord,
  cancelJob,
  enqueueAnalysisForSource,
  getWorkspaceDetail,
  getJob,
  listWorkspaceSecrets,
  listJobs,
  listWorkspaceSummaries,
  retryJob,
  type AppState,
} from "../services/state";
import { resolveRequestUser } from "../services/auth";

function findWorkspace(state: AppState, workspaceId: string) {
  const workspace = state.workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace;
}

export async function registerRoutes(app: FastifyInstance, state: AppState): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/me", async request => ({
    user: await resolveRequestUser(state, {
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    }),
  }));

  app.get("/api/presets", async () => ({
    presets: listPresets(),
  }));

  app.get("/api/capabilities", async () => ({
    capabilities: listCapabilities(),
  }));

  app.get("/api/providers/ai", async () => ({
    providers: listAiProviders(),
  }));

  app.get("/api/workspaces", async () => ({
    workspaces: listWorkspaceSummaries(state),
  }));

  app.get("/api/workspaces/:workspaceId", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    return getWorkspaceDetail(state, workspaceId);
  });

  app.post("/api/workspaces", async request => {
    const input = createWorkspaceInputSchema.parse(request.body);
    const user = await resolveRequestUser(state, {
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    return {
      workspace: createWorkspaceRecord(state, user, input),
    };
  });

  app.get("/api/workspaces/:workspaceId/members", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    return {
      members: state.memberships.get(workspaceId) ?? [],
    };
  });

  app.post("/api/workspaces/:workspaceId/members", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const current = state.memberships.get(workspaceId) ?? [];
    const user = await resolveRequestUser(state, {
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    const member = {
      id: `membership_${randomUUID()}`,
      workspaceId,
      userId: user.id,
      role: "member" as const,
      createdAt: new Date().toISOString(),
    };
    state.memberships.set(workspaceId, [...current, member]);
    return { membership: member };
  });

  app.get("/api/workspaces/:workspaceId/sources", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    return {
      sources: state.sources.get(workspaceId) ?? [],
    };
  });

  app.post("/api/workspaces/:workspaceId/sources", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const input = addSourceInputSchema.parse(request.body);
    return {
      source: addSourceRecord(state, workspaceId, input),
    };
  });

  app.post("/api/workspaces/:workspaceId/uploads", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const workspace = findWorkspace(state, workspaceId);
    const upload = await request.file();
    if (!upload) {
      throw new Error("No archive file was uploaded.");
    }

    if (workspace.entitlement === "free") {
      throw new Error("Pro entitlement is required for archive uploads.");
    }

    const handle = createWorkspaceHandle({
      rootDir: process.cwd(),
      name: workspace.slug,
    });
    const uploadId = `upload_${randomUUID()}`;
    const uploadRoot = path.join(handle.uploadsDir, uploadId);
    const archivePath = path.join(uploadRoot, upload.filename);
    const extractedDir = path.join(uploadRoot, "extracted");
    fs.mkdirSync(extractedDir, { recursive: true });
    await pipeline(upload.file, fs.createWriteStream(archivePath));
    extractArchive(archivePath, extractedDir);

    const source = addSourceRecord(state, workspaceId, {
      type: "upload-archive",
      displayName: upload.filename,
      location: collapseSingleRoot(extractedDir),
      visibility: "private",
    });

    return { source };
  });

  app.get("/api/workspaces/:workspaceId/secrets", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    return {
      secrets: listWorkspaceSecrets(state, workspaceId),
    };
  });

  app.post("/api/workspaces/:workspaceId/secrets", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const input = createWorkspaceSecretInputSchema.parse(request.body);
    return {
      secret: addWorkspaceSecretRecord(state, workspaceId, input),
    };
  });

  app.post("/api/workspaces/:workspaceId/analyze", async request => {
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const input = createAnalysisJobInputSchema.parse(request.body);
    const workspace = findWorkspace(state, workspaceId);
    const source = (state.sources.get(workspaceId) ?? []).find(item => item.id === input.sourceId);
    if (!source) throw new Error(`Source not found: ${input.sourceId}`);
    const job = enqueueAnalysisForSource(state, workspace, source, {
      preset: input.preset,
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      ...(input.runtimeMode ? { runtimeMode: input.runtimeMode } : {}),
      ...(input.secretRefs ? { secretRefs: input.secretRefs } : {}),
    });
    return { job };
  });

  app.get("/api/jobs/:jobId", async request => {
    const jobId = (request.params as { jobId: string }).jobId;
    return { job: getJob(state, jobId) };
  });

  app.get("/api/jobs", async () => ({
    jobs: listJobs(state),
  }));

  app.post("/api/jobs/:jobId/cancel", async request => {
    const jobId = (request.params as { jobId: string }).jobId;
    return {
      job: cancelJob(state, jobId),
    };
  });

  app.post("/api/jobs/:jobId/retry", async request => {
    const jobId = (request.params as { jobId: string }).jobId;
    return {
      job: retryJob(state, jobId),
    };
  });

  app.get("/api/jobs/:jobId/logs", async request => {
    const jobId = (request.params as { jobId: string }).jobId;
    return { logs: getJob(state, jobId).logs };
  });

  app.get("/api/jobs/:jobId/logs/stream", async (request, reply) => {
    const jobId = (request.params as { jobId: string }).jobId;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    });
    await streamLogs(reply, state, jobId);
    return reply;
  });

  app.get("/api/reports/:reportId", async request => {
    const reportId = (request.params as { reportId: string }).reportId;
    const job = listJobs(state).find(item => item.report?.id === reportId);
    return {
      report: job?.report ?? null,
    };
  });

  app.get("/api/jobs/:jobId/artifacts", async request => {
    const jobId = (request.params as { jobId: string }).jobId;
    const job = getJob(state, jobId);
    return {
      artifacts: job.report?.artifacts ?? [],
    };
  });

  app.get("/api/jobs/:jobId/artifacts/:artifactIndex", async (request, reply) => {
    const { jobId, artifactIndex } = request.params as { jobId: string; artifactIndex: string };
    const job = getJob(state, jobId);
    const artifact = job.report?.artifacts[Number.parseInt(artifactIndex, 10)];
    if (!artifact) {
      throw new Error(`Artifact not found for job ${jobId} at index ${artifactIndex}`);
    }
    if (artifact.signedUrl) {
      return reply.redirect(artifact.signedUrl);
    }
    const absolutePath = path.resolve(process.cwd(), artifact.key);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Artifact file missing: ${artifact.key}`);
    }
    reply.header("content-type", artifact.mimeType);
    return reply.send(fs.createReadStream(absolutePath));
  });

  app.post("/api/reports/:reportId/export", async request => {
    const reportId = (request.params as { reportId: string }).reportId;
    const job = listJobs(state).find(item => item.report?.id === reportId);
    if (!job?.report) {
      throw new Error(`Report not found: ${reportId}`);
    }
    const workspace = findWorkspace(state, job.job.workspaceId);
    return {
      export: exportPatch(job.job.id, {}, { rootDir: process.cwd(), name: workspace.slug }),
    };
  });

  app.post("/api/billing/checkout", async request => {
    const input = billingCheckoutInputSchema.parse(request.body ?? {});
    const currentUser = await resolveRequestUser(state, {
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    const session = createCheckoutSession(state, currentUser, {
      workspaceId: input.workspaceId ?? null,
      priceId: process.env.STRIPE_PRICE_PRO_MONTHLY_USD ?? null,
      successUrl: process.env.STRIPE_SUCCESS_URL ?? "http://localhost:3000/portal?billing=success",
      cancelUrl: process.env.STRIPE_CANCEL_URL ?? "http://localhost:3000/pricing?billing=cancelled",
    });
    return {
      provider: "stripe",
      checkoutSessionId: session.id,
      checkoutUrl: session.checkoutUrl,
      cancelUrl: process.env.STRIPE_CANCEL_URL ?? "http://localhost:3000/pricing?billing=cancelled",
      plan: input.plan,
    };
  });

  app.post("/api/webhooks/stripe", async request => {
    const payload = stripeWebhookInputSchema.parse(request.body);
    return {
      provider: "stripe",
      ...applyStripeWebhook(state, {
        type: payload.type,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(payload.userId ? { userId: payload.userId } : {}),
        ...(payload.subscriptionId ? { subscriptionId: payload.subscriptionId } : {}),
      }),
    };
  });

  app.get("/api/integrations/github/install", async request => {
    const query = githubInstallQuerySchema.parse(request.query);
    return {
      installUrl: createGithubInstallUrl(query.workspaceId),
    };
  });

  app.post("/api/webhooks/github", async request =>
    applyGithubWebhook(state, githubWebhookInputSchema.parse(request.body)));
}

function isFinalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

async function streamLogs(reply: FastifyReply, state: AppState, jobId: string) {
  let index = 0;

  while (true) {
    const job = getJob(state, jobId);
    const pendingLogs = job.logs.slice(index);
    for (const log of pendingLogs) {
      reply.raw.write("event: log\n");
      reply.raw.write(`data: ${JSON.stringify(log)}\n\n`);
    }
    index = job.logs.length;

    if (isFinalStatus(job.job.status)) {
      reply.raw.write("event: complete\n");
      reply.raw.write(`data: ${JSON.stringify({ done: true, status: job.job.status })}\n\n`);
      reply.raw.end();
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function extractArchive(archivePath: string, extractedDir: string): void {
  const lower = archivePath.toLowerCase();
  const result = lower.endsWith(".zip")
    ? spawnSync("unzip", ["-q", archivePath, "-d", extractedDir], { encoding: "utf8" })
    : lower.endsWith(".tar") || lower.endsWith(".tgz") || lower.endsWith(".tar.gz")
      ? spawnSync("tar", ["-xf", archivePath, "-C", extractedDir], { encoding: "utf8" })
      : null;

  if (!result) {
    throw new Error("Unsupported archive format. Use .zip, .tar, .tgz, or .tar.gz.");
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Archive extraction failed.");
  }
}

function collapseSingleRoot(extractedDir: string): string {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true }).filter(entry => entry.name !== "__MACOSX");
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractedDir, entries[0].name);
  }
  return extractedDir;
}
