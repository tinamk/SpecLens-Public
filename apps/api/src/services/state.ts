import { randomUUID } from "node:crypto";
import type {
  AddSourceInput,
  AnalysisJob,
  AnalysisLogEvent,
  BillingSubscription,
  CreateWorkspaceInput,
  CreateWorkspaceSecretInput,
  GithubInstallation,
  JobEnvelope,
  JobStatus,
  Source,
  User,
  Workspace,
  WorkspaceSecret,
  WorkspaceMembership,
} from "@speclens/contracts";
import { analysisLogEventSchema, analysisJobSchema } from "@speclens/contracts";
import { analyzeRepo, getRun, listRuns } from "@speclens/core";
import { loadApiConfig } from "./config";
import { mirrorArtifactsToObjectStorage } from "./object-storage";
import { loadPersistedAppState, persistAppState } from "./persistence";

function now(): string {
  return new Date().toISOString();
}

type AnalysisOptions = {
  preset?: "auto" | "generic" | "node-repo" | "svelte-web" | "tagtwo" | "client-legacy";
  capabilities?: Array<
    | "repo-inventory"
    | "spec-check"
    | "spec-generation"
    | "component-inventory"
    | "ui-text-inventory"
    | "ui-label-scan"
    | "consistency-check"
    | "license-policy"
    | "browser-self-check"
    | "visual-inspection"
    | "interaction-test"
    | "chaos-advisor"
    | "results-dashboard"
  >;
  runtimeMode?: "static" | "browser";
  secretRefs?: string[];
};

interface QueuedAnalysisTask {
  jobId: string;
  workspaceId: string;
  sourceId: string;
  options: AnalysisOptions;
}

interface CheckoutSessionRecord {
  id: string;
  workspaceId: string | null;
  userId: string;
  entitlement: "pro";
  checkoutUrl: string;
  status: "open" | "completed" | "cancelled";
  createdAt: string;
}

export interface AppState {
  users: Map<string, User>;
  workspaces: Map<string, Workspace>;
  memberships: Map<string, WorkspaceMembership[]>;
  secrets: Map<string, WorkspaceSecret[]>;
  secretValues: Map<string, Map<string, string>>;
  sources: Map<string, Source[]>;
  jobs: Map<string, JobEnvelope>;
  subscriptions: Map<string, BillingSubscription>;
  githubInstallations: Map<string, GithubInstallation[]>;
  analysisQueue: QueuedAnalysisTask[];
  activeAnalysisCount: number;
  queueScheduled: boolean;
  maxConcurrentAnalyses: number;
  checkoutSessions: Map<string, CheckoutSessionRecord>;
}

interface SessionCookiePayload {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
}

function createLog(jobId: string, scope: string, message: string, level: "info" | "warn" | "error" = "info"): AnalysisLogEvent {
  return analysisLogEventSchema.parse({
    id: `log_${randomUUID()}`,
    jobId,
    level,
    scope,
    message,
    createdAt: now(),
  });
}

