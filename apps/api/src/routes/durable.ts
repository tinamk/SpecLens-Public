import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import * as tar from "tar";
import {
  addSourceInputSchema,
  billingPortalSessionInputSchema,
  codeReviewPayloadSchema,
  billingCheckoutInputSchema,
  commercialContactInputSchema,
  createAgentJobInputSchema,
  createWorkspaceMemberInputSchema,
  createRemediationTaskInputSchema,
  createAiAgentInputSchema,
  createAiRoleInputSchema,
  createAiSkillInputSchema,
  queueAnalysisTaskInputSchema,
  createWorkspaceSecretInputSchema,
  createWorkspaceInputSchema,
  githubInstallQuerySchema,
  githubLinkInstallationInputSchema,
  reportExportResponseSchema,
  updateWorkspaceSecretInputSchema,
  updateSourceInputSchema,
  type Source,
} from "@speclens/contracts";
import {
  createHomeTempDirSync,
  inspectGitRepositoryArchiveFileAsync,
  listAiProviders,
  listRoleDefinitions,
} from "@speclens/core";
import {
  addWorkspaceMember,
  applyGithubWebhookToDatabase,
  applyStripeWebhookToDatabase,
  cancelAgentJob,
  cancelRunnerJob,
  createAgentJobForUser,
  createAiAgent,
  createAiRole,
  createAiSkill,
  clearCodexAuth,
  createCommercialContactRequest,
  createCheckoutSessionForUser,
  createSourceForUser,
  createUploadSourceForUser,
  createWorkspaceForUser,
  deleteSourceForUser,
  deleteWorkspaceSecretForUser,
  createWorkspaceSecretForUser,
  createRemediationJobForUser,
  dispatchRunnerJob,
  getBillingPortalContextForUser,
  getCodexAuthRecord,
  getCodexAuthStatus,
  getArtifactForJobForUser,
  getJobEnvelopeById,
  getJobEnvelopeForUser,
  getPrismaClient,
  getReportForUser,
  listAiAnalysisTasks,
  listAiAgents,
  listAiRoles,
  listAiSkills,
  listJobLogsAfterWithVisibility,
  listRemediationJobsForSourceForUser,
  getWorkspaceDetailForUser,
  listArtifactsForJobForUser,
  listJobsPageForUser,
  listSourceLearnablesForUser,
  listWorkspaceMembersPageForUser,
  listWorkspaceSecretsPageForUser,
  listWorkspaceSourcesForUser,
  listWorkspaceSourcesPageForUser,
  listWorkspaceSummariesPageForUser,
  deleteAiAgent,
  deleteAiRole,
  deleteAiSkill,
  createGithubInstallIntent,
  expireGithubWebhookTargets,
  getGithubInstallIntentById,
  recordAuditLog,
  listActiveGithubWebhookTargets,
  registerGithubInstallationForIntent,
  registerGithubWebhookTarget,
  requestJobCancellationForUser,
  removeGithubInstallationForUser,
  removeGithubInstallationByInstallationId,
  removeWorkspaceMember,
  retryAnalysisJobForUser,
  setCodexAuthError,
  statusError,
  startCodexDeviceFlow,
  storeCodexTokens,
  updateSourceForUser,
  updateAiAgent,
  updateAiRole,
  updateAiSkill,
  updateWorkspaceSecretForUser,
  setSourceVerificationState,
  verifySourceForUser,
} from "@speclens/db";
import { assertAdminUser, resolveAuthenticatedUser } from "../services/auth";
import { loadApiConfig } from "../services/config";
import {
  buildGithubInstallUrl,
  createSignedGithubInstallState,
  assertAllowedGithubReturnOrigin,
  forwardGithubWebhookToTarget,
  getGithubInstallation,
  getGithubPullRequest,
  getGithubWebhookTargetTtlSeconds,
  isGithubGatewayHost,
  listGithubPullRequests,
  listGithubInstallationRepositories,
  parseGithubGatewayRegisterInput,
  parseSignedGithubInstallState,
  parseGithubWebhookPayload,
  resolveGithubRequestOrigin,
  requireGithubGatewayRegistrationToken,
} from "../services/github";
import {
  CodeReviewCacheNotReadyError,
  CodeReviewReferenceNotFoundError,
  ensureGitReviewRepo,
  readCodeReviewFromSource,
  scheduleCodeReviewPrewarm,
} from "../services/git-review";
import { downloadObjectToFile, putObjectFromFile, resolveObjectStoragePath } from "../services/object-storage";
import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  hasLiveStripeConfig,
  parseStripeWebhookPayload,
} from "../services/stripe";
import { recordJobEvent, recordWebhookEvent } from "../services/metrics";
import durableArtifactHelpers from "./durable-artifacts";

function getConfig() {
  return loadApiConfig();
}

const sourceVerificationJobs = new Map<string, Promise<Source>>();

function logSourceVerificationFailure(source: Pick<Source, "id" | "displayName">, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[source-verification] verify failed for ${source.id} (${source.displayName}): ${message}`);
}

function parsePositiveQueryInt(value: unknown, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveListQuery(query: Record<string, unknown> | undefined): {
  q: string;
  page: number;
  pageSize: number;
} {
  return {
    q: typeof query?.q === "string" ? query.q.trim() : "",
    page: parsePositiveQueryInt(query?.page, 1),
    pageSize: parsePositiveQueryInt(query?.pageSize, 25),
  };
}

function verificationErrorMessage(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && "statusCode" in error
    && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return error instanceof Error ? error.message : String(error);
}

function logSourcePrewarmFailure(source: Source, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[source-verification] prewarm failed for ${source.id} (${source.displayName}): ${message}`);
}

async function refreshWorkspaceSource(
  workspaceId: string,
  userId: string,
  sourceId: string,
): Promise<Source> {
  const sources = await listWorkspaceSourcesForUser(workspaceId, userId);
  const source = sources.find(item => item.id === sourceId) ?? null;
  if (!source) {
    throw statusError(404, `Source not found for workspace ${workspaceId}: ${sourceId}`);
  }
  return source;
}

function scheduleSourceVerification(
  source: Source,
  workspaceId: string,
  userId: string,
  storageConfig = getConfig(),
): Promise<Source> {
  const existing = sourceVerificationJobs.get(source.id);
  if (existing) {
    return existing;
  }
  const job = (async () => {
    if (source.type === "upload-archive") {
      await setSourceVerificationState(source.id, "pending", null);
      try {
        await ensureGitReviewRepo(source, storageConfig, { requireReadyCache: false });
        await setSourceVerificationState(source.id, "verified", null);
      } catch (error) {
        await setSourceVerificationState(source.id, "failed", verificationErrorMessage(error));
        throw error;
      }
      return await refreshWorkspaceSource(workspaceId, userId, source.id);
    }
    return await verifySourceForUser(source.id);
  })()
    .then(async verifiedSource => {
      if (verifiedSource.verificationStatus === "verified" && verifiedSource.type !== "upload-archive") {
        void scheduleCodeReviewPrewarm(verifiedSource, storageConfig).catch(error => {
          logSourcePrewarmFailure(verifiedSource, error);
        });
      }
      return verifiedSource;
    })
    .catch(error => {
      logSourceVerificationFailure(source, error);
      throw error;
    })
    .finally(() => {
      if (sourceVerificationJobs.get(source.id) === job) {
        sourceVerificationJobs.delete(source.id);
      }
    });
  sourceVerificationJobs.set(source.id, job);
  return job;
}

function schedulePendingSourceVerifications(
  sources: Source[],
  workspaceId: string,
  userId: string,
  storageConfig = getConfig(),
): void {
  for (const source of sources) {
    if (source.verificationStatus === "pending") {
      void scheduleSourceVerification(source, workspaceId, userId, storageConfig).catch(() => undefined);
    }
  }
}

async function currentUser(request: {
  headers: { authorization?: string | string[] | undefined; cookie?: string | null | undefined };
}) {
  return resolveAuthenticatedUser({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
  });
}

async function currentAdminUser(request: {
  headers: { authorization?: string | string[] | undefined; cookie?: string | null | undefined };
}) {
  return assertAdminUser(await currentUser(request));
}

function resolveRequestOrigin(request: {
  headers: { "x-forwarded-proto"?: string | string[] | undefined; "x-forwarded-host"?: string | string[] | undefined; "x-forwarded-port"?: string | string[] | undefined; host?: string | string[] | undefined };
  protocol?: string;
  url?: string;
}): string {
  const forwardedProto = Array.isArray(request.headers["x-forwarded-proto"]) ? request.headers["x-forwarded-proto"][0] : request.headers["x-forwarded-proto"];
  const forwardedHost = Array.isArray(request.headers["x-forwarded-host"]) ? request.headers["x-forwarded-host"][0] : request.headers["x-forwarded-host"];
  const forwardedPort = Array.isArray(request.headers["x-forwarded-port"]) ? request.headers["x-forwarded-port"][0] : request.headers["x-forwarded-port"];
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host;
  const fallbackUrl = `${request.protocol ?? "http"}://${host ?? "localhost"}${request.url ?? "/"}`;
  return resolveGithubRequestOrigin({
    requestUrl: fallbackUrl,
    forwardedProto: forwardedProto ?? null,
    forwardedHost: forwardedHost ?? null,
    forwardedPort: forwardedPort ?? null,
    configuredBaseUrl: getConfig().appUrl,
  });
}

function buildConfiguredAppUrl(pathname: string, searchParams?: Record<string, string>): string {
  const url = new URL(getConfig().appUrl);
  url.pathname = path.posix.join(url.pathname.replace(/\/+$/, "") || "/", pathname.replace(/^\/+/, ""));
  url.search = "";
  url.hash = "";
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function safeFilename(value: string): string {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-") || "upload.bin";
}

function isGithubRepoLocation(location: string): boolean {
  return /github\.com[:/]/i.test(location);
}

function getCodexAuthConfig() {
  const deviceCodeUrl = process.env.CODEX_OAUTH_DEVICE_CODE_URL ?? null;
  const tokenUrl = process.env.CODEX_OAUTH_TOKEN_URL ?? null;
  const clientId = process.env.CODEX_OAUTH_CLIENT_ID ?? null;
  const scope = process.env.CODEX_OAUTH_SCOPES ?? null;
  const audience = process.env.CODEX_OAUTH_AUDIENCE ?? null;
  if (!deviceCodeUrl || !tokenUrl || !clientId) {
    throw statusError(500, "CODEX_OAUTH_DEVICE_CODE_URL, CODEX_OAUTH_TOKEN_URL, and CODEX_OAUTH_CLIENT_ID are required.");
  }
  return { deviceCodeUrl, tokenUrl, clientId, scope, audience };
}

function resolveCodexDeviceFlowUrls(config: ReturnType<typeof getCodexAuthConfig>) {
  let deviceUrl: URL;
  try {
    deviceUrl = new URL(config.deviceCodeUrl);
  } catch (error) {
    throw statusError(500, `CODEX_OAUTH_DEVICE_CODE_URL must be a valid URL. ${(error as Error).message}`);
  }
  const deviceAuthTokenUrl = new URL(deviceUrl.toString());
  if (deviceAuthTokenUrl.pathname.endsWith("/deviceauth/usercode")) {
    deviceAuthTokenUrl.pathname = deviceAuthTokenUrl.pathname.replace(/\/deviceauth\/usercode$/, "/deviceauth/token");
  } else {
    deviceAuthTokenUrl.pathname = "/api/accounts/deviceauth/token";
  }
  const issuer = deviceUrl.origin;
  return {
    deviceAuthTokenUrl: deviceAuthTokenUrl.toString(),
    verificationUri: `${issuer}/codex/device`,
    redirectUri: `${issuer}/deviceauth/callback`,
  };
}

async function queueJob(jobId: string) {
  await dispatchRunnerJob(jobId);
  return await getJobEnvelopeById(jobId);
}

async function createDurableExport(report: Awaited<ReturnType<typeof getReportForUser>>) {
  const exportId = `${report.jobId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  const exportDir = createHomeTempDirSync(`speclens-export-${exportId}-`);
  fs.mkdirSync(exportDir, { recursive: true });
  const operations = report.findings.map(finding => ({
    findingId: finding.id,
    severity: finding.severity,
    title: finding.title,
    suggestion: finding.suggestion,
  }));
  const bundlePath = path.join(exportDir, "patch-bundle.json");
  const readmePath = path.join(exportDir, "README.md");
  const archivePath = path.join(exportDir, `${exportId}.tar.gz`);
  fs.writeFileSync(bundlePath, `${JSON.stringify({
    exportId,
    runId: report.jobId,
    reportId: report.id,
    createdAt: new Date().toISOString(),
    operations,
  }, null, 2)}\n`);
  fs.writeFileSync(readmePath, [
    `# Patch Export ${exportId}`,
    "",
    `Run: \`${report.jobId}\``,
    `Report: \`${report.id}\``,
    "",
    "This export is a reviewable change manifest generated by SpecLens.",
    "It does not mutate the target repository.",
    "",
    "## Selected findings",
    "",
    ...operations.map(operation => `- \`${operation.findingId}\` (${operation.severity}): ${operation.title} -> ${operation.suggestion}`),
  ].join("\n"));
  await tar.c({
    gzip: true,
    cwd: exportDir,
    file: archivePath,
  }, ["README.md", "patch-bundle.json"]);

  return {
    exportId,
    exportDir,
    bundlePath,
    readmePath,
    archivePath,
    operations,
  };
}
function isFinalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function resolveLogVisibility(value: unknown): "default" | "verbose" {
  return value === "verbose" ? "verbose" : "default";
}