function withJobUpdate(state: AppState, jobId: string, updater: (current: JobEnvelope) => JobEnvelope): JobEnvelope {
  const current = state.jobs.get(jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const next = updater(current);
  state.jobs.set(jobId, next);
  persistAppState(state);
  return next;
}

function appendJobLog(state: AppState, jobId: string, log: AnalysisLogEvent): JobEnvelope {
  return withJobUpdate(state, jobId, current => ({
    ...current,
    logs: [...current.logs, log],
  }));
}

function updateJobStatus(
  state: AppState,
  jobId: string,
  status: JobStatus,
  fields: { startedAt?: string | null; finishedAt?: string | null } = {},
): JobEnvelope {
  return withJobUpdate(state, jobId, current => ({
    ...current,
    job: analysisJobSchema.parse({
      ...current.job,
      status,
      ...(fields.startedAt !== undefined ? { startedAt: fields.startedAt } : {}),
      ...(fields.finishedAt !== undefined ? { finishedAt: fields.finishedAt } : {}),
    }),
  }));
}

function updateWorkspaceEntitlement(state: AppState, ownerUserId: string, entitlement: User["entitlement"]): void {
  const owner = [...state.users.values()].find(user => user.id === ownerUserId);
  if (owner) {
    state.users.set(owner.id, {
      ...owner,
      entitlement,
      updatedAt: now(),
    });
  }

  for (const workspace of state.workspaces.values()) {
    if (workspace.ownerUserId !== ownerUserId) continue;
    state.workspaces.set(workspace.id, {
      ...workspace,
      entitlement,
      updatedAt: now(),
    });
  }
  persistAppState(state);
}

function resolveSecrets(
  state: AppState,
  workspaceId: string,
  secretRefs: string[],
): Array<{ id: string; kind: "credential-pair" | "session-state" | "api-token"; value: string; name?: string }> {
  return secretRefs.reduce<Array<{ id: string; kind: "credential-pair" | "session-state" | "api-token"; value: string; name?: string }>>((result, secretId) => {
    const metadata = (state.secrets.get(workspaceId) ?? []).find(secret => secret.id === secretId);
    const rawValue = state.secretValues.get(workspaceId)?.get(secretId);
    if (!metadata || !rawValue) return result;
    result.push({
      id: metadata.id,
      kind: metadata.kind,
      value: rawValue,
      ...(metadata.name ? { name: metadata.name } : {}),
    });
    return result;
  }, []);
}

async function performAnalysisForSource(
  state: AppState,
  workspace: Workspace,
  source: Source,
  options: AnalysisOptions = {},
  jobId?: string,
): Promise<JobEnvelope> {
  const resolvedSecrets = resolveSecrets(state, workspace.id, options.secretRefs ?? []);
  const run = await analyzeRepo({
    workspace: {
      rootDir: process.cwd(),
      name: workspace.slug,
    },
    source: {
      type: source.type === "github-public" || source.type === "github-private" ? "git" : "path",
      location: source.location,
    },
    ...(options.preset ? { preset: options.preset } : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.runtimeMode ? { runtimeMode: options.runtimeMode } : {}),
    ...(options.secretRefs ? { secretRefs: options.secretRefs } : {}),
    ...(resolvedSecrets.length > 0 ? { secrets: resolvedSecrets } : {}),
    ...(jobId ? { jobId } : {}),
    mode: "hosted",
  });

  const normalizedJob: AnalysisJob = {
    ...run.job,
    id: jobId ?? run.job.id,
    workspaceId: workspace.id,
    sourceId: source.id,
    sourceType: source.type,
    sourceLocation: source.location,
    preset: run.job.preset,
    capabilities: run.job.capabilities,
    runtimeMode: run.job.runtimeMode,
    secretRefs: run.job.secretRefs,
  };
  return {
    ...run,
    job: normalizedJob,
    report: run.report ? {
      ...run.report,
      workspaceId: workspace.id,
    } : null,
  };
}

async function runQueuedAnalysisTask(state: AppState, task: QueuedAnalysisTask): Promise<void> {
  const workspace = state.workspaces.get(task.workspaceId);
  const source = (workspace ? state.sources.get(task.workspaceId) : undefined)?.find(item => item.id === task.sourceId);

  if (!workspace || !source) {
    appendJobLog(state, task.jobId, createLog(task.jobId, "queue", "Job could not start because the workspace or source is missing.", "error"));
    updateJobStatus(state, task.jobId, "failed", { finishedAt: now() });
    return;
  }

  updateJobStatus(state, task.jobId, "running", { startedAt: now() });
  appendJobLog(state, task.jobId, createLog(task.jobId, "queue", "Runner claimed queued job and started analysis."));

  try {
    const result = await performAnalysisForSource(state, workspace, source, task.options, task.jobId);
    const uploadedResult = await mirrorArtifactsToObjectStorage(loadApiConfig(), result);
    const prior = state.jobs.get(task.jobId);
    state.jobs.set(task.jobId, {
      ...uploadedResult,
      logs: [...(prior?.logs ?? []), ...uploadedResult.logs.filter(log => !(prior?.logs ?? []).some(existing => existing.id === log.id))],
    });
    persistAppState(state);
  } catch (error) {
    appendJobLog(
      state,
      task.jobId,
      createLog(task.jobId, "analysis", error instanceof Error ? error.message : "Unknown analysis failure.", "error"),
    );
    updateJobStatus(state, task.jobId, "failed", { finishedAt: now() });
  }
}

function scheduleQueueDrain(state: AppState): void {
  if (state.queueScheduled) return;
  state.queueScheduled = true;
  queueMicrotask(() => {
    state.queueScheduled = false;
    void drainAnalysisQueue(state);
  });
}

async function drainAnalysisQueue(state: AppState): Promise<void> {
  while (state.activeAnalysisCount < state.maxConcurrentAnalyses && state.analysisQueue.length > 0) {
    const task = state.analysisQueue.shift();
    if (!task) continue;
    state.activeAnalysisCount += 1;
    void runQueuedAnalysisTask(state, task).finally(() => {
      state.activeAnalysisCount = Math.max(0, state.activeAnalysisCount - 1);
      scheduleQueueDrain(state);
    });
  }
}

export async function createAppState(): Promise<AppState> {
  const persisted = await loadPersistedAppState();
  const user: User = {
    id: "user_demo",
    identityProvider: "keycloak",
    identitySubject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Demo User",
    avatarUrl: null,
    entitlement: "free",
    createdAt: now(),
    updatedAt: now(),
  };

  return {
    users: persisted?.users ?? new Map([[user.id, user]]),
    workspaces: persisted?.workspaces ?? new Map(),
    memberships: persisted?.memberships ?? new Map(),
    secrets: persisted?.secrets ?? new Map(),
    secretValues: persisted?.secretValues ?? new Map(),
    sources: persisted?.sources ?? new Map(),
    jobs: persisted?.jobs ?? new Map(),
    subscriptions: persisted?.subscriptions ?? new Map(),
    githubInstallations: persisted?.githubInstallations ?? new Map(),
    analysisQueue: [],
    activeAnalysisCount: 0,
    queueScheduled: false,
    maxConcurrentAnalyses: Number(process.env.API_MAX_CONCURRENT_ANALYSES ?? 2),
    checkoutSessions: persisted?.checkoutSessions ?? new Map(),
  };
}

export function getCurrentUser(state: AppState): User {
  return [...state.users.values()][0]!;
}

export function upsertUserIdentity(
  state: AppState,
  identity: {
    provider: string;
    subject: string;
    email: string;
    displayName: string;
  },
): User {
  const existing = [...state.users.values()].find(user =>
    user.identityProvider === identity.provider && user.identitySubject === identity.subject,
  );
  const nextUser: User = existing
    ? {
        ...existing,
        email: identity.email,
        displayName: identity.displayName,
        updatedAt: now(),
      }
    : {
        id: `user_${randomUUID()}`,
        identityProvider: identity.provider,
        identitySubject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: null,
        entitlement: "free",
        createdAt: now(),
        updatedAt: now(),
      };

  state.users.set(nextUser.id, nextUser);
  persistAppState(state);
  return nextUser;
}

function decodeSessionCookieValue(raw: string): SessionCookiePayload | null {
  try {
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<SessionCookiePayload>;
    if (!payload.provider || !payload.subject || !payload.email || !payload.displayName) {
      return null;
    }
    return {
      provider: payload.provider,
      subject: payload.subject,
      email: payload.email,
      displayName: payload.displayName,
    };
  } catch {
    return null;
  }
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const token = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return token ? token.slice(name.length + 1) : null;
}

export function resolveCurrentUserFromCookie(state: AppState, cookieHeader?: string | null): User {
  const encodedSession = readCookie(cookieHeader, "speclens_portal_session");
  if (!encodedSession) {
    return getCurrentUser(state);
  }

  const session = decodeSessionCookieValue(encodedSession);
  if (!session) {
    return getCurrentUser(state);
  }
  return upsertUserIdentity(state, {
    provider: session.provider,
    subject: session.subject,
    email: session.email,
    displayName: session.displayName,
  });
}

export function listWorkspaceSummaries(state: AppState): Array<{
  workspace: Workspace;
  members: WorkspaceMembership[];
  sources: Source[];
}> {
  return [...state.workspaces.values()].map(workspace => ({
    workspace,
    members: state.memberships.get(workspace.id) ?? [],
    sources: state.sources.get(workspace.id) ?? [],
  }));
}

export function getWorkspaceDetail(state: AppState, workspaceId: string): {
  workspace: Workspace;
  members: WorkspaceMembership[];
  sources: Source[];
  installations: GithubInstallation[];
  jobs: JobEnvelope[];
} {
  const workspace = state.workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  return {
    workspace,
    members: state.memberships.get(workspaceId) ?? [],
    sources: state.sources.get(workspaceId) ?? [],
    installations: state.githubInstallations.get(workspaceId) ?? [],
    jobs: [...state.jobs.values()].filter(item => item.job.workspaceId === workspaceId),
  };
}

export function createWorkspaceRecord(state: AppState, owner: User, input: CreateWorkspaceInput): Workspace {
  const workspace: Workspace = {
    id: `workspace_${randomUUID()}`,
    ownerUserId: owner.id,
    name: input.name,
    slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: input.description ?? null,
    entitlement: owner.entitlement,
    createdAt: now(),
    updatedAt: now(),
  };
  const membership: WorkspaceMembership = {
    id: `membership_${randomUUID()}`,
    workspaceId: workspace.id,
    userId: owner.id,
    role: "owner",
    createdAt: now(),
  };

  state.workspaces.set(workspace.id, workspace);
  state.memberships.set(workspace.id, [membership]);
  state.secrets.set(workspace.id, []);
  state.secretValues.set(workspace.id, new Map());
  state.sources.set(workspace.id, []);
  state.githubInstallations.set(workspace.id, []);
  persistAppState(state);
  return workspace;
}

export function listWorkspaceSecrets(state: AppState, workspaceId: string): WorkspaceSecret[] {
  return state.secrets.get(workspaceId) ?? [];
}

export function addWorkspaceSecretRecord(
  state: AppState,
  workspaceId: string,
  input: CreateWorkspaceSecretInput,
): WorkspaceSecret {
  const secret: WorkspaceSecret = {
    id: `secret_${randomUUID()}`,
    workspaceId,
    name: input.name,
    kind: input.kind,
    valuePreview: input.kind === "credential-pair"
      ? "stored credential pair"
      : input.kind === "session-state"
        ? "stored session state"
        : "stored API token",
    createdAt: now(),
    updatedAt: now(),
  };
  const current = state.secrets.get(workspaceId) ?? [];
  state.secrets.set(workspaceId, [...current, secret]);
  const values = state.secretValues.get(workspaceId) ?? new Map<string, string>();
  values.set(secret.id, input.value);
  state.secretValues.set(workspaceId, values);
  persistAppState(state);
  return secret;
}

export function addSourceRecord(state: AppState, workspaceId: string, input: AddSourceInput): Source {
  const workspace = state.workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  if ((input.type === "github-private" || input.type === "upload-archive") && workspace.entitlement === "free") {
    throw new Error("Pro entitlement is required for private repositories and archive uploads.");
  }
  const source: Source = {
    id: `source_${randomUUID()}`,
    workspaceId,
    type: input.type,
    displayName: input.displayName,
    location: input.location,
    visibility: input.visibility,
    githubInstallationId: null,
    uploadObjectKey: input.type === "upload-archive" ? `uploads/${workspaceId}/${randomUUID()}` : null,
    createdAt: now(),
  };
  const current = state.sources.get(workspaceId) ?? [];
  state.sources.set(workspaceId, [...current, source]);
  persistAppState(state);
  return source;
}

export function enqueueAnalysisForSource(
  state: AppState,
  workspace: Workspace,
  source: Source,
  options: AnalysisOptions = {},
): JobEnvelope {
  const jobId = `job_${randomUUID()}`;
  const job: AnalysisJob = analysisJobSchema.parse({
    id: jobId,
    workspaceId: workspace.id,
    sourceId: source.id,
    reportId: null,
    status: "queued",
    sourceType: source.type,
    sourceLocation: source.location,
    preset: options.preset ?? "auto",
    capabilities: options.capabilities ?? [],
    runtimeMode: options.runtimeMode ?? "static",
    secretRefs: options.secretRefs ?? [],
    requestedByUserId: workspace.ownerUserId,
    startedAt: null,
    finishedAt: null,
    createdAt: now(),
  });
  const envelope: JobEnvelope = {
    job,
    logs: [
      createLog(jobId, "queue", "Job accepted and queued for hosted analysis."),
    ],
    report: null,
  };
  state.jobs.set(jobId, envelope);
  state.analysisQueue.push({
    jobId,
    workspaceId: workspace.id,
    sourceId: source.id,
    options,
  });
  persistAppState(state);
  scheduleQueueDrain(state);
  return envelope;
}

export function createCheckoutSession(
  state: AppState,
  user: User,
  input: { workspaceId?: string | null; priceId: string | null; successUrl: string; cancelUrl: string },
): CheckoutSessionRecord {
  const sessionId = `checkout_${randomUUID()}`;
  const checkoutUrl = `${input.successUrl}?session_id=${sessionId}&plan=pro`;
  const session: CheckoutSessionRecord = {
    id: sessionId,
    workspaceId: input.workspaceId ?? null,
    userId: user.id,
    entitlement: "pro",
    checkoutUrl,
    status: "open",
    createdAt: now(),
  };
  state.checkoutSessions.set(session.id, session);
  persistAppState(state);
  return session;
}

export function applyStripeWebhook(
  state: AppState,
  input: {
    type: "checkout.session.completed" | "customer.subscription.deleted";
    sessionId?: string;
    userId?: string;
    subscriptionId?: string;
  },
): { received: true; entitlement: User["entitlement"] } {
  const targetUserId = input.userId
    ?? (input.sessionId ? state.checkoutSessions.get(input.sessionId)?.userId : null)
    ?? getCurrentUser(state).id;
  const user = state.users.get(targetUserId);
  if (!user) {
    throw new Error(`Unknown user for Stripe webhook: ${targetUserId}`);
  }

  if (input.type === "checkout.session.completed") {
    const subscription: BillingSubscription = {
      id: `sub_${randomUUID()}`,
      userId: user.id,
      provider: "stripe",
      providerCustomerId: `cus_${randomUUID()}`,
      providerSubscriptionId: input.subscriptionId ?? `stripe_sub_${randomUUID()}`,
      entitlement: "pro",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    };
    state.subscriptions.set(subscription.id, subscription);
    if (input.sessionId) {
      const checkoutSession = state.checkoutSessions.get(input.sessionId);
      if (checkoutSession) {
        state.checkoutSessions.set(input.sessionId, {
          ...checkoutSession,
          status: "completed",
        });
      }
    }
    updateWorkspaceEntitlement(state, user.id, "pro");
    return { received: true, entitlement: "pro" };
  }

  for (const [subscriptionId, subscription] of state.subscriptions.entries()) {
    if (subscription.userId !== user.id) continue;
    state.subscriptions.set(subscriptionId, {
      ...subscription,
      status: "cancelled",
      entitlement: "free",
      updatedAt: now(),
    });
  }
  updateWorkspaceEntitlement(state, user.id, "free");
  return { received: true, entitlement: "free" };
}

export function createGithubInstallUrl(workspaceId: string, baseInstallUrl = "https://github.com/apps/speclens/installations/new"): string {
  const params = new URLSearchParams({ state: workspaceId });
  return `${baseInstallUrl}?${params.toString()}`;
}

export function applyGithubWebhook(
  state: AppState,
  input: { workspaceId: string; action: "created" | "deleted"; installationId: string; accountLogin: string },
): { received: true; provider: "github"; installationCount: number } {
  const current = state.githubInstallations.get(input.workspaceId) ?? [];
  if (input.action === "deleted") {
    const next = current.filter(item => item.githubInstallationId !== input.installationId);
    state.githubInstallations.set(input.workspaceId, next);
    persistAppState(state);
    return { received: true, provider: "github", installationCount: next.length };
  }

  const installation: GithubInstallation = {
    id: `ghinst_${randomUUID()}`,
    workspaceId: input.workspaceId,
    githubInstallationId: input.installationId,
    githubAccountLogin: input.accountLogin,
    createdAt: now(),
  };
  state.githubInstallations.set(input.workspaceId, [
    ...current.filter(item => item.githubInstallationId !== input.installationId),
    installation,
  ]);
  persistAppState(state);
  return { received: true, provider: "github", installationCount: (state.githubInstallations.get(input.workspaceId) ?? []).length };
}

export function getJob(state: AppState, jobId: string): JobEnvelope {
  const job = state.jobs.get(jobId);
  if (!job) {
    const localRun = getRun(jobId, { rootDir: process.cwd(), name: "default" });
    state.jobs.set(jobId, localRun);
    return localRun;
  }
  return job;
}

export function listJobs(state: AppState): JobEnvelope[] {
  return [...state.jobs.values()].length > 0
    ? [...state.jobs.values()]
    : listRuns({ rootDir: process.cwd(), name: "default" });
}

export function cancelJob(state: AppState, jobId: string): JobEnvelope {
  const queuedIndex = state.analysisQueue.findIndex(task => task.jobId === jobId);
  if (queuedIndex >= 0) {
    state.analysisQueue.splice(queuedIndex, 1);
    appendJobLog(state, jobId, createLog(jobId, "queue", "Queued job was cancelled before runner claim.", "warn"));
    const cancelled = updateJobStatus(state, jobId, "cancelled", { finishedAt: now() });
    persistAppState(state);
    return cancelled;
  }

  const current = getJob(state, jobId);
  if (current.job.status === "running") {
    throw new Error("Running job cancellation is not supported in the current local runner implementation.");
  }
  if (current.job.status === "cancelled") {
    return current;
  }
  throw new Error(`Job ${jobId} is not queued and cannot be cancelled.`);
}

export function retryJob(state: AppState, jobId: string): JobEnvelope {
  const current = getJob(state, jobId);
  if (current.job.status !== "failed" && current.job.status !== "cancelled") {
    throw new Error("Only failed or cancelled jobs can be retried.");
  }
  const workspace = state.workspaces.get(current.job.workspaceId);
  const source = (workspace ? state.sources.get(current.job.workspaceId) : undefined)?.find(item => item.id === current.job.sourceId);
  if (!workspace || !source) {
    throw new Error("Cannot retry job because the original workspace or source is missing.");
  }

  return enqueueAnalysisForSource(state, workspace, source, {
    preset: current.job.preset,
    capabilities: current.job.capabilities,
    runtimeMode: current.job.runtimeMode,
    secretRefs: current.job.secretRefs,
  });
}