export async function registerDurableRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/analysis-tasks", async request => {
    await currentUser(request);
    return {
      tasks: await listAiAnalysisTasks(),
    };
  });

  app.get("/api/roles", async () => ({
    roles: listRoleDefinitions(),
  }));

  app.get("/api/capabilities", async () => ({
    capabilities: listRoleDefinitions().map(role => ({
      id: role.id,
      title: role.title,
      description: role.description,
      order: role.order,
    })),
  }));

  app.get("/api/providers/ai", async () => ({
    providers: listAiProviders(),
  }));

  app.get("/api/admin/ai/auth/status", async request => {
    await currentAdminUser(request);
    return {
      auth: await getCodexAuthStatus(),
    };
  });

  app.post("/api/admin/ai/auth/device", async request => {
    await currentAdminUser(request);
    const config = getCodexAuthConfig();
    const deviceFlowUrls = resolveCodexDeviceFlowUrls(config);
    const body = JSON.stringify({
      client_id: config.clientId,
    });
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
    if (!response.ok) {
      const message = await response.text();
      throw statusError(502, message || `Device auth request failed: ${response.status}`);
    }
    const payload = await response.json() as {
      device_auth_id?: string;
      device_code?: string;
      user_code?: string;
      usercode?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number | string;
    };
    const deviceCode = payload.device_auth_id ?? payload.device_code ?? null;
    const userCode = payload.user_code ?? payload.usercode ?? null;
    if (!deviceCode || !userCode) {
      throw statusError(502, "Device auth response missing required fields.");
    }
    const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 15 * 60;
    let intervalSeconds: number | null = null;
    if (typeof payload.interval === "number" && payload.interval > 0) {
      intervalSeconds = Math.round(payload.interval);
    } else if (typeof payload.interval === "string") {
      const parsed = Number.parseInt(payload.interval, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        intervalSeconds = parsed;
      }
    }
    const status = await startCodexDeviceFlow({
      deviceCode,
      userCode,
      verificationUri: payload.verification_uri ?? deviceFlowUrls.verificationUri,
      verificationUriComplete: payload.verification_uri_complete ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      intervalSeconds,
    });
    return { auth: status };
  });

  app.post("/api/admin/ai/auth/verify", async request => {
    await currentAdminUser(request);
    const config = getCodexAuthConfig();
    const deviceFlowUrls = resolveCodexDeviceFlowUrls(config);
    const record = await getCodexAuthRecord();
    if (!record || record.status !== "pending" || !record.deviceCode || !record.userCode) {
      return { auth: await getCodexAuthStatus() };
    }
    const deviceAuthBody = JSON.stringify({
      device_auth_id: record.deviceCode,
      user_code: record.userCode,
    });
    const deviceAuthResponse = await fetch(deviceFlowUrls.deviceAuthTokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: deviceAuthBody,
      cache: "no-store",
    });
    if (deviceAuthResponse.status === 403 || deviceAuthResponse.status === 404) {
      return { auth: await getCodexAuthStatus() };
    }
    if (!deviceAuthResponse.ok) {
      const message = await deviceAuthResponse.text();
      return { auth: await setCodexAuthError(message || `Device auth polling failed: ${deviceAuthResponse.status}`) };
    }
    const devicePayload = await deviceAuthResponse.json() as {
      authorization_code?: string;
      code_challenge?: string;
      code_verifier?: string;
      error?: string;
      error_description?: string;
    };
    if (!devicePayload.authorization_code || !devicePayload.code_verifier) {
      const message = devicePayload.error_description ?? devicePayload.error ?? "Device auth response missing authorization code.";
      return { auth: await setCodexAuthError(message) };
    }
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: devicePayload.authorization_code,
      redirect_uri: deviceFlowUrls.redirectUri,
      client_id: config.clientId,
      code_verifier: devicePayload.code_verifier,
    });
    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody,
      cache: "no-store",
    });
    const payload = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      account_id?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenResponse.ok) {
      const message = payload.error_description ?? payload.error ?? `Token exchange failed: ${tokenResponse.status}`;
      return { auth: await setCodexAuthError(message) };
    }
    if (!payload.access_token) {
      return { auth: await setCodexAuthError("Token exchange succeeded without an access token.") };
    }
    const auth = await storeCodexTokens({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      idToken: payload.id_token ?? null,
      accountId: payload.account_id ?? null,
    });
    return { auth };
  });

  app.post("/api/admin/ai/auth/logout", async request => {
    await currentAdminUser(request);
    return {
      auth: await clearCodexAuth(),
    };
  });

  app.get("/api/admin/ai/skills", async request => {
    await currentAdminUser(request);
    return {
      skills: await listAiSkills(),
    };
  });

  app.post("/api/admin/ai/skills", async request => {
    await currentAdminUser(request);
    const input = createAiSkillInputSchema.parse(request.body);
    return { skill: await createAiSkill(input) };
  });

  app.put("/api/admin/ai/skills/:skillId", async request => {
    await currentAdminUser(request);
    const skillId = (request.params as { skillId: string }).skillId;
    const input = createAiSkillInputSchema.parse(request.body);
    return { skill: await updateAiSkill(skillId, input) };
  });

  app.delete("/api/admin/ai/skills/:skillId", async request => {
    await currentAdminUser(request);
    const skillId = (request.params as { skillId: string }).skillId;
    await deleteAiSkill(skillId);
    return { ok: true };
  });

  app.get("/api/admin/ai/roles", async request => {
    await currentAdminUser(request);
    return {
      roles: await listAiRoles(),
    };
  });

  app.post("/api/admin/ai/roles", async request => {
    await currentAdminUser(request);
    const input = createAiRoleInputSchema.parse(request.body);
    return { role: await createAiRole(input) };
  });

  app.put("/api/admin/ai/roles/:roleId", async request => {
    await currentAdminUser(request);
    const roleId = (request.params as { roleId: string }).roleId;
    const input = createAiRoleInputSchema.parse(request.body);
    return { role: await updateAiRole(roleId, input) };
  });

  app.delete("/api/admin/ai/roles/:roleId", async request => {
    await currentAdminUser(request);
    const roleId = (request.params as { roleId: string }).roleId;
    await deleteAiRole(roleId);
    return { ok: true };
  });

  app.get("/api/admin/ai/agents", async request => {
    await currentAdminUser(request);
    return {
      agents: await listAiAgents(),
    };
  });

  app.post("/api/admin/ai/agents", async request => {
    await currentAdminUser(request);
    const input = createAiAgentInputSchema.parse(request.body);
    return { agent: await createAiAgent(input) };
  });

  app.put("/api/admin/ai/agents/:agentId", async request => {
    await currentAdminUser(request);
    const agentId = (request.params as { agentId: string }).agentId;
    const input = createAiAgentInputSchema.parse(request.body);
    return { agent: await updateAiAgent(agentId, input) };
  });

  app.delete("/api/admin/ai/agents/:agentId", async request => {
    await currentAdminUser(request);
    const agentId = (request.params as { agentId: string }).agentId;
    await deleteAiAgent(agentId);
    return { ok: true };
  });

  app.post("/api/admin/ai/agents/:agentId/run", async request => {
    await currentAdminUser(request);
    const user = await currentUser(request);
    const agentId = (request.params as { agentId: string }).agentId;
    const input = createAgentJobInputSchema.parse(request.body);
    if (!("workspaceId" in (request.body as Record<string, unknown>))) {
      throw statusError(400, "workspaceId is required.");
    }
    const workspaceId = String((request.body as Record<string, unknown>).workspaceId);
    const job = await createAgentJobForUser(workspaceId, user.id, agentId, {
      sourceId: input.sourceId,
      companionSourceId: input.companionSourceId,
      runtimeMode: input.runtimeMode,
      secretRefs: input.secretRefs,
    }, { requestId: request.requestId });
    return {
      job: await queueJob(job.job.id),
    };
  });

  app.post("/api/commercial-contact", async (request, reply) => {
    const input = commercialContactInputSchema.parse(request.body);
    const record = await createCommercialContactRequest(input);
    reply.status(202);
    return {
      request: record,
    };
  });

  app.get("/api/me", async request => ({
    user: await currentUser(request),
  }));

  app.get("/api/workspaces", async request => {
    const user = await currentUser(request);
    const query = resolveListQuery((request.query as Record<string, unknown> | undefined) ?? {});
    const result = await listWorkspaceSummariesPageForUser(user.id, query);
    return {
      items: result.items,
      pageInfo: result.pageInfo,
      workspaces: result.items,
    };
  });

  app.post("/api/workspaces", async request => {
    const user = await currentUser(request);
    const input = createWorkspaceInputSchema.parse(request.body);
    const workspace = await createWorkspaceForUser(user, input);
    await recordAuditLog({
      userId: user.id,
      workspaceId: workspace.id,
      action: "workspace.create",
      targetType: "workspace",
      targetId: workspace.id,
      requestId: request.requestId,
    });
    return { workspace };
  });

  app.get("/api/workspaces/:workspaceId", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const detail = await getWorkspaceDetailForUser(workspaceId, user.id);
    schedulePendingSourceVerifications(detail.sources, workspaceId, user.id);
    return detail;
  });

  app.get("/api/workspaces/:workspaceId/members", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const query = resolveListQuery((request.query as Record<string, unknown> | undefined) ?? {});
    return await listWorkspaceMembersPageForUser(workspaceId, user.id, query);
  });

  app.post("/api/workspaces/:workspaceId/members", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const input = createWorkspaceMemberInputSchema.parse(request.body ?? {});
    const membership = await addWorkspaceMember(workspaceId, user.id, input);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.member.add",
      targetType: "workspaceMembership",
      targetId: membership.id,
      metadata: { targetUserId: membership.userId, targetEmail: membership.email },
      requestId: request.requestId,
    });
    return { membership };
  });

  app.delete("/api/workspaces/:workspaceId/members/:membershipId", async request => {
    const user = await currentUser(request);
    const { workspaceId, membershipId } = request.params as { workspaceId: string; membershipId: string };
    const removed = await removeWorkspaceMember(workspaceId, user.id, membershipId);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.member.remove",
      targetType: "workspaceMembership",
      targetId: removed.removedMembershipId,
      requestId: request.requestId,
    });
    return removed;
  });

  app.get("/api/workspaces/:workspaceId/sources", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const pageQuery = resolveListQuery(query);
    const type = query.type === "git-public" || query.type === "github-private" || query.type === "upload-archive"
      ? query.type
      : null;
    const result = await listWorkspaceSourcesPageForUser(workspaceId, user.id, {
      ...pageQuery,
      type,
    });
    schedulePendingSourceVerifications(result.items, workspaceId, user.id);
    return result;
  });

  app.post("/api/workspaces/:workspaceId/sources/:sourceId/verify", async request => {
    const user = await currentUser(request);
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    const detail = await getWorkspaceDetailForUser(workspaceId, user.id);
    if (detail.workspace.ownerUserId !== user.id) {
      throw statusError(403, `Owner access is required for workspace ${workspaceId}.`);
    }
    const source = detail.sources.find(item => item.id === sourceId) ?? null;
    if (!source) {
      throw statusError(404, `Source not found for workspace ${workspaceId}: ${sourceId}`);
    }
    const verifiedSource = await scheduleSourceVerification(source, workspaceId, user.id);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.source.verify",
      targetType: "source",
      targetId: source.id,
      metadata: {
        type: source.type,
        location: source.location,
        verificationStatus: verifiedSource.verificationStatus,
      },
      requestId: request.requestId,
    });
    return {
      source: verifiedSource,
    };
  });

  app.patch("/api/workspaces/:workspaceId/sources/:sourceId", async request => {
    const user = await currentUser(request);
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    const input = updateSourceInputSchema.parse(request.body ?? {});
    const source = await updateSourceForUser(workspaceId, user.id, sourceId, input);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.source.update",
      targetType: "source",
      targetId: source.id,
      metadata: { displayName: source.displayName },
      requestId: request.requestId,
    });
    return { source };
  });

  app.delete("/api/workspaces/:workspaceId/sources/:sourceId", async request => {
    const user = await currentUser(request);
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    const removed = await deleteSourceForUser(workspaceId, user.id, sourceId, getConfig());
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.source.delete",
      targetType: "source",
      targetId: removed.removedSourceId,
      requestId: request.requestId,
    });
    return removed;
  });

  app.get("/api/workspaces/:workspaceId/sources/:sourceId/learnables", async request => {
    const user = await currentUser(request);
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    return {
      learnables: await listSourceLearnablesForUser(workspaceId, sourceId, user.id),
    };
  });

  app.get("/api/workspaces/:workspaceId/code/review", async request => {
    const user = await currentUser(request);
    const { workspaceId } = request.params as { workspaceId: string };
    const query = request.query as Record<string, unknown>;
    const sourceId = typeof query.sourceId === "string" ? query.sourceId : null;
    const requestedRef = typeof query.ref === "string" ? query.ref : null;
    const requestedPath = typeof query.path === "string" ? query.path : null;
    const compareRef = typeof query.compare === "string" ? query.compare : null;
    const activeReportId = typeof query.reportId === "string" ? query.reportId : null;
    const activeFindingId = typeof query.findingId === "string" ? query.findingId : null;
    const requestedPr = typeof query.pr === "string" ? Number.parseInt(query.pr, 10) : Number.NaN;

    const workspaceDetail = await getWorkspaceDetailForUser(workspaceId, user.id);
    if (workspaceDetail.sources.length === 0) {
      throw statusError(404, `No sources available for workspace ${workspaceId}.`);
    }
    const source = sourceId
      ? workspaceDetail.sources.find(item => item.id === sourceId) ?? null
      : workspaceDetail.sources.length === 1
        ? workspaceDetail.sources[0] ?? null
        : null;
    if (!source && sourceId) {
      throw statusError(404, `Source not found for workspace ${workspaceId}: ${sourceId}`);
    }
    if (!source) {
      throw statusError(400, "sourceId is required when more than one Git source is available for code review.");
    }
    if (source.verificationStatus === "pending") {
      throw statusError(400, `${source.displayName} is still verifying and is not ready for code review yet.`);
    }
    if (source.verificationStatus === "failed") {
      throw statusError(400, source.verificationError || `${source.displayName} failed source verification.`);
    }

    const relevantReports = workspaceDetail.jobs
      .filter(job =>
        job.report
        && (job.job.sourceId === source.id || job.job.companionSourceId === source.id),
      )
      .map(job => job.report!)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const activeReport = activeReportId
      ? relevantReports.find(report => report.id === activeReportId) ?? null
      : relevantReports[0] ?? null;
    if (activeReportId && !activeReport) {
      throw statusError(404, `Report ${activeReportId} is not available for source ${source.id}.`);
    }

    const remediationJobs = await listRemediationJobsForSourceForUser(workspaceId, source.id, user.id);
    const changesets = remediationJobs
      .filter(job => job.job.changeset)
      .map(job => ({
        jobId: job.job.id,
        reportId: job.job.parentReportId,
        sourceId: job.job.sourceId,
        createdAt: job.job.finishedAt ?? job.job.createdAt,
        branchName: job.job.changeset?.branchName ?? null,
        stopReason: job.job.changeset?.stopReason ?? "audit-only-complete",
        changedFiles: job.job.changeset?.changedFiles ?? [],
        validationCommands: job.job.changeset?.validationCommands ?? [],
        validationPassed: job.job.changeset?.validationPassed ?? false,
        pullInstructions: job.job.changeset?.pullInstructions ?? [],
        prUrl: job.job.changeset?.prUrl ?? null,
      }));

    const selectedPullRequest = Number.isFinite(requestedPr) ? requestedPr : null;
    const githubBackedSource = isGithubRepoLocation(source.location);
    if (selectedPullRequest && !githubBackedSource) {
      throw statusError(400, "Pull request review is only available for GitHub-backed sources.");
    }
    const pullRequestDetail = selectedPullRequest
      ? await getGithubPullRequest(source.location, source.githubInstallationId, selectedPullRequest)
      : null;
    const resolvedCompareRef = compareRef ?? pullRequestDetail?.baseRef ?? null;
    const resolvedRef = requestedRef ?? pullRequestDetail?.headRef ?? null;
    let review: Awaited<ReturnType<typeof readCodeReviewFromSource>>;
    try {
      review = await readCodeReviewFromSource(source, getConfig(), {
        ref: resolvedRef,
        path: requestedPath,
        compare: resolvedCompareRef,
        requireReadyCache: true,
      });
    } catch (error) {
      if (error instanceof CodeReviewCacheNotReadyError) {
        void scheduleCodeReviewPrewarm(source, getConfig()).catch(() => undefined);
        throw statusError(409, error.message);
      }
      if (error instanceof CodeReviewReferenceNotFoundError) {
        throw statusError(404, error.message);
      } else {
        throw error;
      }
    }

    const changedPaths = new Set(changesets.flatMap(changeset => changeset.changedFiles));
    const activeFindings = (activeReport?.findings ?? []).filter(finding =>
      finding.sourceIds.includes(source.id),
    );
    const unattributedFindings = (activeReport?.findings ?? []).filter(finding => finding.sourceIds.length === 0);
    const selectedFinding = activeFindingId
      ? [...activeFindings, ...unattributedFindings].find(finding => finding.id === activeFindingId) ?? null
      : null;
    if (activeFindingId && !selectedFinding) {
      throw statusError(404, `Finding ${activeFindingId} is not available for source ${source.id}.`);
    }
    const tree = review.tree.map(entry => ({
      ...entry,
      changed: entry.kind === "file"
        ? changedPaths.has(entry.path)
        : [...changedPaths].some(changedPath => changedPath.startsWith(`${entry.path}/`)),
      hasFindings: activeFindings.some(finding =>
        finding.paths.some(findingPath =>
          entry.kind === "file"
            ? findingPath === entry.path
            : findingPath === entry.path || findingPath.startsWith(`${entry.path}/`),
        ),
      ),
    }));

    return {
      review: codeReviewPayloadSchema.parse({
        workspaceId,
        source: {
          id: source.id,
          displayName: source.displayName,
          type: source.type,
          location: source.location,
        },
        refs: review.refs,
        selectedRef: review.selectedRef,
        selectedPath: review.selectedPath,
        compareRef: review.compareRef,
        fileContent: review.fileContent,
        diff: review.diff,
        tree,
        findings: activeFindings,
        unattributedFindings,
        remediationPacks: activeReport?.summary.remediationPacks ?? [],
        fixHandoff: activeReport?.summary.fixHandoff ?? null,
        changesets,
        selectedPullRequest: pullRequestDetail ?? null,
        prSupport: isGithubRepoLocation(source.location) ? "available" : "unavailable",
        activeReportId: activeReport?.id ?? null,
        activeFindingId: selectedFinding?.id ?? null,
      }),
    };
  });

  app.get("/api/workspaces/:workspaceId/code/pulls", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const query = (request.query as Record<string, unknown>) ?? {};
    const sourceId = typeof query.sourceId === "string" ? query.sourceId : null;
    if (!sourceId) {
      throw statusError(400, "sourceId is required for pull request review.");
    }

    const workspaceDetail = await getWorkspaceDetailForUser(workspaceId, user.id);
    const source = workspaceDetail.sources.find(item => item.id === sourceId) ?? null;
    if (!source) {
      throw statusError(404, `Source not found for workspace ${workspaceId}: ${sourceId}`);
    }

    if (!isGithubRepoLocation(source.location)) {
      return {
        prSupport: "unavailable" as const,
        pullRequests: [],
      };
    }

    return {
      prSupport: "available" as const,
      pullRequests: await listGithubPullRequests(source.location, source.githubInstallationId),
    };
  });

  app.post("/api/workspaces/:workspaceId/sources", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const input = addSourceInputSchema.parse(request.body);
    const source = await createSourceForUser(workspaceId, user.id, input);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.source.create",
      targetType: "source",
      targetId: source.id,
      metadata: { type: source.type, location: source.location },
      requestId: request.requestId,
    });
    if (source.verificationStatus === "verified") {
      void scheduleCodeReviewPrewarm(source, getConfig()).catch(() => undefined);
    } else if (source.verificationStatus === "pending") {
      void scheduleSourceVerification(source, workspaceId, user.id, getConfig()).catch(() => undefined);
    }
    return { source };
  });

  app.post("/api/workspaces/:workspaceId/uploads", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const upload = await request.file();
    if (!upload) {
      throw statusError(400, "No archive file was uploaded.");
    }

    const config = getConfig();
    const uploadId = `${Date.now()}-${safeFilename(upload.filename)}`;
    const stagingDir = createHomeTempDirSync("speclens-upload-");
    const tempPath = path.join(stagingDir, uploadId);
    await pipeline(upload.file, fs.createWriteStream(tempPath));
    const archiveInspection = await inspectGitRepositoryArchiveFileAsync(tempPath, upload.filename);
    if (!archiveInspection.ok) {
      throw statusError(400, archiveInspection.message);
    }
    const objectKey = `uploads/${workspaceId}/${uploadId}`;
    try {
      await putObjectFromFile(config, objectKey, tempPath, upload.mimetype || "application/octet-stream", {
        kind: "artifact",
      });
      const source = await createUploadSourceForUser(workspaceId, user.id, {
        displayName: upload.filename,
        location: upload.filename,
        uploadObjectKey: objectKey,
      });
      await recordAuditLog({
        userId: user.id,
        workspaceId,
        action: "workspace.source.upload",
        targetType: "source",
        targetId: source.id,
        metadata: { objectKey },
        requestId: request.requestId,
      });
      void scheduleCodeReviewPrewarm(source, config).catch(() => undefined);
      return { source };
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  app.get("/api/workspaces/:workspaceId/secrets", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const query = resolveListQuery((request.query as Record<string, unknown> | undefined) ?? {});
    return await listWorkspaceSecretsPageForUser(workspaceId, user.id, query);
  });

  app.post("/api/workspaces/:workspaceId/secrets", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const input = createWorkspaceSecretInputSchema.parse(request.body);
    const secret = await createWorkspaceSecretForUser(workspaceId, user.id, input);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.secret.create",
      targetType: "workspaceSecret",
      targetId: secret.id,
      metadata: { name: secret.name, kind: secret.kind },
      requestId: request.requestId,
    });
    return { secret };
  });

  app.patch("/api/workspaces/:workspaceId/secrets/:secretId", async request => {
    const user = await currentUser(request);
    const { workspaceId, secretId } = request.params as { workspaceId: string; secretId: string };
    const input = updateWorkspaceSecretInputSchema.parse(request.body ?? {});
    const secret = await updateWorkspaceSecretForUser(workspaceId, user.id, secretId, input);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.secret.update",
      targetType: "workspaceSecret",
      targetId: secret.id,
      metadata: { name: secret.name, kind: secret.kind },
      requestId: request.requestId,
    });
    return { secret };
  });

  app.delete("/api/workspaces/:workspaceId/secrets/:secretId", async request => {
    const user = await currentUser(request);
    const { workspaceId, secretId } = request.params as { workspaceId: string; secretId: string };
    const removed = await deleteWorkspaceSecretForUser(workspaceId, user.id, secretId);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "workspace.secret.delete",
      targetType: "workspaceSecret",
      targetId: removed.removedSecretId,
      requestId: request.requestId,
    });
    return removed;
  });

  app.post("/api/workspaces/:workspaceId/analyze", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const taskInput = queueAnalysisTaskInputSchema.parse(request.body);
    const job = await createAgentJobForUser(
      workspaceId,
      user.id,
      taskInput.agentId,
      {
        sourceId: taskInput.sourceId,
        companionSourceId: taskInput.companionSourceId,
        runtimeMode: taskInput.runtimeMode,
        secretRefs: taskInput.secretRefs,
      },
      { requestId: request.requestId },
    );
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "job.create",
      targetType: "analysisJob",
      targetId: job.job.id,
      metadata: {
        sourceId: job.job.sourceId,
        companionSourceId: job.job.companionSourceId,
        agentId: job.job.agentId,
        submissionMode: "analysis-task",
      },
      requestId: request.requestId,
    });
    recordJobEvent("queued");
    return {
      job: await queueJob(job.job.id),
    };
  });

  app.get("/api/jobs", async request => {
    const user = await currentUser(request);
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const pageQuery = resolveListQuery(query);
    const status = query.status === "pending"
      || query.status === "queued"
      || query.status === "running"
      || query.status === "succeeded"
      || query.status === "failed"
      || query.status === "cancelled"
      ? query.status
      : null;
    const hasReport = query.hasReport === "true"
      ? true
      : query.hasReport === "false"
        ? false
        : undefined;
    return await listJobsPageForUser(user.id, {
      ...pageQuery,
      ...(typeof query.workspaceId === "string" ? { workspaceId: query.workspaceId } : {}),
      ...(status ? { status } : {}),
      ...(hasReport === undefined ? {} : { hasReport }),
    });
  });

  app.get("/api/jobs/:jobId", async request => {
    const user = await currentUser(request);
    const jobId = (request.params as { jobId: string }).jobId;
    const visibility = resolveLogVisibility((request.query as Record<string, unknown> | undefined)?.verbosity);
    return {
      job: await getJobEnvelopeForUser(jobId, user.id, { logVisibility: visibility }),
    };
  });

  app.post("/api/jobs/:jobId/cancel", async request => {
    const user = await currentUser(request);
    const jobId = (request.params as { jobId: string }).jobId;
    const cancelled = await requestJobCancellationForUser(jobId, user.id, { requestId: request.requestId });
    if (cancelled.shouldCancelQueueMessage && cancelled.queueMessageId) {
      if (cancelled.executionPath === "unified-agent") {
        await cancelAgentJob(cancelled.queueMessageId);
      } else {
        await cancelRunnerJob(cancelled.queueMessageId);
      }
    }
    await recordAuditLog({
      userId: user.id,
      workspaceId: cancelled.job.job.workspaceId,
      action: "job.cancel",
      targetType: "analysisJob",
      targetId: jobId,
      requestId: request.requestId,
    });
    recordJobEvent("cancelled");
    return {
      job: await getJobEnvelopeForUser(jobId, user.id),
    };
  });

  app.post("/api/jobs/:jobId/retry", async request => {
    const user = await currentUser(request);
    const jobId = (request.params as { jobId: string }).jobId;
    const retried = await retryAnalysisJobForUser(jobId, user.id);
    await recordAuditLog({
      userId: user.id,
      workspaceId: retried.job.workspaceId,
      action: "job.retry",
      targetType: "analysisJob",
      targetId: retried.job.id,
      requestId: request.requestId,
    });
    recordJobEvent("retried");
    return {
      job: await queueJob(retried.job.id),
    };
  });

  app.get("/api/jobs/:jobId/logs", async request => {
    const user = await currentUser(request);
    const jobId = (request.params as { jobId: string }).jobId;
    const visibility = resolveLogVisibility((request.query as Record<string, unknown> | undefined)?.verbosity);
    const envelope = await getJobEnvelopeForUser(jobId, user.id, { logVisibility: visibility });
    return {
      logs: envelope.logs,
    };
  });

  app.get("/api/jobs/:jobId/logs/stream", async (request, reply) => {
    const user = await currentUser(request);
    const jobId = (request.params as { jobId: string }).jobId;
    const visibility = resolveLogVisibility((request.query as Record<string, unknown> | undefined)?.verbosity);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    });
    await streamLogs(request, reply, user.id, jobId, visibility);
    return reply;
  });

  app.get("/api/reports/:reportId", async request => {
    const user = await currentUser(request);
    const reportId = (request.params as { reportId: string }).reportId;
    return {
      report: await getReportForUser(reportId, user.id),
    };
  });

  app.get("/api/jobs/:jobId/artifacts", async request => {
    const user = await currentUser(request);
    const jobId = (request.params as { jobId: string }).jobId;
    return {
      artifacts: await listArtifactsForJobForUser(jobId, user.id),
    };
  });

  app.get("/api/jobs/:jobId/artifacts/:artifactIndex", async (request, reply) => {
    const user = await currentUser(request);
    const { jobId, artifactIndex } = request.params as { jobId: string; artifactIndex: string };
    const artifact = await getArtifactForJobForUser(jobId, Number.parseInt(artifactIndex, 10), user.id);
    if (artifact.signedUrl) {
      return reply.redirect(artifact.signedUrl);
    }
    const config = getConfig();
    const absolutePath = resolveObjectStoragePath(config, artifact.key);
    const tempDownloadPath = path.resolve(
      process.cwd(),
      ".speclens-workspace/downloads",
      jobId,
      `${Date.now()}-${safeFilename(path.basename(artifact.key))}`,
    );
    const filePath = config.objectStorageProvider === "local"
      ? absolutePath
      : await downloadObjectToFile(config, artifact.key, tempDownloadPath);
    if (config.objectStorageProvider !== "local") {
      reply.raw.on("close", () => {
        fs.rmSync(tempDownloadPath, { force: true });
      });
    }
    if (!fs.existsSync(filePath)) {
      throw statusError(404, `Artifact file missing: ${artifact.key}`);
    }
    reply.header("content-type", artifact.mimeType);
    return reply.send(fs.createReadStream(filePath));
  });

  app.post("/api/reports/:reportId/export", async request => {
    const user = await currentUser(request);
    const reportId = (request.params as { reportId: string }).reportId;
    const report = await getReportForUser(reportId, user.id);
    const generatedExport = await createDurableExport(report);
    try {
      const artifact = await putObjectFromFile(
        getConfig(),
        `exports/reports/${report.id}/${path.basename(generatedExport.archivePath)}`,
        generatedExport.archivePath,
        "application/gzip",
        {
          kind: "patch-bundle",
          jobId: report.jobId,
          reportId: report.id,
        },
      );
      const prisma = getPrismaClient();
      const persistedArtifact = await prisma.artifactReference.create({
        data: {
          jobId: report.jobId,
          reportId: report.id,
          kind: artifact.kind ?? "patch-bundle",
          objectKey: artifact.key,
          bucket: artifact.bucket,
          region: artifact.region,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          signedUrl: artifact.signedUrl ?? null,
        },
      });
      const artifacts = await listArtifactsForJobForUser(report.jobId, user.id);
      const downloadUrl = persistedArtifact.signedUrl
        ?? durableArtifactHelpers.buildJobArtifactProxyDownloadUrl(report.jobId, persistedArtifact.id, artifacts);
      return reportExportResponseSchema.parse({
        artifact: {
          id: persistedArtifact.id,
          jobId: persistedArtifact.jobId,
          reportId: persistedArtifact.reportId,
          kind: persistedArtifact.kind,
          key: persistedArtifact.objectKey,
          bucket: persistedArtifact.bucket,
          region: persistedArtifact.region,
          mimeType: persistedArtifact.mimeType,
          sizeBytes: persistedArtifact.sizeBytes,
          ...(persistedArtifact.signedUrl ? { signedUrl: persistedArtifact.signedUrl } : {}),
          createdAt: persistedArtifact.createdAt.toISOString(),
        },
        downloadUrl,
      });
    } finally {
      fs.rmSync(generatedExport.exportDir, { recursive: true, force: true });
    }
  });

  app.post("/api/reports/:reportId/remediate", async request => {
    const user = await currentUser(request);
    const reportId = (request.params as { reportId: string }).reportId;
    const input = createRemediationTaskInputSchema.parse(request.body ?? {});
    const allowAdmin = (() => {
      try {
        assertAdminUser(user);
        return true;
      } catch {
        return false;
      }
    })();
    const job = await createRemediationJobForUser(reportId, user.id, input, {
      requestId: request.requestId,
      allowAdmin,
    });
    await recordAuditLog({
      userId: user.id,
      workspaceId: job.job.workspaceId,
      action: "report.remediate",
      targetType: "analysisJob",
      targetId: job.job.id,
      metadata: {
        reportId,
        jobId: job.job.id,
        sourceId: input.sourceId,
        baseRef: input.baseRef,
        selectionMode: input.selectionMode,
        maxIterations: input.maxIterations,
        outputMode: input.outputMode,
        publishRemote: input.publishRemote,
      },
      requestId: request.requestId,
    });
    return { job };
  });

  app.post("/api/billing/checkout", async request => {
    const user = await currentUser(request);
    const input = billingCheckoutInputSchema.parse(request.body ?? {});
    const successUrl = process.env.STRIPE_SUCCESS_URL ?? buildConfiguredAppUrl("/portal", { billing: "success" });
    const cancelUrl = process.env.STRIPE_CANCEL_URL ?? buildConfiguredAppUrl("/pricing", { billing: "cancelled" });
    const priceConfig = process.env.STRIPE_PRICE_PRO_MONTHLY_USD ?? null;
    const liveStripe = hasLiveStripeConfig() && priceConfig;
    const remoteSession = liveStripe
      ? await createStripeCheckoutSession({
          userId: user.id,
          workspaceId: input.workspaceId ?? null,
          priceConfig,
          successUrl,
          cancelUrl,
        })
      : null;
    const session = await createCheckoutSessionForUser(user.id, {
      workspaceId: input.workspaceId ?? null,
      priceId: priceConfig,
      successUrl,
      cancelUrl,
      ...(remoteSession ? { sessionId: remoteSession.id, checkoutUrl: remoteSession.checkoutUrl } : {}),
    });
    await recordAuditLog({
      userId: user.id,
      workspaceId: input.workspaceId ?? null,
      action: "billing.checkout",
      targetType: "checkoutSession",
      targetId: session.id,
      metadata: { provider: liveStripe ? "stripe-live" : "stripe", plan: input.plan },
      requestId: request.requestId,
    });
    return {
      provider: liveStripe ? "stripe-live" : "stripe",
      checkoutSessionId: session.id,
      checkoutUrl: session.checkoutUrl,
      cancelUrl,
      plan: input.plan,
    };
  });

  app.post("/api/billing/portal", async request => {
    const user = await currentUser(request);
    const input = billingPortalSessionInputSchema.parse(request.body ?? {});
    const context = await getBillingPortalContextForUser(user.id, input.workspaceId ?? null);
    const returnUrl = input.workspaceId
      ? buildConfiguredAppUrl(`/portal/workspaces/${input.workspaceId}/settings`)
      : buildConfiguredAppUrl("/portal/settings");
    const session = await createStripeBillingPortalSession({
      customerId: context.customerId,
      returnUrl,
    });
    await recordAuditLog({
      userId: user.id,
      workspaceId: input.workspaceId ?? null,
      action: "billing.portal",
      targetType: "billingPortal",
      targetId: context.customerId ?? "local-portal",
      requestId: request.requestId,
    });
    return session;
  });

  app.post("/api/webhooks/stripe", async request => {
    const parsed = parseStripeWebhookPayload({
      headers: {
        "stripe-signature": request.headers["stripe-signature"],
      },
      body: request.body,
      rawBody: request.rawBody,
    });
    recordWebhookEvent("stripe", parsed.kind === "ignored" ? parsed.eventType : parsed.payload.type);
    if (parsed.kind === "ignored") {
      return {
        received: true,
        provider: "stripe",
        ignored: true,
        eventType: parsed.eventType,
      };
    }
    return {
      provider: "stripe",
      ...await applyStripeWebhookToDatabase(parsed.payload),
    };
  });

  app.get("/api/integrations/github/install", async request => {
    const user = await currentUser(request);
    const query = githubInstallQuerySchema.parse(request.query);
    const detail = await getWorkspaceDetailForUser(query.workspaceId, user.id);
    if (detail.workspace.ownerUserId !== user.id) {
      throw statusError(403, `Owner access is required for workspace ${query.workspaceId}.`);
    }
    const targetAppUrl = assertAllowedGithubReturnOrigin(resolveRequestOrigin(request));
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const intent = await createGithubInstallIntent({
      workspaceId: query.workspaceId,
      requestedByUserId: user.id,
      targetAppUrl,
      nonce,
      expiresAt,
    });
    const state = createSignedGithubInstallState({
      intentId: intent.id,
      nonce,
    });
    return {
      installUrl: buildGithubInstallUrl(state),
      state,
      expiresAt: intent.expiresAt,
    };
  });

  app.post("/api/integrations/github/link", async request => {
    const body = githubLinkInstallationInputSchema.parse(request.body);
    const installation = await getGithubInstallation(body.installationId);
    const statePayload = parseSignedGithubInstallState(body.state);
    const result = await registerGithubInstallationForIntent(statePayload.intentId, statePayload.nonce, {
      installationId: String(installation.id),
      accountLogin: installation.accountLogin,
    });
    const record = result.installation;
    await recordAuditLog({
      userId: result.intent.requestedByUserId,
      workspaceId: result.intent.workspaceId,
      action: "integration.github.link",
      targetType: "githubInstallation",
      targetId: record.id,
      metadata: { installationId: record.githubInstallationId, accountLogin: record.githubAccountLogin },
      requestId: request.requestId,
    });
    return {
      installation: record,
      workspaceId: result.intent.workspaceId,
      targetAppUrl: result.intent.targetAppUrl,
    };
  });

  app.post("/api/integrations/github/gateway/register", async request => {
    requireGithubGatewayRegistrationToken(request.headers.authorization);
    const input = parseGithubGatewayRegisterInput(request.body);
    const target = await registerGithubWebhookTarget({
      ...input,
      expiresAt: new Date(Date.now() + getGithubWebhookTargetTtlSeconds() * 1000),
    });
    return { target };
  });

  app.get("/api/workspaces/:workspaceId/integrations/github/repositories", async request => {
    const user = await currentUser(request);
    const workspaceId = (request.params as { workspaceId: string }).workspaceId;
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const pageQuery = resolveListQuery(query);
    const installationId = typeof query.installationId === "string" ? query.installationId : null;
    const detail = await getWorkspaceDetailForUser(workspaceId, user.id);
    if (detail.installations.length === 0) {
      return {
        items: [],
        pageInfo: {
          page: pageQuery.page,
          pageSize: pageQuery.pageSize,
          total: 0,
          totalPages: 1,
        },
      };
    }
    const repositories = (await Promise.all(
      detail.installations
        .filter(installation => !installationId || installation.githubInstallationId === installationId)
        .map(async installation => {
          const items = await listGithubInstallationRepositories(installation.githubInstallationId);
          return items.map(repository => ({
            ...repository,
            githubInstallationId: installation.githubInstallationId,
            githubAccountLogin: installation.githubAccountLogin,
          }));
        }),
    ))
      .flat()
      .filter(repository => {
        if (!pageQuery.q) {
          return true;
        }
        const q = pageQuery.q.toLowerCase();
        return repository.fullName.toLowerCase().includes(q)
          || repository.githubAccountLogin.toLowerCase().includes(q)
          || repository.cloneUrl.toLowerCase().includes(q);
      })
      .sort((left, right) => (
        left.githubAccountLogin.localeCompare(right.githubAccountLogin)
        || left.fullName.localeCompare(right.fullName)
      ));
    const start = (pageQuery.page - 1) * pageQuery.pageSize;
    return {
      items: repositories.slice(start, start + pageQuery.pageSize),
      pageInfo: {
        page: pageQuery.page,
        pageSize: pageQuery.pageSize,
        total: repositories.length,
        totalPages: Math.max(1, Math.ceil(repositories.length / pageQuery.pageSize)),
      },
    };
  });

  app.delete("/api/workspaces/:workspaceId/integrations/github/installations/:installationId", async request => {
    const user = await currentUser(request);
    const { workspaceId, installationId } = request.params as { workspaceId: string; installationId: string };
    const removed = await removeGithubInstallationForUser(workspaceId, user.id, installationId);
    await recordAuditLog({
      userId: user.id,
      workspaceId,
      action: "integration.github.unlink",
      targetType: "githubInstallation",
      targetId: removed.removedInstallationId,
      requestId: request.requestId,
    });
    return removed;
  });

  app.post("/api/webhooks/github", async request => {
    await expireGithubWebhookTargets();
    const parsedWebhook = parseGithubWebhookPayload({
      headers: {
        "x-github-event": request.headers["x-github-event"],
        "x-hub-signature-256": request.headers["x-hub-signature-256"],
      },
      body: request.body,
      rawBody: request.rawBody,
    });
    if (parsedWebhook.kind === "ignored") {
      recordWebhookEvent("github", parsedWebhook.eventName);
      return {
        received: true,
        provider: "github",
        ignored: true,
        eventName: parsedWebhook.eventName,
        ...(parsedWebhook.action ? { action: parsedWebhook.action } : {}),
      };
    }
    const payload = parsedWebhook.payload;
    recordWebhookEvent("github", parsedWebhook.eventName);

    const gatewayHost = isGithubGatewayHost(request.hostname);

    if (payload.action === "deleted") {
      const result = await removeGithubInstallationByInstallationId(payload.installationId);
      if (gatewayHost && request.rawBody) {
        const targets = await listActiveGithubWebhookTargets();
        const localTargets = targets.filter(target => target.kind === "local");
        for (const target of localTargets) {
          void forwardGithubWebhookToTarget(target, request.rawBody, request.headers);
        }
      }
      return {
        received: true,
        provider: "github",
        installationCount: result.installationCount,
      };
    }

    if (!("workspaceId" in payload) || typeof payload.workspaceId !== "string" || payload.workspaceId.length === 0) {
      if (gatewayHost && request.rawBody) {
        const targets = await listActiveGithubWebhookTargets();
        const localTargets = targets.filter(target => target.kind === "local");
        for (const target of localTargets) {
          void forwardGithubWebhookToTarget(target, request.rawBody, request.headers);
        }
      }
      return {
        received: true,
        provider: "github",
        ignored: true,
        eventName: "installation",
        action: payload.action,
        reason: "installation-created-awaiting-callback-link",
      };
    }

    const result = await applyGithubWebhookToDatabase({
      workspaceId: payload.workspaceId,
      action: payload.action,
      installationId: payload.installationId,
      accountLogin: payload.accountLogin,
    });
    if (gatewayHost && request.rawBody) {
      const targets = await listActiveGithubWebhookTargets();
      const localTargets = targets.filter(target => target.kind === "local");
      for (const target of localTargets) {
        void forwardGithubWebhookToTarget(target, request.rawBody, request.headers);
      }
    }
    return result;
  });

  app.get("/auth/github/callback", async (request, reply) => {
    if (!isGithubGatewayHost(request.hostname)) {
      throw statusError(404, "GitHub gateway callback is only available on the configured gateway host.");
    }
    const query = request.query as Record<string, unknown>;
    const state = typeof query.state === "string" ? query.state : null;
    const installationId = typeof query.installation_id === "string" ? query.installation_id : null;
    if (!state || !installationId) {
      throw statusError(400, "GitHub callback requires both state and installation_id.");
    }
    const payload = parseSignedGithubInstallState(state);
    const intent = await getGithubInstallIntentById(payload.intentId);
    if (!intent || intent.nonce !== payload.nonce) {
      throw statusError(400, "GitHub install intent was not found.");
    }
    if (intent.consumedAt) {
      throw statusError(410, "GitHub install intent has already been consumed.");
    }
    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      throw statusError(410, "GitHub install intent has expired.");
    }

    const target = new URL("/auth/github/callback", intent.targetAppUrl);
    target.search = new URLSearchParams({
      state,
      installation_id: installationId,
      ...(typeof query.setup_action === "string" ? { setup_action: query.setup_action } : {}),
    }).toString();
    return reply.redirect(target.toString());
  });
}

async function streamLogs(
  request: { headers: Record<string, string | string[] | undefined>; raw: { on: (event: "close", fn: () => void) => void } },
  reply: FastifyReply,
  userId: string,
  jobId: string,
  visibility: "default" | "verbose",
) {
  const initialEnvelope = await getJobEnvelopeForUser(jobId, userId, { logVisibility: visibility });

  const lastEventHeader = request.headers["last-event-id"];
  let lastEventId = Array.isArray(lastEventHeader) ? lastEventHeader[0] : lastEventHeader;
  let lastStatus = initialEnvelope.job.status;
  let closed = false;
  let inFlight = false;

  request.raw.on("close", () => {
    closed = true;
  });

  const writeEvent = (log: { id: string }) => {
    reply.raw.write(`id: ${log.id}\n`);
    reply.raw.write("event: log\n");
    reply.raw.write(`data: ${JSON.stringify(log)}\n\n`);
  };

  const writeStatus = (status: string) => {
    reply.raw.write("event: status\n");
    reply.raw.write(`data: ${JSON.stringify({ status })}\n\n`);
  };

  const sendHeartbeat = () => {
    reply.raw.write("event: heartbeat\n");
    reply.raw.write(`data: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
  };

  const poll = async () => {
    if (inFlight || closed) {
      return;
    }
    inFlight = true;
    try {
      const logs = await listJobLogsAfterWithVisibility(jobId, lastEventId, visibility);
      for (const log of logs) {
        writeEvent(log);
        lastEventId = log.id;
      }
      const envelope = await getJobEnvelopeForUser(jobId, userId, { logVisibility: visibility });
      if (envelope.job.status !== lastStatus) {
        writeStatus(envelope.job.status);
        lastStatus = envelope.job.status;
      }
      if (isFinalStatus(envelope.job.status)) {
        reply.raw.write("event: complete\n");
        reply.raw.write(`data: ${JSON.stringify({ done: true, status: envelope.job.status })}\n\n`);
        reply.raw.end();
        closed = true;
      }
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(poll, 2000);
  const heartbeat = setInterval(sendHeartbeat, 15000);
  writeStatus(lastStatus);
  await poll();

  request.raw.on("close", () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
}
