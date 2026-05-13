import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createGithubInstallationAccessToken,
  parseGithubRepoLocation,
  resolveSpecLensAppStatePath,
} from "@speclens/core";
import {
  analysisJobSchema,
  collectAnalysisExecutionSteps,
  analysisLogEventSchema,
  analysisReportSchema,
  analysisReportSummarySchema,
  aiAgentSchema,
  aiRoleSchema,
  aiSkillSchema,
  analysisTaskSchema,
  artifactReferenceSchema,
  codexAuthOptionSchema,
  codexAuthSelectionSchema,
  codexAuthStatusSchema,
  githubGatewayRegisterInputSchema,
  githubInstallIntentSchema,
  githubInstallationSchema,
  githubWebhookTargetSchema,
  jobEnvelopeSchema,
  learnableSchema,
  resolveJobExecutionPath,
  sourceSchema,
  userSchema,
  workspaceMemberSummarySchema,
  workspaceSchema,
  workspaceSecretSchema,
  type AddSourceInput,
  type AnalysisJob,
  type AnalysisLogEvent,
  type AnalysisReport,
  type AiAgent,
  type AiRole,
  type AiRoleExecutorKind,
  type AiSkill,
  type AiToolCapability,
  type AnalysisTask,
  type ArtifactReference,
  type BillingSubscription,
  type CommercialContactInput,
  type CodexAuthOption,
  type CodexAuthStatus,
  type CodexAuthSelection,
  type GithubGatewayRegisterInput,
  type GithubInstallIntent,
  type CreateAnalysisJobInput,
  type CreateAgentJobInput,
  type CreateRemediationTaskInput,
  type CreateAiAgentInput,
  type CreateAiRoleInput,
  type CreateAiSkillInput,
  type CreateWorkspaceMemberInput,
  type CreateWorkspaceInput,
  type CreateWorkspaceSecretInput,
  type UpdateWorkspaceSecretInput,
  type ChangesetSummary,
  type GithubInstallation,
  type GithubWebhookTarget,
  type JobEnvelope,
  type JobExecutionPath,
  type Learnable,
  type RoleDefinition,
  type RunnerJobPayload,
  type Source,
  type StripeWebhookInput,
  type User,
  type Workspace,
  type WorkspaceMemberSummary,
  type WorkspaceMembership,
  type WorkspaceSecret,
  type UpdateSourceInput,
} from "@speclens/contracts";
import { parseCodexAuthFile } from "./codex-auth";
import { deleteObject, type ObjectStorageConfig } from "./object-storage";

let prismaClient: PrismaClient | null = null;

const logOrderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const artifactOrderBy = { createdAt: "asc" as const };
const jobSummaryInclude = {
  report: {
    select: {
      id: true,
      workspaceId: true,
      jobId: true,
      status: true,
      rolesJson: true,
      runtimeMode: true,
      title: true,
      summaryJson: true,
      createdAt: true,
    },
  },
  source: {
    select: {
      id: true,
      displayName: true,
      location: true,
    },
  },
  companionSource: {
    select: {
      id: true,
      displayName: true,
      location: true,
    },
  },
} as const satisfies Prisma.AnalysisJobInclude;
const DEFAULT_DISPATCH_LEASE_MS = 30_000;
const DEFAULT_MAX_DISPATCH_ATTEMPTS = 12;

function getDispatchLeaseMs(): number {
  const value = Number.parseInt(process.env.ANALYSIS_JOB_DISPATCH_LEASE_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DISPATCH_LEASE_MS;
}

function getMaxDispatchAttempts(): number {
  const value = Number.parseInt(process.env.ANALYSIS_JOB_MAX_DISPATCH_ATTEMPTS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_DISPATCH_ATTEMPTS;
}

function getDispatchBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(60_000, 1_000 * (2 ** Math.min(safeAttempt - 1, 5)));
}

const hostedPublicGitHosts = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
]);

function isHostedPublicGitLocation(location: string, options: { allowFileTransport?: boolean } = {}): boolean {
  const trimmed = location.trim();
  if (options.allowFileTransport && /^file:\/\//i.test(trimmed)) {
    return true;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && hostedPublicGitHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isHostedGithubLocation(location: string, options: { allowFileTransport?: boolean } = {}): boolean {
  const trimmed = location.trim();
  if (options.allowFileTransport && /^file:\/\//i.test(trimmed)) {
    return true;
  }
  return /^https:\/\/github\.com\//i.test(trimmed)
    || /^git@github\.com:/i.test(trimmed)
    || /^ssh:\/\/git@github\.com\//i.test(trimmed);
}

async function verifyHostedGithubPrivateLocation(location: string, installationId: string): Promise<void> {
  const { owner, repo } = parseGithubRepoLocation(location);
  const token = await createGithubInstallationAccessToken(installationId).catch(error => {
    throw statusError(500, error instanceof Error ? error.message : "GitHub App authentication failed.");
  });
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `token ${token}`,
      "user-agent": "SpecLens/0.4.0",
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw statusError(response.status, await response.text() || `GitHub repository verification failed for ${owner}/${repo}.`);
  }
}

async function runGitCommand(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: os.tmpdir(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", status => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function verifyHostedPublicGitLocation(location: string): Promise<void> {
  const result = await runGitCommand(["ls-remote", "--exit-code", location, "HEAD"]);
  if (result.status !== 0) {
    throw statusError(
      400,
      result.stderr.trim() || result.stdout.trim() || `Unable to verify public Git repository at ${location}.`,
    );
  }
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

function normalizePageNumber(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.trunc(value as number) : 1;
}

function normalizePageSize(value: number | undefined): number {
  const next = Number.isFinite(value) && (value ?? 0) > 0 ? Math.trunc(value as number) : 25;
  return Math.max(1, Math.min(100, next));
}

function buildPageInfo(total: number, page: number, pageSize: number): PaginatedResult<never>["pageInfo"] {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function buildWorkspaceSecretPreview(kind: WorkspaceSecret["kind"]): string {
  return kind === "credential-pair"
    ? "stored credential pair"
    : kind === "session-state"
      ? "stored session state"
      : "stored API token";
}

async function assertHostedGitLocation(
  type: AddSourceInput["type"],
  location: string,
  options: { allowFileTransport?: boolean } = {},
): Promise<void> {
  const allowed = type === "github-private"
    ? isHostedGithubLocation(location, options)
    : isHostedPublicGitLocation(location, options);
  if (allowed) {
    return;
  }
  if (type === "github-private") {
    throw statusError(400, "Private GitHub sources must use a supported github.com Git repository URL.");
  }
  throw statusError(400, "Public Git sources must use an https Git repository URL from github.com, gitlab.com, bitbucket.org, or codeberg.org.");
}

function resolveDefaultAgentIdForRequest(roles: string[], runtimeMode: AnalysisJob["runtimeMode"]): string {
  const browserIntent = runtimeMode === "browser"
    || roles.some(role =>
      role === "browser-self-check"
      || role === "visual-inspection"
      || role === "interaction-test");
  if (browserIntent) {
    return "agent-universal-exhaustive";
  }

  const smokeCompatibleRoles = new Set([
    "repo-inventory",
    "spec-check",
    "spec-generation",
    "consistency-check",
    "license-policy",
    "chaos-advisor",
    "results-dashboard",
  ]);
  const smokeIntent = roles.length > 0 && roles.every(role => smokeCompatibleRoles.has(role));
  if (smokeIntent) {
    return "agent-universal-smoke";
  }

  return "agent-universal-standard";
}

function normalizePersistedHostedSourceType(value: string | null | undefined): Source["type"] | null {
  if (!value) {
    return null;
  }
  if (value === "git-public" || value === "github-private" || value === "upload-archive") {
    return value;
  }
  if (value === "github-public") {
    return "git-public";
  }
  return null;
}

function requirePersistedHostedSourceType(value: string | null | undefined, context: string): Source["type"] {
  const normalized = normalizePersistedHostedSourceType(value);
  if (!normalized) {
    throw new Error(`Unsupported persisted hosted source type for ${context}: ${value ?? "null"}`);
  }
  return normalized;
}

const activeHostedPersistedSourceTypes = [
  "git-public",
  "github-public",
  "github-private",
  "upload-archive",
];

function activeHostedJobWhere(...clauses: Prisma.AnalysisJobWhereInput[]): Prisma.AnalysisJobWhereInput {
  return {
    AND: [
      { sourceType: { in: activeHostedPersistedSourceTypes } },
      {
        OR: [
          { companionSourceType: null },
          { companionSourceType: { in: activeHostedPersistedSourceTypes } },
        ],
      },
      ...clauses,
    ],
  };
}

function accessibleJobsWhere(userId: string, ...clauses: Prisma.AnalysisJobWhereInput[]): Prisma.AnalysisJobWhereInput {
  return activeHostedJobWhere(
    {
      OR: [
        { workspace: { ownerUserId: userId } },
        { workspace: { memberships: { some: { userId } } } },
      ],
    },
    ...clauses,
  );
}

function normalizeAiToolCapabilities(value: unknown): AiToolCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.flatMap(item => {
    if (
      item === "repo-read"
      || item === "shell-exec"
      || item === "http-fetch"
      || item === "browser-automation"
      || item === "artifact-write"
      || item === "package-install"
      || item === "dev-server"
      || item === "test-exec"
      || item === "auth-state"
    ) {
      return [item];
    }
    return [];
  }))] as AiToolCapability[];
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type CheckoutSessionRecord = {
  id: string;
  workspaceId: string | null;
  userId: string;
  entitlement: "pro";
  checkoutUrl: string;
  status: "open" | "completed" | "cancelled";
  createdAt: string;
};

type WorkspaceMembershipWithUser = {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

type PaginatedResult<T> = {
  items: T[];
  pageInfo: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type JobWithRelations = Prisma.AnalysisJobGetPayload<{
  include: {
    logs: { orderBy: typeof logOrderBy };
    report: {
      include: {
        artifacts: { orderBy: typeof artifactOrderBy };
      };
    };
    artifacts: { orderBy: typeof artifactOrderBy };
    source: true;
    companionSource: true;
  };
}>;

type JobSummaryWithRelations = Prisma.AnalysisJobGetPayload<{
  include: typeof jobSummaryInclude;
}>;

type ReportWithArtifacts = Prisma.AnalysisReportGetPayload<{
  include: {
    artifacts: { orderBy: typeof artifactOrderBy };
    job: {
      include: {
        source: true;
        companionSource: true;
      };
    };
  };
}>;

type WorkspaceConsoleReportSummary = Pick<AnalysisReport, "id" | "workspaceId" | "jobId" | "status" | "title" | "createdAt">;
type WorkspaceConsoleStats = {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  reportBackedJobs: number;
  sourcesWithReports: number;
};
type WorkspaceConsoleJob = {
  job: AnalysisJob;
  report: WorkspaceConsoleReportSummary | null;
};

const workspaceConsoleReportSummarySchema = analysisReportSchema.pick({
  id: true,
  workspaceId: true,
  jobId: true,
  status: true,
  title: true,
  createdAt: true,
});

type HydratedAiRoleRecord = Prisma.AiRoleGetPayload<{
  include: {
    skills: { include: { skill: true }; orderBy: { order: "asc" } };
    dependencies: { include: { dependsOnRole: true }; orderBy: { order: "asc" } };
  };
}> & {
  executorKind: string | null;
  nativeExecutorId: string | null;
};

type LegacyPersistedState = {
  users: Array<[string, User]>;
  workspaces: Array<[string, Workspace]>;
  memberships: Array<[string, WorkspaceMembership[]]>;
  secrets: Array<[string, WorkspaceSecret[]]>;
  secretValues: Array<[string, Array<[string, string]>]>;
  sources: Array<[string, Source[]]>;
  jobs: Array<[string, JobEnvelope]>;
  subscriptions: Array<[string, BillingSubscription]>;
  githubInstallations: Array<[string, GithubInstallation[]]>;
  checkoutSessions: Array<[string, CheckoutSessionRecord]>;
};

const legacyPersistedStateKeys = [
  "users",
  "workspaces",
  "memberships",
  "secrets",
  "secretValues",
  "sources",
  "jobs",
  "subscriptions",
  "githubInstallations",
  "checkoutSessions",
] as const;

function isLegacyPersistedState(value: unknown): value is LegacyPersistedState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return legacyPersistedStateKeys.every(key => Array.isArray(record[key]));
}

function readLegacyPersistedState(snapshotPath: string): LegacyPersistedState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      scope: "db.legacy-snapshot",
      event: "legacy-snapshot-parse-failed",
      path: snapshotPath,
      error: error instanceof Error ? error.message : "Invalid legacy snapshot JSON.",
    }));
    return null;
  }

  if (!isLegacyPersistedState(raw)) {
    console.warn(JSON.stringify({
      level: "warn",
      scope: "db.legacy-snapshot",
      event: "legacy-snapshot-shape-invalid",
      path: snapshotPath,
      error: "Legacy snapshot does not contain the expected top-level arrays.",
    }));
    return null;
  }
  return raw;
}

export type ResolvedWorkspaceSecret = {
  id: string;
  kind: WorkspaceSecret["kind"];
  value: string;
  name?: string;
};

export interface JobExecutionRecord {
  job: AnalysisJob;
  workspace: Workspace;
  source: Source;
  companionSource: Source | null;
  parentReport: AnalysisReport | null;
  metadata: PersistedJobMetadata;
  secrets: ResolvedWorkspaceSecret[];
}

type PersistedRemediationMetadata = CreateRemediationTaskInput & {
  reportId: string;
  changeset: ChangesetSummary | null;
};

type PersistedCodexAuthBinding = {
  scope: "user" | "workspace" | "global";
  recordId: string;
};

type PersistedJobMetadata = {
  remediation?: PersistedRemediationMetadata | null;
  codexAuth?: PersistedCodexAuthBinding | null;
};

export interface StatusError extends Error {
  statusCode: number;
}

export function statusError(statusCode: number, message: string): StatusError {
  const error = new Error(message) as StatusError;
  error.statusCode = statusCode;
  return error;
}

function exposeInternalE2eTasks(): boolean {
  return process.env.SPECLENS_EXPOSE_E2E_TASKS === "true";
}

function isInternalE2eAgentId(agentId: string): boolean {
  return agentId.startsWith("agent-e2e-");
}

function assertAllowedHostedAgentId(agentId: string): void {
  if (isInternalE2eAgentId(agentId) && !exposeInternalE2eTasks()) {
    throw statusError(403, `Agent ${agentId} is reserved for internal E2E use.`);
  }
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asTimestamp(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function asJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value as T[] : fallback;
}

function parseJobMetadata(value: unknown): PersistedJobMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const codexAuthValue = record.codexAuth;
  const codexAuth = codexAuthValue && typeof codexAuthValue === "object" && !Array.isArray(codexAuthValue)
    ? (() => {
        const codexAuthRecord = codexAuthValue as Record<string, unknown>;
        const scope = codexAuthRecord.scope;
        const recordId = codexAuthRecord.recordId;
        if (
          (scope === "user" || scope === "workspace" || scope === "global")
          && typeof recordId === "string"
          && recordId.trim().length > 0
        ) {
          return {
            scope,
            recordId,
          } satisfies PersistedCodexAuthBinding;
        }
        return null;
      })()
    : null;
  const remediationValue = record.remediation;
  if (!remediationValue || typeof remediationValue !== "object" || Array.isArray(remediationValue)) {
    return codexAuth ? { codexAuth } : {};
  }
  const remediationRecord = remediationValue as Record<string, unknown>;
  const reportId = typeof remediationRecord.reportId === "string" ? remediationRecord.reportId : null;
  const sourceId = typeof remediationRecord.sourceId === "string" ? remediationRecord.sourceId : null;
  if (!reportId || !sourceId) {
    return codexAuth ? { codexAuth } : {};
  }
  return {
    ...(codexAuth ? { codexAuth } : {}),
    remediation: {
      reportId,
      sourceId,
      baseRef: typeof remediationRecord.baseRef === "string" ? remediationRecord.baseRef : "HEAD",
      selectionMode: remediationRecord.selectionMode === "selected-findings" ? "selected-findings" : "auto-priority",
      selectedFindingIds: asJsonArray<string>(remediationRecord.selectedFindingIds).filter(item => typeof item === "string"),
      maxIterations: typeof remediationRecord.maxIterations === "number" && remediationRecord.maxIterations >= 1
        ? Math.min(2, Math.trunc(remediationRecord.maxIterations))
        : 2,
      outputMode: remediationRecord.outputMode === "remote-pr" ? "remote-pr" : "changeset",
      publishRemote: remediationRecord.publishRemote === true,
      changeset: remediationRecord.changeset && typeof remediationRecord.changeset === "object" && !Array.isArray(remediationRecord.changeset)
        ? remediationRecord.changeset as ChangesetSummary
        : null,
    },
  };
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function createLog(
  jobId: string,
  scope: string,
  message: string,
  level: AnalysisLogEvent["level"] = "info",
  requestId?: string,
  visibility: AnalysisLogEvent["visibility"] = "default",
): AnalysisLogEvent {
  return analysisLogEventSchema.parse({
    id: createId("log"),
    jobId,
    level,
    scope,
    message,
    visibility,
    ...(requestId ? { requestId } : {}),
    createdAt: nowIso(),
  });
}

function getStatePath(): string {
  return resolveSpecLensAppStatePath(process.env);
}

function getEncryptionKey(): Buffer {
  const source = process.env.APP_STATE_ENCRYPTION_KEY;
  if (!source || source.trim().length === 0) {
    throw new Error("APP_STATE_ENCRYPTION_KEY is required for workspace secret encryption.");
  }
  return crypto.createHash("sha256").update(source).digest();
}

export function encryptSecretValue(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecretValue(value: string): string {
  const raw = Buffer.from(value, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workspace";
}

function parseGithubOwnerFromLocation(location: string): string | null {
  const trimmed = location.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") {
      return null;
    }
    const [owner] = url.pathname.replace(/^\/+/, "").split("/");
    return owner || null;
  } catch {
    return null;
  }
}

function selectInstallationForGithubRepo(
  installations: Array<{ githubInstallationId: string; githubAccountLogin: string }>,
  location: string,
  preferredInstallationId?: string | null,
): { githubInstallationId: string; githubAccountLogin: string } | null {
  if (installations.length === 0) {
    return null;
  }
  if (preferredInstallationId) {
    return installations.find(installation => installation.githubInstallationId === preferredInstallationId) ?? null;
  }
  const owner = parseGithubOwnerFromLocation(location);
  const exact = owner
    ? installations.find(installation => installation.githubAccountLogin.toLowerCase() === owner.toLowerCase())
    : undefined;
  if (exact) {
    return exact;
  }
  return null;
}

function mapUserRecord(user: {
  id: string;
  identityProvider: string;
  identitySubject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  entitlement: string;
  createdAt: Date;
  updatedAt: Date;
}): User {
  return userSchema.parse({
    id: user.id,
    identityProvider: user.identityProvider,
    identitySubject: user.identitySubject,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    entitlement: user.entitlement,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
}

function mapWorkspaceRecord(workspace: {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  description: string | null;
  entitlement: string;
  createdAt: Date;
  updatedAt: Date;
}): Workspace {
  return workspaceSchema.parse({
    id: workspace.id,
    ownerUserId: workspace.ownerUserId,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    entitlement: workspace.entitlement,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  });
}

function mapMemberSummaryRecord(membership: WorkspaceMembershipWithUser): WorkspaceMemberSummary {
  return workspaceMemberSummarySchema.parse({
    id: membership.id,
    workspaceId: membership.workspaceId,
    userId: membership.userId,
    role: membership.role,
    displayName: membership.user.displayName,
    email: membership.user.email,
    avatarUrl: membership.user.avatarUrl,
    createdAt: membership.createdAt.toISOString(),
  });
}

function mapSourceRecord(source: {
  id: string;
  workspaceId: string;
  type: string;
  displayName: string;
  location: string;
  visibility: string;
  verificationStatus?: string | null;
  verificationError?: string | null;
  githubInstallationId: string | null;
  uploadObjectKey: string | null;
  createdAt: Date;
}): Source {
  return sourceSchema.parse({
    id: source.id,
    workspaceId: source.workspaceId,
    type: requirePersistedHostedSourceType(source.type, `source ${source.id}`),
    displayName: source.displayName,
    location: source.location,
    visibility: source.visibility,
    verificationStatus: source.verificationStatus ?? "verified",
    verificationError: source.verificationError ?? null,
    githubInstallationId: source.githubInstallationId,
    uploadObjectKey: source.uploadObjectKey,
    createdAt: source.createdAt.toISOString(),
  });
}

function isActiveHostedSourceRecord(source: { type: string | null | undefined }): boolean {
  return normalizePersistedHostedSourceType(source.type) !== null;
}

export async function setSourceVerificationState(
  sourceId: string,
  status: "pending" | "verified" | "failed",
  error: string | null,
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.source.update({
    where: { id: sourceId },
    data: {
      verificationStatus: status,
      verificationError: error,
    },
  });
}

async function markSourcesForGithubInstallationRepair(
  workspaceId: string,
  githubInstallationId: string,
  message: string,
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.source.updateMany({
    where: {
      workspaceId,
      type: "github-private",
      githubInstallationId,
    },
    data: {
      verificationStatus: "failed",
      verificationError: message,
    },
  });
}

function assertHostedSourceReady(
  source: { displayName: string; verificationStatus?: string | null; verificationError?: string | null },
  action: string,
): void {
  const verificationStatus = source.verificationStatus ?? "verified";
  const verificationError = source.verificationError ?? null;
  if (verificationStatus === "verified") {
    return;
  }
  if (verificationStatus === "failed") {
    throw statusError(400, verificationError || `${source.displayName} failed source verification and cannot be used for ${action}.`);
  }
  throw statusError(400, `${source.displayName} is still verifying and cannot be used for ${action} yet.`);
}

function isActiveHostedJobRecord(job: {
  sourceType: string | null | undefined;
  companionSourceType?: string | null | undefined;
}): boolean {
  return normalizePersistedHostedSourceType(job.sourceType) !== null
    && (job.companionSourceType == null || normalizePersistedHostedSourceType(job.companionSourceType) !== null);
}

function mapLearnableRecord(record: {
  id: string;
  workspaceId: string;
  sourceId: string;
  learnedFromJobId: string;
  statement: string;
  category: string;
  evidenceJson: unknown;
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Learnable {
  return learnableSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    sourceId: record.sourceId,
    learnedFromJobId: record.learnedFromJobId,
    statement: record.statement,
    category: record.category,
    evidence: asJsonArray<string>(record.evidenceJson).filter(item => typeof item === "string"),
    order: record.order,
    active: record.active,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function mapSecretRecord(secret: {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  valuePreview: string;
  createdAt: Date;
  updatedAt: Date;
}): WorkspaceSecret {
  return workspaceSecretSchema.parse({
    id: secret.id,
    workspaceId: secret.workspaceId,
    name: secret.name,
    kind: secret.kind,
    valuePreview: secret.valuePreview,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
  });
}

function mapInstallationRecord(installation: {
  id: string;
  workspaceId: string;
  githubInstallationId: string;
  githubAccountLogin: string;
  createdAt: Date;
}): GithubInstallation {
  return githubInstallationSchema.parse({
    id: installation.id,
    workspaceId: installation.workspaceId,
    githubInstallationId: installation.githubInstallationId,
    githubAccountLogin: installation.githubAccountLogin,
    createdAt: installation.createdAt.toISOString(),
  });
}

function mapGithubInstallIntentRecord(record: {
  id: string;
  workspaceId: string;
  requestedByUserId: string;
  targetAppUrl: string;
  nonce: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}): GithubInstallIntent {
  return githubInstallIntentSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    requestedByUserId: record.requestedByUserId,
    targetAppUrl: record.targetAppUrl,
    nonce: record.nonce,
    expiresAt: record.expiresAt.toISOString(),
    consumedAt: record.consumedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
}

function mapGithubWebhookTargetRecord(record: {
  id: string;
  environmentLabel: string;
  appUrl: string;
  webhookForwardUrl: string;
  kind: string;
  status: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): GithubWebhookTarget {
  return githubWebhookTargetSchema.parse({
    id: record.id,
    environmentLabel: record.environmentLabel,
    appUrl: record.appUrl,
    webhookForwardUrl: record.webhookForwardUrl,
    kind: record.kind,
    status: record.status,
    expiresAt: record.expiresAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function mapArtifactRecord(artifact: {
  id: string;
  jobId: string;
  reportId: string | null;
  kind: string;
  objectKey: string;
  bucket: string;
  region: string;
  mimeType: string;
  sizeBytes: number;
  signedUrl: string | null;
  createdAt: Date;
}): ArtifactReference {
  return artifactReferenceSchema.parse({
    id: artifact.id,
    jobId: artifact.jobId,
    reportId: artifact.reportId,
    kind: artifact.kind,
    key: artifact.objectKey,
    bucket: artifact.bucket,
    region: artifact.region,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    ...(artifact.signedUrl ? { signedUrl: artifact.signedUrl } : {}),
    createdAt: artifact.createdAt.toISOString(),
  });
}

function resolveJobRoles(rolesJson: unknown): string[] {
  return asJsonArray<string>(rolesJson);
}

function resolveReportRoles(rolesJson: unknown): RoleDefinition[] {
  return asJsonArray<RoleDefinition>(rolesJson);
}

function inferFindingSourceIds(
  finding: AnalysisReport["findings"][number],
  sources: Array<{ id: string; displayName: string; location: string }>,
): string[] {
  const explicit = [...new Set((finding.sourceIds ?? []).filter(sourceId => sources.some(source => source.id === sourceId)))];
  if (explicit.length > 0) {
    return explicit;
  }
  if (sources.length === 1) {
    return [sources[0]!.id];
  }
  return [];
}

function attachFindingSourceIds(
  findings: AnalysisReport["findings"],
  sources: Array<{ id: string; displayName: string; location: string }>,
): AnalysisReport["findings"] {
  return findings.map(finding => ({
    ...finding,
    sourceIds: inferFindingSourceIds(finding, sources),
  }));
}

function mapReportRecord(
  report: {
    id: string;
    workspaceId: string;
    jobId: string;
    status: string;
    rolesJson: unknown;
    runtimeMode: string;
    title: string;
    summaryJson: unknown;
    findingsJson: unknown;
    sectionsJson: unknown;
    createdAt: Date;
    artifacts: Array<{
      id: string;
      jobId: string;
      reportId: string | null;
      kind: string;
      objectKey: string;
      bucket: string;
      region: string;
      mimeType: string;
      sizeBytes: number;
      signedUrl: string | null;
      createdAt: Date;
    }>;
  },
  sources: Array<{ id: string; displayName: string; location: string }> = [],
): AnalysisReport {
  return analysisReportSchema.parse({
    id: report.id,
    workspaceId: report.workspaceId,
    jobId: report.jobId,
    status: report.status,
    roles: resolveReportRoles(report.rolesJson),
    runtimeMode: report.runtimeMode,
    title: report.title,
    summary: report.summaryJson,
    findings: attachFindingSourceIds(asJsonArray(report.findingsJson), sources),
    sections: asJsonArray(report.sectionsJson),
    artifacts: report.artifacts.map(mapArtifactRecord),
    createdAt: report.createdAt.toISOString(),
  });
}

function mapReportSummaryRecord(report: {
  id: string;
  workspaceId: string;
  jobId: string;
  status: string;
  rolesJson: unknown;
  runtimeMode: string;
  title: string;
  summaryJson: unknown;
  createdAt: Date;
}): AnalysisReport {
  return analysisReportSchema.parse({
    id: report.id,
    workspaceId: report.workspaceId,
    jobId: report.jobId,
    status: report.status,
    roles: resolveReportRoles(report.rolesJson),
    runtimeMode: report.runtimeMode,
    title: report.title,
    summary: report.summaryJson,
    findings: [],
    sections: [],
    artifacts: [],
    createdAt: report.createdAt.toISOString(),
  });
}

function mapWorkspaceConsoleReportRecord(report: {
  id: string;
  workspaceId: string;
  jobId: string;
  status: string;
  title: string;
  createdAt: Date;
}): WorkspaceConsoleReportSummary {
  return workspaceConsoleReportSummarySchema.parse({
    id: report.id,
    workspaceId: report.workspaceId,
    jobId: report.jobId,
    status: report.status,
    title: report.title,
    createdAt: report.createdAt.toISOString(),
  });
}

function mapJobRecord(job: {
  id: string;
  workspaceId: string;
  sourceId: string;
  companionSourceId: string | null;
  reportId: string | null;
  parentReportId: string | null;
  jobKind: string;
  status: string;
  agentId: string | null;
  queueMessageId: string | null;
  claimedRunnerId: string | null;
  cancelRequestedAt: Date | null;
  failureReason: string | null;
  sourceType: string;
  sourceLocation: string;
  companionSourceType: string | null;
  companionSourceLocation: string | null;
  rolesJson: unknown;
  metadataJson: unknown;
  runtimeMode: string;
  secretRefsJson: unknown;
  requestedByUserId: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): AnalysisJob {
  return analysisJobSchema.parse({
    ...(() => {
      const metadata = parseJobMetadata(job.metadataJson);
      return {
        codexAuthScope: metadata.codexAuth?.scope ?? null,
        changeset: metadata.remediation?.changeset ?? null,
      };
    })(),
    id: job.id,
    workspaceId: job.workspaceId,
    sourceId: job.sourceId,
    companionSourceId: job.companionSourceId,
    reportId: job.reportId,
    parentReportId: job.parentReportId,
    jobKind: job.jobKind === "remediation" ? "remediation" : "audit",
    status: job.status,
    executionPath: resolveJobExecutionPath({
      agentId: job.agentId,
    }),
    agentId: job.agentId,
    queueMessageId: job.queueMessageId,
    claimedRunnerId: job.claimedRunnerId,
    cancelRequestedAt: job.cancelRequestedAt?.toISOString() ?? null,
    failureReason: job.failureReason,
    sourceType: requirePersistedHostedSourceType(job.sourceType, `job ${job.id} primary source`),
    sourceLocation: job.sourceLocation,
    companionSourceType: job.companionSourceType
      ? requirePersistedHostedSourceType(job.companionSourceType, `job ${job.id} companion source`)
      : null,
    companionSourceLocation: job.companionSourceLocation,
    roles: resolveJobRoles(job.rolesJson),
    runtimeMode: job.runtimeMode,
    secretRefs: asJsonArray(job.secretRefsJson),
    requestedByUserId: job.requestedByUserId,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  });
}

function mapLogRecord(log: {
  id: string;
  jobId: string;
  level: string;
  scope: string;
  message: string;
  visibility: string;
  requestId: string | null;
  createdAt: Date;
}): AnalysisLogEvent {
  return analysisLogEventSchema.parse({
    id: log.id,
    jobId: log.jobId,
    level: log.level,
    scope: log.scope,
    message: log.message,
    visibility: log.visibility,
    ...(log.requestId ? { requestId: log.requestId } : {}),
    createdAt: log.createdAt.toISOString(),
  });
}

function buildJobEnvelope(job: JobWithRelations): JobEnvelope {
  const jobRecord = mapJobRecord(job);
  const reportSources = [
    {
      id: job.sourceId,
      displayName: job.source.displayName,
      location: job.source.location,
    },
    ...(job.companionSource ? [{
      id: job.companionSource.id,
      displayName: job.companionSource.displayName,
      location: job.companionSource.location,
    }] : []),
  ];
  const report = job.report ? mapReportRecord(job.report, reportSources) : null;
  const logs = job.logs.map(mapLogRecord);
  return jobEnvelopeSchema.parse({
    job: jobRecord,
    logs,
    report,
    artifacts: job.artifacts.map(mapArtifactRecord),
    timing: buildJobTimingEstimate(job, jobRecord),
    qualityScorecard: report?.summary.qualityScorecard ?? null,
    capabilityGaps: report?.summary.capabilityGaps ?? [],
    artifactAnalysis: report?.summary.artifactAnalysis ?? null,
    executionSteps: report?.summary.executionSteps.length ? report.summary.executionSteps : collectAnalysisExecutionSteps(logs),
  });
}

function buildJobSummaryEnvelope(job: JobSummaryWithRelations): JobEnvelope {
  const jobRecord = mapJobRecord(job);
  const report = job.report ? mapReportSummaryRecord(job.report) : null;
  return jobEnvelopeSchema.parse({
    job: jobRecord,
    logs: [],
    report,
    artifacts: [],
    timing: buildJobTimingEstimate(job, jobRecord),
    qualityScorecard: report?.summary.qualityScorecard ?? null,
    capabilityGaps: report?.summary.capabilityGaps ?? [],
    artifactAnalysis: report?.summary.artifactAnalysis ?? null,
    executionSteps: report?.summary.executionSteps ?? [],
  });
}

function buildWorkspaceConsoleJob(job: JobSummaryWithRelations): WorkspaceConsoleJob {
  return {
    job: mapJobRecord(job),
    report: job.report ? mapWorkspaceConsoleReportRecord(job.report) : null,
  };
}

function estimateJobDurationMs(job: {
  roles: string[];
  runtimeMode: AnalysisJob["runtimeMode"];
}): number {
  const perRole = job.roles.reduce((total, roleId) => {
    switch (roleId) {
      case "browser-executor":
      case "playwright-operator":
        return total + (job.runtimeMode === "browser" ? 7_500 : 3_000);
      case "standardized-json-output":
        return total + (job.runtimeMode === "browser" ? 2_500 : 1_500);
      case "artifact-auditor":
      case "remediation-planner":
      case "e2e-remediation-planner":
      case "release-gate-scorer":
        return total + 1_500;
      default:
        return total + 2_250;
    }
  }, 0);
  return Math.max(perRole, job.runtimeMode === "browser" ? 45_000 : 20_000);
}

function buildJobTimingEstimate(
  job: { createdAt: Date; startedAt: Date | null; finishedAt: Date | null },
  jobRecord: AnalysisJob,
): JobEnvelope["timing"] {
  const createdAtMs = job.createdAt.getTime();
  const startedAtMs = job.startedAt?.getTime() ?? null;
  const finishedAtMs = job.finishedAt?.getTime() ?? null;
  const nowMs = finishedAtMs ?? Date.now();
  const elapsedMs = Math.max(0, nowMs - createdAtMs);
  const queueDurationMs = startedAtMs === null ? Math.max(0, nowMs - createdAtMs) : Math.max(0, startedAtMs - createdAtMs);
  const runDurationMs = startedAtMs === null ? null : Math.max(0, nowMs - startedAtMs);
  const totalDurationMs = finishedAtMs === null ? null : Math.max(0, finishedAtMs - createdAtMs);
  const estimatedTotalMs = finishedAtMs === null ? estimateJobDurationMs(jobRecord) : totalDurationMs;
  const estimatedRemainingMs = finishedAtMs === null && estimatedTotalMs !== null
    ? Math.max(0, estimatedTotalMs - elapsedMs)
    : 0;
  return {
    queueDurationMs,
    runDurationMs,
    totalDurationMs,
    elapsedMs,
    estimatedTotalMs,
    estimatedRemainingMs,
    confidence: finishedAtMs !== null ? "high" : startedAtMs !== null ? "medium" : "low",
    basis: finishedAtMs !== null
      ? "Derived from persisted created, started, and finished timestamps."
      : "Estimated from role count, runtime mode, and current execution timestamps.",
  };
}

function buildRoleFromWorkspace(workspace: {
  ownerUserId: string;
  memberships?: Array<{ userId: string; role: string }>;
}, userId: string): WorkspaceMembership["role"] | null {
  if (workspace.ownerUserId === userId) {
    return "owner";
  }
  return workspace.memberships?.find(membership => membership.userId === userId)?.role as WorkspaceMembership["role"] | undefined ?? null;
}

async function getAccessibleWorkspaceRecord(workspaceId: string, userId: string): Promise<{
  workspace: Prisma.WorkspaceGetPayload<{ include: { memberships: true } }>;
  role: WorkspaceMembership["role"];
}> {
  const prisma = getPrismaClient();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { memberships: true },
  });
  if (!workspace) {
    throw statusError(404, `Workspace not found: ${workspaceId}`);
  }
  const role = buildRoleFromWorkspace(workspace, userId);
  if (!role) {
    throw statusError(403, `You do not have access to workspace ${workspaceId}.`);
  }
  return { workspace, role };
}

async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  requiredRole: WorkspaceMembership["role"],
): Promise<Prisma.WorkspaceGetPayload<{ include: { memberships: true } }>> {
  const { workspace, role } = await getAccessibleWorkspaceRecord(workspaceId, userId);
  if (requiredRole === "owner" && role !== "owner") {
    throw statusError(403, `Owner access is required for workspace ${workspaceId}.`);
  }
  return workspace;
}

async function requireJobAccess(jobId: string, userId: string): Promise<JobWithRelations> {
  return requireJobAccessWithLogVisibility(jobId, userId, "all");
}

async function requireJobLifecycleMutationAccess(jobId: string, userId: string): Promise<JobWithRelations> {
  const job = await requireJobAccess(jobId, userId);
  await requireWorkspaceRole(job.workspaceId, userId, "owner");
  return job;
}

async function requireJobAccessWithLogVisibility(
  jobId: string,
  userId: string,
  logVisibility: AnalysisLogEvent["visibility"] | "all",
): Promise<JobWithRelations> {
  const prisma = getPrismaClient();
  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
    include: {
      logs: {
        ...(logVisibility === "all" ? {} : { where: { visibility: logVisibility } }),
        orderBy: logOrderBy,
      },
      report: {
        include: {
          artifacts: { orderBy: artifactOrderBy },
        },
      },
      artifacts: { orderBy: artifactOrderBy },
      source: true,
      companionSource: true,
      workspace: {
        include: {
          memberships: true,
        },
      },
    },
  });
  if (!job) {
    throw statusError(404, `Job not found: ${jobId}`);
  }
  const role = buildRoleFromWorkspace(job.workspace, userId);
  if (!role) {
    throw statusError(403, `You do not have access to job ${jobId}.`);
  }
  if (!isActiveHostedJobRecord(job)) {
    throw statusError(404, `Job ${jobId} is no longer available on the active hosted product path.`);
  }
  return job;
}

async function requireReportAccess(reportId: string, userId: string): Promise<ReportWithArtifacts> {
  const prisma = getPrismaClient();
  const report = await prisma.analysisReport.findUnique({
    where: { id: reportId },
    include: {
      artifacts: { orderBy: artifactOrderBy },
      job: {
        include: {
          source: true,
          companionSource: true,
        },
      },
      workspace: {
        include: { memberships: true },
      },
    },
  });
  if (!report) {
    throw statusError(404, `Report not found: ${reportId}`);
  }
  const role = buildRoleFromWorkspace(report.workspace, userId);
  if (!role) {
    throw statusError(403, `You do not have access to report ${reportId}.`);
  }
  if (!isActiveHostedJobRecord(report.job)) {
    throw statusError(404, `Report ${reportId} is no longer available on the active hosted product path.`);
  }
  return report;
}

async function nextWorkspaceSlug(baseValue: string): Promise<string> {
  const prisma = getPrismaClient();
  const base = slugify(baseValue);
  let candidate = base;
  let index = 1;
  for (;;) {
    const existing = await prisma.workspace.findUnique({ where: { slug: candidate } });
    if (!existing) {
      return candidate;
    }
    index += 1;
    candidate = `${base}-${index}`;
  }
}

async function updateOwnedWorkspaceEntitlement(userId: string, entitlement: User["entitlement"]): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: userId },
      data: {
        entitlement,
        updatedAt: new Date(),
      },
    }),
    prisma.workspace.updateMany({
      where: { ownerUserId: userId },
      data: {
        entitlement,
        updatedAt: new Date(),
      },
    }),
  ]);
}

export async function recordAuditLog(input: {
  userId: string;
  workspaceId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  requestId?: string;
}): Promise<void> {
  if (process.env.AUDIT_LOG_ENABLED !== "true") {
    return;
  }
  const prisma = getPrismaClient();
  await prisma.auditLog.create({
    data: {
      id: createId("audit"),
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      requestId: input.requestId ?? null,
    },
  });
}

export async function createCommercialContactRequest(input: CommercialContactInput): Promise<{
  id: string;
  createdAt: string;
}> {
  const prisma = getPrismaClient();
  const record = await prisma.commercialContactRequest.create({
    data: {
      id: createId("contact"),
      name: input.name,
      email: input.email,
      company: input.company?.trim() || null,
      message: input.message,
    },
  });
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
  };
}

async function createManyLogs(logs: AnalysisLogEvent[]): Promise<void> {
  if (logs.length === 0) {
    return;
  }
  const prisma = getPrismaClient();
  await prisma.analysisJobLog.createMany({
    data: logs.map(log => ({
      id: log.id,
      jobId: log.jobId,
      level: log.level,
      scope: log.scope,
      message: log.message,
      visibility: log.visibility,
      requestId: log.requestId ?? null,
      createdAt: new Date(log.createdAt),
    })),
    skipDuplicates: true,
  });
}

export async function appendAnalysisJobLogs(jobId: string, logs: AnalysisLogEvent[]): Promise<void> {
  const normalized = logs.map(log => analysisLogEventSchema.parse({
    ...log,
    jobId,
  }));
  await createManyLogs(normalized);
}

export async function initializeDatabase(): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$connect();
  await importLegacySnapshotIfNeeded();
  await ensureDefaultAiAgentCatalog();
}

export async function checkDatabaseHealth(): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$queryRaw(Prisma.sql`SELECT 1`);
}

export async function getJobStatusCounts(): Promise<Record<string, number>> {
  const prisma = getPrismaClient();
  const rows = await prisma.analysisJob.groupBy({
    by: ["status"],
    _count: {
      status: true,
    },
  });
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count.status ?? 0;
    return acc;
  }, {});
}

export async function disconnectDatabase(): Promise<void> {
  if (!prismaClient) {
    return;
  }
  await prismaClient.$disconnect();
  prismaClient = null;
}

async function ensureDefaultAiAgentCatalog(): Promise<void> {
  const prisma = getPrismaClient();
  const skillSpecs = [
    {
      key: "evidence-discipline",
      id: "skill-evidence-discipline",
      name: "Evidence discipline",
      description: "Ground every finding in observable repository or runtime evidence.",
      instructions: "Only emit findings backed by concrete repo files, runtime output, browser output, or structured artifacts.",
      toolCapabilities: ["repo-read"],
      order: 0,
    },
    {
      key: "severity-calibration",
      id: "skill-severity-calibration",
      name: "Severity calibration",
      description: "Keep severity assignments consistent across audit bundles.",
      instructions: "Reserve high severity for release blockers, security failures, broken runtime paths, or user-visible breakage. Do not mark an intentional configuration gate high when the product fails closed with a clear recovery state or controlled 503; classify that as a setup prerequisite or capability gap unless the documented default deployment cannot work.",
      toolCapabilities: ["repo-read"],
      order: 1,
    },
    {
      key: "duplication-detection",
      id: "skill-duplication-detection",
      name: "Duplication detection",
      description: "Look for duplicated logic, UI primitives, and drift.",
      instructions: "Flag duplicate implementations only when the overlap is concrete and creates maintenance risk.",
      toolCapabilities: ["repo-read"],
      order: 2,
    },
    {
      key: "rule-spec-alignment",
      id: "skill-rule-spec-alignment",
      name: "Rule and spec alignment",
      description: "Align output with repository docs and specs.",
      instructions: "Use repository specs and architecture docs when they exist, but do not invent missing contracts.",
      toolCapabilities: ["repo-read"],
      order: 3,
    },
    {
      key: "remediation-pack-formatting",
      id: "skill-remediation-pack-formatting",
      name: "Remediation pack formatting",
      description: "Emit grouped, implementation-ready remediation packs.",
      instructions: "Group fixes by subsystem and dependency order so downstream fix agents can execute them cleanly.",
      toolCapabilities: ["repo-read", "artifact-write"],
      order: 4,
    },
    {
      key: "artifact-validation",
      id: "skill-artifact-validation",
      name: "Artifact validation",
      description: "Verify that expected reports and browser artifacts are present.",
      instructions: "Check that required artifacts exist, are structurally valid, and match the claimed coverage.",
      toolCapabilities: ["repo-read", "artifact-write"],
      order: 5,
    },
    {
      key: "runtime-discovery",
      id: "skill-runtime-discovery",
      name: "Runtime discovery",
      description: "Determine install, build, start, and verification commands.",
      instructions: "Inspect manifests, lockfiles, docs, CI, Docker, compose, and scripts to derive the highest-confidence runtime path. In hosted job sandboxes, absence of Docker/Compose inside the job container is expected; compose validation belongs to controller/preflight evidence, while app/runtime/browser work should use repo-native commands inside the sandbox.",
      toolCapabilities: ["repo-read", "shell-exec", "package-install", "dev-server", "test-exec"],
      order: 6,
    },
    {
      key: "application-operator",
      id: "skill-application-operator",
      name: "Application operator",
      description: "Map startup strategies for web, API, worker, and containerized apps.",
      instructions: "Support Node, Python, Go, Docker, and static-site boot paths when the repo evidence supports them.",
      toolCapabilities: ["repo-read", "shell-exec", "http-fetch", "package-install", "dev-server", "test-exec"],
      order: 7,
    },
    {
      key: "service-topology-detection",
      id: "skill-service-topology-detection",
      name: "Service topology detection",
      description: "Classify apps, services, docs, and supporting infrastructure.",
      instructions: "Separate user-facing apps from APIs, workers, background services, and docs surfaces in the handoff data.",
      toolCapabilities: ["repo-read"],
      order: 8,
    },
    {
      key: "env-secret-discovery",
      id: "skill-env-secret-discovery",
      name: "Env and secret discovery",
      description: "Map env files, secret names, and bootstrap gaps.",
      instructions: "Report required secret references and env files, but never invent secret values or credentials.",
      toolCapabilities: ["repo-read", "shell-exec"],
      order: 9,
    },
    {
      key: "auth-discovery",
      id: "skill-auth-discovery",
      name: "Auth discovery",
      description: "Map frontend and API authentication flows.",
      instructions: "Identify login routes, callback routes, protected paths, provider hints, and auth blockers without guessing. Treat missing required auth/OAuth env as a setup prerequisite when the API returns controlled errors or the web UI shows recovery guidance; make it high only when users lose recovery or a documented configured deployment is broken.",
      toolCapabilities: ["repo-read", "shell-exec", "http-fetch", "auth-state"],
      order: 10,
    },
    {
      key: "live-surface-resolution",
      id: "skill-live-surface-resolution",
      name: "Live surface resolution",
      description: "Find trustworthy companion URLs when they are documented or derivable.",
      instructions: "Only claim a live companion surface when the repo, env, or docs point to it explicitly.",
      toolCapabilities: ["repo-read", "http-fetch"],
      order: 11,
    },
    {
      key: "license-policy-reasoning",
      id: "skill-license-policy-reasoning",
      name: "License policy reasoning",
      description: "Review root and package licenses for policy mismatches.",
      instructions: "Inspect root license files, active package manifests, notices, and legal copy for conflicts or omissions. Treat fixtures, tests, generated artifacts, and archived reference code as reference-only unless they are packaged into the active product.",
      toolCapabilities: ["repo-read"],
      order: 12,
    },
    {
      key: "dependency-policy-review",
      id: "skill-dependency-policy-review",
      name: "Dependency policy review",
      description: "Assess dependency hygiene and supply-chain risks.",
      instructions: "Look for missing lockfiles, stale dependency posture, risky package patterns, and undocumented install drift.",
      toolCapabilities: ["repo-read", "shell-exec", "test-exec"],
      order: 13,
    },
    {
      key: "architecture-heuristics",
      id: "skill-architecture-heuristics",
      name: "Architecture heuristics",
      description: "Assess boundaries, ownership, and layering.",
      instructions: "Look for hidden coupling, oversized modules, circularity, and boundary drift across apps and packages.",
      toolCapabilities: ["repo-read"],
      order: 14,
    },
    {
      key: "code-health-heuristics",
      id: "skill-code-health-heuristics",
      name: "Code health heuristics",
      description: "Review correctness, validation, typing, and error handling.",
      instructions: "Focus on correctness risk, missing tests, weak validation, and observability gaps with concrete file evidence.",
      toolCapabilities: ["repo-read", "shell-exec", "test-exec"],
      order: 15,
    },
    {
      key: "test-gap-analysis",
      id: "skill-test-gap-analysis",
      name: "Test gap analysis",
      description: "Map missing test coverage and weak assertions.",
      instructions: "Identify meaningful product and regression gaps rather than generic requests for more tests.",
      toolCapabilities: ["repo-read", "test-exec"],
      order: 16,
    },
    {
      key: "docs-contract-consistency",
      id: "skill-docs-contract-consistency",
      name: "Docs contract consistency",
      description: "Compare implementation against docs and visible product contracts.",
      instructions: "Report mismatches between docs, pricing, legal, auth, and runtime behavior when they are evidence-backed.",
      toolCapabilities: ["repo-read"],
      order: 17,
    },
    {
      key: "component-inventory",
      id: "skill-component-inventory",
      name: "Component inventory",
      description: "Inventory UI components and shared primitives.",
      instructions: "List representative UI primitives, duplicate names, and obvious shared primitive gaps.",
      toolCapabilities: ["repo-read"],
      order: 18,
    },
    {
      key: "design-system-review",
      id: "skill-design-system-review",
      name: "Design system review",
      description: "Assess tokens, spacing, typography, and reusable patterns.",
      instructions: "Focus on maintainability, consistency, and state coverage rather than subjective style commentary.",
      toolCapabilities: ["repo-read", "browser-automation"],
      order: 19,
    },
    {
      key: "copy-consistency-review",
      id: "skill-copy-consistency-review",
      name: "Copy consistency review",
      description: "Assess labels, terminology, and missing text.",
      instructions: "Look for mismatched terms, unclear CTAs, missing labels, and legal or pricing wording drift.",
      toolCapabilities: ["repo-read", "browser-automation"],
      order: 20,
    },
    {
      key: "accessibility-review",
      id: "skill-accessibility-review",
      name: "Accessibility review",
      description: "Assess landmarks, headings, forms, and semantics.",
      instructions: "Use code and browser evidence to report structural accessibility issues without inventing contrast scores.",
      toolCapabilities: ["repo-read", "browser-automation"],
      order: 21,
    },
    {
      key: "site-navigation-qa",
      id: "skill-site-navigation-qa",
      name: "Site navigation QA",
      description: "Map routes, auth boundaries, and risk-ranked journeys.",
      instructions: "Emit concrete routes, journeys, assertion targets, and coverage gaps for browser-visible surfaces.",
      toolCapabilities: ["repo-read", "http-fetch", "browser-automation", "artifact-write", "test-exec"],
      order: 22,
    },
    {
      key: "playwright-operator",
      id: "skill-playwright-operator",
      name: "Playwright operator",
      description: "Turn repo evidence into a safe Playwright execution path.",
      instructions: "Keep package managers, working directories, commands, auth strategy, and artifact expectations explicit. Never probe Playwright with transient `npx playwright` before locked dependencies are installed; prefer repository scripts and record dependency setup first.",
      toolCapabilities: ["repo-read", "shell-exec", "browser-automation", "artifact-write", "package-install", "dev-server", "test-exec", "auth-state"],
      order: 23,
    },
    {
      key: "direct-browser-qa",
      id: "skill-direct-browser-qa",
      name: "Direct browser QA",
      description: "Plan direct browser interaction coverage.",
      instructions: "Prioritize navigation, empty states, request failures, console failures, and visible UX breakage.",
      toolCapabilities: ["repo-read", "browser-automation", "artifact-write"],
      order: 24,
    },
    {
      key: "visual-qa-heuristics",
      id: "skill-visual-qa-heuristics",
      name: "Visual QA heuristics",
      description: "Assess layout, overlap, clipping, density, and readability issues.",
      instructions: "Use screenshots and browser evidence to describe concrete visual problems and likely causes.",
      toolCapabilities: ["repo-read", "browser-automation", "artifact-write"],
      order: 25,
    },
    {
      key: "ux-friction-review",
      id: "skill-ux-friction-review",
      name: "UX friction review",
      description: "Assess flow friction, empty states, loading states, and action clarity.",
      instructions: "Focus on places where a user could get stuck, confused, or misled by the interface.",
      toolCapabilities: ["repo-read", "browser-automation"],
      order: 26,
    },
    {
      key: "implementation-slicing",
      id: "skill-implementation-slicing",
      name: "Implementation slicing",
      description: "Translate findings into ordered implementation slices.",
      instructions: "Group work into change sets that minimize merge risk and maximize verification clarity.",
      toolCapabilities: ["repo-read"],
      order: 27,
    },
    {
      key: "patch-readiness",
      id: "skill-patch-readiness",
      name: "Patch readiness",
      description: "Prepare explicit handoff details for fix agents.",
      instructions: "Emit ownership, target files, test expectations, and rollback notes for downstream implementation work.",
      toolCapabilities: ["repo-read", "artifact-write"],
      order: 28,
    },
    {
      key: "test-plan-generation",
      id: "skill-test-plan-generation",
      name: "Test plan generation",
      description: "Define verification plans per remediation pack.",
      instructions: "Keep test plans short, deterministic, and scoped to the impacted subsystems.",
      toolCapabilities: ["repo-read", "artifact-write", "test-exec"],
      order: 29,
    },
    {
      key: "rollback-risk-notes",
      id: "skill-rollback-risk-notes",
      name: "Rollback and risk notes",
      description: "Capture operational caveats and rollback expectations.",
      instructions: "Note rollout risk, operational dependencies, and fallback paths when recommending changes.",
      toolCapabilities: ["repo-read", "artifact-write"],
      order: 30,
    },
    {
      key: "standardized-json",
      id: "skill-standardized-json",
      name: "Standardized JSON handoff",
      description: "Emit a stable machine-readable universal audit handoff.",
      instructions: "Use predictable keys and structured data for the canonical handoff, execution coverage, remediation packs, and release gate.",
      toolCapabilities: ["repo-read", "artifact-write"],
      order: 31,
    },
    {
      key: "smoke-summary",
      id: "skill-smoke-summary",
      name: "Smoke summary",
      description: "Produce a concise top-level smoke summary.",
      instructions: "Limit the sweep to high-signal repository evidence and the most obvious release risk.",
      toolCapabilities: ["repo-read"],
      order: 32,
    },
  ] as const;

  const roleSpecs = [
    {
      key: "source-topology-scout",
      id: "source-topology-scout",
      name: "Source topology scout",
      description: "Classify repo shape, apps, packages, languages, and likely product surfaces.",
      consoleVisibility: "quiet",
      executorKind: "hybrid",
      nativeExecutorId: "native-repo-inventory",
      prompt: "Survey the repository shape and classify applications, packages, languages, and likely user-facing surfaces. Emit a section titled \"Source topology\" with structured inventory data.",
      order: 0,
      skillKeys: ["evidence-discipline", "service-topology-detection", "duplication-detection"],
      dependencyKeys: [],
    },
    {
      key: "runtime-scout",
      id: "runtime-scout",
      name: "Runtime scout",
      description: "Derive exact install, build, start, and verification contracts.",
      prompt: [
        "Determine the highest-confidence runtime contract for this repo. Emit commands, package managers, working directories, targets, ports, env files, base URLs, and blockers in a section titled \"Runtime scout\".",
        "Hosted job policy: do not require Docker Compose or a Docker socket inside the per-job sandbox. Compose/DinD readiness is controller/preflight evidence; inside the sandbox, prefer repo-native install/start/verify commands and the worker-provided browser/Playwright evidence.",
        "Only classify missing Compose inside the job sandbox as high when the repo has no direct app/runtime path and no controller/preflight evidence proves the hosted stack was already prepared.",
      ].join("\n"),
      order: 1,
      skillKeys: ["evidence-discipline", "runtime-discovery", "application-operator", "env-secret-discovery"],
      dependencyKeys: ["source-topology-scout"],
    },
    {
      key: "auth-cartographer",
      id: "auth-cartographer",
      name: "Auth cartographer",
      description: "Map auth flows, protected routes, roles, and required secrets.",
      prompt: [
        "Map frontend and API authentication, protected routes, login callbacks, required secret refs, local shortcuts, and blockers. Emit a section titled \"Auth map\" with structured auth data.",
        "Severity calibration: missing Keycloak/Codex OAuth env is a setup prerequisite when the web UI provides a public recovery page or the API returns a controlled 503. Treat it as high only if configured environments are broken, users can loop without recovery, or secrets are mishandled.",
      ].join("\n"),
      order: 2,
      skillKeys: ["evidence-discipline", "auth-discovery", "env-secret-discovery"],
      dependencyKeys: ["runtime-scout"],
    },
    {
      key: "live-surface-resolver",
      id: "live-surface-resolver",
      name: "Live surface resolver",
      description: "Determine whether a trusted companion live URL exists.",
      prompt: "Resolve documented companion URLs for the product when they exist. Emit a section titled \"Live surface resolution\" with trusted live surfaces and any blockers.",
      order: 3,
      skillKeys: ["evidence-discipline", "live-surface-resolution", "docs-contract-consistency"],
      dependencyKeys: ["source-topology-scout", "runtime-scout"],
    },
    {
      key: "license-governor",
      id: "license-governor",
      name: "License governor",
      description: "Review licenses, notices, and legal mismatches.",
      executorKind: "hybrid",
      nativeExecutorId: "native-license-policy",
      prompt: "Inspect root and active package licenses, notices, and legal copy. Emit a section titled \"License review\" and findings for policy conflicts or missing legal data. Do not make fixtures, tests, generated artifacts, or archived reference code release-blocking unless the repo packages them into the active product.",
      order: 4,
      skillKeys: ["evidence-discipline", "severity-calibration", "license-policy-reasoning", "docs-contract-consistency"],
      dependencyKeys: ["source-topology-scout"],
    },
    {
      key: "dependency-risk-reviewer",
      id: "dependency-risk-reviewer",
      name: "Dependency risk reviewer",
      description: "Review dependency posture and supply-chain hygiene.",
      prompt: "Review dependency hygiene, lockfile posture, risky package patterns, and missing dependency controls. Emit a section titled \"Dependency risk review\".",
      order: 5,
      skillKeys: ["evidence-discipline", "dependency-policy-review", "test-gap-analysis"],
      dependencyKeys: ["runtime-scout"],
    },
    {
      key: "architecture-reviewer",
      id: "architecture-reviewer",
      name: "Architecture reviewer",
      description: "Assess boundaries, layering, and hidden coupling.",
      prompt: "Review boundaries, ownership, layering, circularity, dead modules, and hidden coupling. Emit a section titled \"Architecture review\" with concrete subsystem evidence.",
      order: 6,
      skillKeys: ["evidence-discipline", "architecture-heuristics", "rule-spec-alignment"],
      dependencyKeys: ["source-topology-scout"],
    },
    {
      key: "code-health-reviewer",
      id: "code-health-reviewer",
      name: "Code health reviewer",
      description: "Assess correctness, tests, validation, and observability.",
      prompt: "Review correctness risk, missing validation, typing issues, error handling, missing tests, and observability gaps. Emit a section titled \"Code health review\".",
      order: 7,
      skillKeys: ["evidence-discipline", "code-health-heuristics", "test-gap-analysis"],
      dependencyKeys: ["runtime-scout", "architecture-reviewer"],
    },
    {
      key: "component-cartographer",
      id: "component-cartographer",
      name: "Component cartographer",
      description: "Inventory components and shared primitives.",
      executorKind: "hybrid",
      nativeExecutorId: "native-component-inventory",
      prompt: "Inventory significant UI components, duplicate abstractions, ownership drift, and missing shared primitives. Emit a section titled \"Component inventory\" with structured component data.",
      order: 8,
      skillKeys: ["evidence-discipline", "component-inventory", "duplication-detection"],
      dependencyKeys: ["source-topology-scout"],
    },
    {
      key: "design-system-auditor",
      id: "design-system-auditor",
      name: "Design system auditor",
      description: "Assess design-system consistency and state coverage.",
      prompt: "Assess tokens, spacing, typography, visual patterns, and state coverage. Emit a section titled \"Design system review\" with concrete consistency observations.",
      order: 9,
      skillKeys: ["evidence-discipline", "design-system-review", "duplication-detection"],
      dependencyKeys: ["component-cartographer"],
    },
    {
      key: "copy-consistency-auditor",
      id: "copy-consistency-auditor",
      name: "Copy consistency auditor",
      description: "Assess terminology, labels, and missing text.",
      executorKind: "hybrid",
      nativeExecutorId: "native-ui-label-scan",
      prompt: "Review user-facing text for terminology drift, unclear CTAs, legal/pricing wording mismatches, and missing labels. Emit a section titled \"Copy consistency review\".",
      order: 10,
      skillKeys: ["evidence-discipline", "copy-consistency-review", "docs-contract-consistency"],
      dependencyKeys: ["component-cartographer"],
    },
    {
      key: "accessibility-auditor",
      id: "accessibility-auditor",
      name: "Accessibility auditor",
      description: "Assess landmarks, headings, forms, and semantics.",
      prompt: "Review structure-aware accessibility signals in code and browser-visible surfaces. Emit a section titled \"Accessibility review\" with concrete evidence.",
      order: 11,
      skillKeys: ["evidence-discipline", "accessibility-review"],
      dependencyKeys: ["component-cartographer"],
    },
    {
      key: "navigation-qa-planner",
      id: "navigation-qa-planner",
      name: "Navigation QA planner",
      description: "Map routes, auth boundaries, and risk-ranked journeys.",
      prompt: [
        "Derive route inventory, auth boundaries, dominant journeys, browser assertions, and artifact expectations. Emit a section titled \"Navigation QA plan\".",
        "Hosted job policy: direct browser/runtime evidence produced inside the job sandbox is valid navigation evidence. Do not require Compose-backed stack startup inside the sandbox; use controller/preflight sandbox evidence for compose/DinD readiness and classify missing in-sandbox Compose as a capability gap unless no browser/runtime evidence exists.",
      ].join("\n"),
      order: 12,
      skillKeys: ["evidence-discipline", "site-navigation-qa", "auth-discovery", "live-surface-resolution"],
      dependencyKeys: ["runtime-scout", "auth-cartographer", "live-surface-resolver"],
    },
    {
      key: "browser-executor",
      id: "browser-executor",
      name: "Browser executor",
      description: "Prepare direct browser QA expectations.",
      executorKind: "native",
      nativeExecutorId: "native-browser-suite",
      prompt: "Translate the navigation plan into concrete browser execution targets, failure heuristics, and visible artifacts. Emit a section titled \"Browser execution plan\".",
      order: 13,
      skillKeys: ["evidence-discipline", "direct-browser-qa", "site-navigation-qa"],
      dependencyKeys: ["navigation-qa-planner"],
    },
    {
      key: "playwright-operator",
      id: "playwright-operator",
      name: "Playwright operator",
      description: "Prepare repo-native Playwright execution details.",
      prompt: [
        "Inspect Playwright coverage and emit the most concrete package manager, working directory, command, auth strategy, and artifact expectations you can support in a section titled \"Playwright operator plan\".",
        "Execution rule: do not run `npx playwright`, `playwright test`, or equivalent direct probes before confirming dependencies are installed or before running the repository's locked install command (`npm ci`, `pnpm install --frozen-lockfile`, etc.). Prefer package.json scripts over transient tool downloads.",
        "If the worker-provided preflight section reports a successful command, treat that as stronger evidence than an earlier exploratory command failure.",
      ].join("\n"),
      order: 14,
      skillKeys: ["evidence-discipline", "playwright-operator", "application-operator", "auth-discovery"],
      dependencyKeys: ["runtime-scout", "auth-cartographer", "navigation-qa-planner"],
    },
    {
      key: "visual-qa-critic",
      id: "visual-qa-critic",
      name: "Visual QA critic",
      description: "Assess likely or observed visual defects.",
      executorKind: "native",
      nativeExecutorId: "native-visual-inspection",
      prompt: "Assess overlap, clipping, hierarchy, density, and readability issues using code and browser evidence. Emit a section titled \"Visual QA review\".",
      order: 15,
      skillKeys: ["evidence-discipline", "visual-qa-heuristics", "design-system-review"],
      dependencyKeys: ["component-cartographer", "browser-executor"],
    },
    {
      key: "ux-friction-reviewer",
      id: "ux-friction-reviewer",
      name: "UX friction reviewer",
      description: "Assess confusing or high-friction flows.",
      prompt: "Review empty states, loading states, error states, action clarity, and information architecture friction. Emit a section titled \"UX friction review\".",
      order: 16,
      skillKeys: ["evidence-discipline", "ux-friction-review", "site-navigation-qa"],
      dependencyKeys: ["navigation-qa-planner", "browser-executor"],
    },
    {
      key: "cross-surface-consistency-reviewer",
      id: "cross-surface-consistency-reviewer",
      name: "Cross-surface consistency reviewer",
      description: "Align repo, docs, live surfaces, and browser evidence.",
      prompt: [
        "Compare the repository, docs, legal/pricing/auth/admin surfaces, and browser plan for consistency. Emit a section titled \"Cross-surface consistency\".",
        "Use sandbox browser/runtime artifacts and controller preflight evidence as valid hosted-job evidence. Do not fail consistency solely because Docker Compose is unavailable inside the job sandbox.",
      ].join("\n"),
      order: 17,
      skillKeys: ["evidence-discipline", "docs-contract-consistency", "duplication-detection"],
      dependencyKeys: ["license-governor", "copy-consistency-auditor", "navigation-qa-planner"],
    },
    {
      key: "artifact-auditor",
      id: "artifact-auditor",
      name: "Artifact auditor",
      description: "Verify artifact completeness and structural validity.",
      executorKind: "native",
      nativeExecutorId: "deterministic-artifact-expectations",
      prompt: [
        "Define the artifact expectations for this audit bundle and emit a section titled \"Artifact expectations\" with expected reports, traces, screenshots, route maps, and related artifact requirements.",
        "Calibrate timing carefully: browser/runtime artifacts created by prior roles are available during this role, but final report exports (`report.json`, `report.md`, `report.html`, generated spec pack, and final run manifest) are written by the controller after all roles complete.",
        "Do not raise missing-final-report findings during this role solely because those controller-finalized files are not visible yet; instead list them as finalization expectations unless persisted artifact evidence proves the controller failed.",
      ].join("\n"),
      order: 18,
      skillKeys: ["evidence-discipline", "artifact-validation"],
      dependencyKeys: ["browser-executor", "playwright-operator"],
    },
    {
      key: "remediation-planner",
      id: "remediation-planner",
      name: "Remediation planner",
      description: "Group issues into fix-ready remediation packs.",
      prompt: "Group the collected findings into remediation packs ordered by impact and dependency. Emit a section titled \"Remediation planning\" with pack candidates.",
      order: 19,
      skillKeys: ["evidence-discipline", "remediation-pack-formatting", "implementation-slicing", "test-plan-generation"],
      dependencyKeys: ["architecture-reviewer", "code-health-reviewer", "visual-qa-critic", "ux-friction-reviewer", "artifact-auditor"],
    },
    {
      key: "e2e-remediation-planner",
      id: "e2e-remediation-planner",
      name: "E2E remediation planner",
      description: "Synthesize remediation packs deterministically from prior findings for stable local E2E coverage.",
      executorKind: "native",
      nativeExecutorId: "deterministic-remediation-planning",
      prompt: "Group the collected findings into remediation packs ordered by impact and dependency. Emit a section titled \"Remediation planning\" with pack candidates.",
      order: 20,
      skillKeys: ["evidence-discipline", "remediation-pack-formatting", "implementation-slicing", "test-plan-generation"],
      dependencyKeys: ["source-topology-scout", "runtime-scout"],
    },
    {
      key: "fix-readiness-emitter",
      id: "fix-readiness-emitter",
      name: "Fix readiness emitter",
      description: "Prepare explicit handoff details for downstream fix agents.",
      prompt: "Emit explicit implementation handoff details, target files, tests, and rollback notes in a section titled \"Fix readiness handoff\".",
      order: 21,
      skillKeys: ["evidence-discipline", "patch-readiness", "rollback-risk-notes", "test-plan-generation"],
      dependencyKeys: ["remediation-planner"],
    },
    {
      key: "release-gate-scorer",
      id: "release-gate-scorer",
      name: "Release gate scorer",
      description: "Emit the final recommendation and severity rollup.",
      prompt: [
        "Emit the final bundle-specific pass, warn, or fail recommendation with confidence, blockers, and rationale in a section titled \"Release gate recommendation\".",
        "Calibrate artifact timing: controller-finalized report exports are produced after all roles complete, so do not fail the gate solely because `report.json`, `report.md`, `report.html`, the generated spec pack, or the final run manifest are not visible inside the role workspace yet.",
        "Use the artifact-auditor handoff (`generatedArtifacts`, `sourcePaths`, `presentGeneratedKinds`, and `missingGeneratedKinds`) as the canonical evidence for already-executed sandbox artifacts.",
        "Do not probe project-root paths such as `.speclens-workspace`, `test-results`, or `playwright-report` as a substitute for artifact-auditor evidence; hosted artifacts are written under the job output root and mirrored by the controller.",
        "Only treat artifact absence as a blocker when artifact-auditor reports missing required generated artifact kinds, browser/runtime artifacts are structurally invalid, or prior execution evidence explicitly contradicts artifact-auditor output.",
        "Do not fail the gate solely because Docker Compose is unavailable inside the per-job sandbox. For hosted jobs, compose/DinD readiness is controller/preflight evidence; in-sandbox direct runtime, browser executor, and Playwright preflight evidence are the release-gate inputs.",
        "Do not fail the gate for intentional auth/Codex setup prerequisites when the UI/API fails closed with clear recovery or controlled 503 responses; classify those as deployment readiness warnings unless configured production evidence is broken.",
      ].join("\n"),
      order: 22,
      skillKeys: ["evidence-discipline", "severity-calibration", "artifact-validation"],
      dependencyKeys: ["cross-surface-consistency-reviewer", "artifact-auditor", "remediation-planner", "e2e-remediation-planner"],
    },
    {
      key: "standardized-json-output",
      id: "standardized-json-output",
      name: "Standardized JSON output",
      description: "Produce the canonical universal audit handoff.",
      executorKind: "native",
      nativeExecutorId: "deterministic-standardized-handoff",
      prompt: [
        "Use all prior role outputs and current evidence to emit exactly one ready section titled \"Standardized JSON handoff\".",
        "The section data must include a standardizedOutput object with these top-level keys: schemaVersion, auditBundleId, generatedBy, runtime, auth, playwright, detectedSurfaces, executionCoverage, artifactExpectations, remediationPacks, releaseGateDecision, blockers, recommendations.",
        "Keep commands, URLs, auth details, artifact expectations, and blockers evidence-backed and machine-readable.",
      ].join("\n"),
      order: 23,
      skillKeys: ["evidence-discipline", "standardized-json", "artifact-validation", "remediation-pack-formatting"],
      dependencyKeys: ["runtime-scout", "auth-cartographer", "navigation-qa-planner", "playwright-operator", "artifact-auditor", "remediation-planner", "e2e-remediation-planner", "release-gate-scorer"],
    },
    {
      key: "smoke-summary",
      id: "smoke-summary",
      name: "Smoke summary",
      description: "Produce a fast top-level smoke summary.",
      consoleVisibility: "quiet",
      prompt: "Inspect top-level repository evidence, derive stack hints, and emit one concise section titled \"Smoke analysis\" with the most obvious release risk.",
      order: 24,
      skillKeys: ["smoke-summary", "evidence-discipline", "severity-calibration"],
      dependencyKeys: ["source-topology-scout"],
    },
  ] as const;

  const agentSpecs = [
    {
      id: "agent-e2e-smoke",
      name: "E2E audit smoke agent",
      description: "Minimal local-browser E2E bundle for queueing, report generation, and code-review validation.",
      order: 0,
      roleKeys: [
        "source-topology-scout",
        "runtime-scout",
        "smoke-summary",
        "release-gate-scorer",
        "standardized-json-output",
      ],
    },
    {
      id: "agent-e2e-remediation",
      name: "E2E remediation audit agent",
      description: "Minimal local-browser E2E bundle that still emits remediation planning context.",
      order: 1,
      roleKeys: [
        "source-topology-scout",
        "runtime-scout",
        "smoke-summary",
        "e2e-remediation-planner",
        "release-gate-scorer",
        "standardized-json-output",
      ],
    },
    {
      id: "agent-universal-smoke",
      name: "Universal audit smoke agent",
      description: "Fast intake bundle for repository topology, runtime confidence, and highest-risk blockers.",
      order: 2,
      roleKeys: [
        "source-topology-scout",
        "runtime-scout",
        "license-governor",
        "smoke-summary",
        "release-gate-scorer",
        "standardized-json-output",
      ],
    },
    {
      id: "agent-e2e-runtime-tooling-fast",
      name: "Runtime tooling fast agent",
      description: "Focused sandbox, runtime, browser, Playwright, and artifact validation bundle for fast dogfood cycles.",
      order: 3,
      roleKeys: [
        "runtime-scout",
        "browser-executor",
        "playwright-operator",
        "artifact-auditor",
        "standardized-json-output",
      ],
    },
    {
      id: "agent-universal-standard",
      name: "Universal audit standard agent",
      description: "Broad repository, runtime, browser, UX, and remediation audit bundle.",
      order: 4,
      roleKeys: [
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
    },
    {
      id: "agent-universal-exhaustive",
      name: "Universal audit exhaustive agent",
      description: "Full universal audit bundle with fix-readiness output for deep repository and browser analysis.",
      order: 5,
      roleKeys: [
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
        "fix-readiness-emitter",
        "release-gate-scorer",
        "standardized-json-output",
      ],
    },
    {
      id: "agent-remediation-planner",
      name: "Remediation planner agent",
      description: "Focused follow-up bundle that groups findings into remediation packs and release guidance.",
      order: 6,
      roleKeys: ["remediation-planner", "release-gate-scorer", "standardized-json-output"],
    },
    {
      id: "agent-fix-readiness",
      name: "Fix readiness agent",
      description: "Focused handoff bundle that prepares implementation-ready downstream fix guidance.",
      order: 7,
      roleKeys: ["remediation-planner", "fix-readiness-emitter", "release-gate-scorer", "standardized-json-output"],
    },
  ] as const;

  try {
    await prisma.$transaction(async tx => {
      const skillRecords = new Map<string, string>();
      for (const skill of skillSpecs) {
        const record = await tx.aiSkill.upsert({
          where: { id: skill.id },
          update: {
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            toolCapabilitiesJson: skill.toolCapabilities,
            order: skill.order,
          },
          create: {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            toolCapabilitiesJson: skill.toolCapabilities,
            order: skill.order,
          },
        });
        skillRecords.set(skill.key, record.id);
      }

      const roleRecords = new Map<string, string>();
      for (const role of roleSpecs) {
        const roleUpdateData: Prisma.AiRoleUncheckedUpdateInput = {
          name: role.name,
          description: role.description,
          prompt: role.prompt,
          order: role.order,
          consoleVisibility: "consoleVisibility" in role ? role.consoleVisibility : "normal",
          executorKind: "executorKind" in role ? role.executorKind : "codex",
          nativeExecutorId: "nativeExecutorId" in role ? role.nativeExecutorId ?? null : null,
        };
        const roleCreateData: Prisma.AiRoleUncheckedCreateInput = {
          id: role.id,
          name: role.name,
          description: role.description,
          prompt: role.prompt,
          order: role.order,
          consoleVisibility: "consoleVisibility" in role ? role.consoleVisibility : "normal",
          executorKind: "executorKind" in role ? role.executorKind : "codex",
          nativeExecutorId: "nativeExecutorId" in role ? role.nativeExecutorId ?? null : null,
        };
        const record = await tx.aiRole.upsert({
          where: { id: role.id },
          update: roleUpdateData,
          create: roleCreateData,
        });
        roleRecords.set(role.key, record.id);
        await tx.aiRoleSkill.deleteMany({ where: { roleId: record.id } });
        await tx.aiRoleDependency.deleteMany({ where: { roleId: record.id } });
        if (role.skillKeys.length > 0) {
          await tx.aiRoleSkill.createMany({
            data: role.skillKeys.map((skillKey, index) => {
              const skillId = skillRecords.get(skillKey);
              if (!skillId) {
                throw new Error(`Missing AI skill seed for ${skillKey}.`);
              }
              return {
                roleId: record.id,
                skillId,
                order: index,
              };
            }),
            skipDuplicates: true,
          });
        }
        const dependencyKeys = "dependencyKeys" in role ? role.dependencyKeys : [];
        if (dependencyKeys.length > 0) {
          await tx.aiRoleDependency.createMany({
            data: dependencyKeys.map((dependencyKey, index) => {
              const dependsOnRoleId = roleRecords.get(dependencyKey);
              if (!dependsOnRoleId) {
                throw new Error(`Missing AI role dependency seed for ${dependencyKey}.`);
              }
              return {
                roleId: record.id,
                dependsOnRoleId,
                order: index,
              };
            }),
            skipDuplicates: true,
          });
        }
      }

      for (const agentSpec of agentSpecs) {
        const agent = await tx.aiAgent.upsert({
          where: { id: agentSpec.id },
          update: {
            name: agentSpec.name,
            description: agentSpec.description,
            order: agentSpec.order,
          },
          create: {
            id: agentSpec.id,
            name: agentSpec.name,
            description: agentSpec.description,
            order: agentSpec.order,
          },
        });

        await tx.aiAgentRole.deleteMany({ where: { agentId: agent.id } });
        await tx.aiAgentRole.createMany({
          data: agentSpec.roleKeys.map((roleKey, index) => {
            const roleId = roleRecords.get(roleKey);
            if (!roleId) {
              throw new Error(`Missing AI role seed for ${roleKey}.`);
            }
            return {
              agentId: agent.id,
              roleId,
              order: index,
            };
          }),
          skipDuplicates: true,
        });
      }
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return;
    }
    throw error;
  }
}

async function importLegacySnapshotIfNeeded(): Promise<void> {
  const prisma = getPrismaClient();
  const workspaceCount = await prisma.workspace.count();
  if (workspaceCount > 0) {
    return;
  }

  const snapshotPath = getStatePath();
  if (!fs.existsSync(snapshotPath)) {
    return;
  }

  const payload = readLegacyPersistedState(snapshotPath);
  if (!payload) {
    return;
  }
  const secretValues = new Map(payload.secretValues.map(([workspaceId, values]) => [
    workspaceId,
    new Map(values.map(([secretId, value]) => [secretId, decryptSecretValue(value)])),
  ]));
  const users = payload.users.map(([, user]) => user);
  const workspaces = payload.workspaces.map(([, workspace]) => workspace);
  const memberships = payload.memberships.flatMap(([, items]) => items);
  const sources = payload.sources.flatMap(([, items]) => items).map(source => ({
    ...source,
    type: requirePersistedHostedSourceType(source.type, `historical snapshot source ${source.id}`),
  }));
  const secrets = payload.secrets.flatMap(([workspaceId, items]) => {
    const valueMap = secretValues.get(workspaceId) ?? new Map<string, string>();
    return items.map(secret => ({
      id: secret.id,
      workspaceId: secret.workspaceId,
      name: secret.name,
      kind: secret.kind,
      valuePreview: secret.valuePreview,
      encryptedValue: encryptSecretValue(valueMap.get(secret.id) ?? ""),
      createdAt: new Date(secret.createdAt),
      updatedAt: new Date(secret.updatedAt),
    }));
  });
  const subscriptions = payload.subscriptions.map(([, subscription]) => subscription);
  const installations = payload.githubInstallations.flatMap(([, items]) => items);
  const checkoutSessions = payload.checkoutSessions.map(([, session]) => session);
  const jobs = payload.jobs.map(([, envelope]) => ({
    ...envelope.job,
    sourceType: requirePersistedHostedSourceType(envelope.job.sourceType, `historical snapshot job ${envelope.job.id} primary source`),
    companionSourceType: envelope.job.companionSourceType
      ? requirePersistedHostedSourceType(envelope.job.companionSourceType, `historical snapshot job ${envelope.job.id} companion source`)
      : null,
  }));
  const logs = payload.jobs.flatMap(([, envelope]) => envelope.logs);
  const reports = payload.jobs.flatMap(([, envelope]) => envelope.report ? [envelope.report] : []);
  const artifacts = reports.flatMap(report => report.artifacts.map(artifact => ({
    jobId: report.jobId,
    reportId: report.id,
    kind: artifact.kind ?? "artifact",
    artifact,
  })));

  await prisma.$transaction([
    prisma.artifactReference.deleteMany(),
    prisma.analysisReport.deleteMany(),
    prisma.analysisJobLog.deleteMany(),
    prisma.analysisJob.deleteMany(),
    prisma.workspaceSecret.deleteMany(),
    prisma.githubInstallation.deleteMany(),
    prisma.billingSubscription.deleteMany(),
    prisma.checkoutSession.deleteMany(),
    prisma.source.deleteMany(),
    prisma.workspaceMembership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  if (users.length > 0) {
    await prisma.user.createMany({
      data: users.map(user => ({
        id: user.id,
        identityProvider: user.identityProvider,
        identitySubject: user.identitySubject,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        entitlement: user.entitlement,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      })),
    });
  }

  if (workspaces.length > 0) {
    await prisma.workspace.createMany({
      data: workspaces.map(workspace => ({
        id: workspace.id,
        ownerUserId: workspace.ownerUserId,
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
        entitlement: workspace.entitlement,
        createdAt: new Date(workspace.createdAt),
        updatedAt: new Date(workspace.updatedAt),
      })),
    });
  }

  if (memberships.length > 0) {
    await prisma.workspaceMembership.createMany({
      data: memberships.map(membership => ({
        id: membership.id,
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        role: membership.role,
        createdAt: new Date(membership.createdAt),
      })),
    });
  }

  if (sources.length > 0) {
    await prisma.source.createMany({
      data: sources.map(source => ({
        id: source.id,
        workspaceId: source.workspaceId,
        type: source.type,
        displayName: source.displayName,
        location: source.location,
        visibility: source.visibility,
        githubInstallationId: source.githubInstallationId,
        uploadObjectKey: source.uploadObjectKey,
        createdAt: new Date(source.createdAt),
      })),
    });
  }

  if (secrets.length > 0) {
    await prisma.workspaceSecret.createMany({ data: secrets });
  }

  if (subscriptions.length > 0) {
    await prisma.billingSubscription.createMany({
      data: subscriptions.map(subscription => ({
        id: subscription.id,
        userId: subscription.userId,
        provider: subscription.provider,
        providerCustomerId: subscription.providerCustomerId,
        providerSubscriptionId: subscription.providerSubscriptionId,
        entitlement: subscription.entitlement,
        status: subscription.status,
        createdAt: new Date(subscription.createdAt),
        updatedAt: new Date(subscription.updatedAt),
      })),
    });
  }

  if (installations.length > 0) {
    await prisma.githubInstallation.createMany({
      data: installations.map(installation => ({
        id: installation.id,
        workspaceId: installation.workspaceId,
        githubInstallationId: installation.githubInstallationId,
        githubAccountLogin: installation.githubAccountLogin,
        createdAt: new Date(installation.createdAt),
      })),
    });
  }

  if (checkoutSessions.length > 0) {
    await prisma.checkoutSession.createMany({
      data: checkoutSessions.map(session => ({
        id: session.id,
        workspaceId: session.workspaceId,
        userId: session.userId,
        entitlement: session.entitlement,
        checkoutUrl: session.checkoutUrl,
        status: session.status,
        createdAt: new Date(session.createdAt),
      })),
    });
  }

  if (jobs.length > 0) {
    await prisma.analysisJob.createMany({
      data: jobs.map(job => ({
        id: job.id,
        workspaceId: job.workspaceId,
        sourceId: job.sourceId,
        companionSourceId: job.companionSourceId ?? null,
        reportId: job.reportId,
        status: job.status,
        agentId: job.agentId ?? null,
        queueMessageId: job.queueMessageId ?? null,
        claimedRunnerId: job.claimedRunnerId ?? null,
        cancelRequestedAt: asTimestamp(job.cancelRequestedAt),
        failureReason: job.failureReason ?? null,
        sourceType: job.sourceType,
        sourceLocation: job.sourceLocation,
        companionSourceType: job.companionSourceType ?? null,
        companionSourceLocation: job.companionSourceLocation ?? null,
        rolesJson: job.roles as Prisma.InputJsonValue,
        runtimeMode: job.runtimeMode,
        secretRefsJson: job.secretRefs as Prisma.InputJsonValue,
        requestedByUserId: job.requestedByUserId,
        startedAt: asTimestamp(job.startedAt),
        finishedAt: asTimestamp(job.finishedAt),
        createdAt: new Date(job.createdAt),
      })),
    });
  }

  if (logs.length > 0) {
    await prisma.analysisJobLog.createMany({
      data: logs.map(log => ({
        id: log.id,
        jobId: log.jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility ?? "default",
        createdAt: new Date(log.createdAt),
      })),
    });
  }

  if (reports.length > 0) {
    await prisma.analysisReport.createMany({
      data: reports.map(report => ({
        id: report.id,
        workspaceId: report.workspaceId,
        jobId: report.jobId,
        status: report.status,
        rolesJson: report.roles as Prisma.InputJsonValue,
        runtimeMode: report.runtimeMode,
        title: report.title,
        summaryJson: report.summary as Prisma.InputJsonValue,
        findingsJson: report.findings as Prisma.InputJsonValue,
        sectionsJson: report.sections as Prisma.InputJsonValue,
        createdAt: new Date(report.createdAt),
      })),
    });
  }

  if (artifacts.length > 0) {
    await prisma.artifactReference.createMany({
      data: artifacts.map(({ jobId, reportId, kind, artifact }) => ({
        id: artifact.id ?? createId("artifact"),
        jobId,
        reportId,
        kind,
        objectKey: artifact.key,
        bucket: artifact.bucket,
        region: artifact.region,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        signedUrl: artifact.signedUrl ?? null,
        createdAt: asTimestamp(artifact.createdAt) ?? new Date(),
      })),
    });
  }
}

export async function upsertUserIdentity(identity: {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
}): Promise<User> {
  const prisma = getPrismaClient();
  const record = await prisma.$transaction(async tx => {
    const existingByIdentity = await tx.user.findUnique({
      where: {
        identityProvider_identitySubject: {
          identityProvider: identity.provider,
          identitySubject: identity.subject,
        },
      },
    });
    if (existingByIdentity) {
      return await tx.user.update({
        where: { id: existingByIdentity.id },
        data: {
          email: identity.email,
          displayName: identity.displayName,
          updatedAt: new Date(),
        },
      });
    }

    const existingByEmail = await tx.user.findUnique({
      where: { email: identity.email },
    });
    if (existingByEmail) {
      return await tx.user.update({
        where: { id: existingByEmail.id },
        data: {
          identityProvider: identity.provider,
          identitySubject: identity.subject,
          displayName: identity.displayName,
          updatedAt: new Date(),
        },
      });
    }

    return await tx.user.create({
      data: {
        id: createId("user"),
        identityProvider: identity.provider,
        identitySubject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
        entitlement: "free",
      },
    });
  });
  return mapUserRecord(record);
}

export async function getUserById(userId: string): Promise<User | null> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? mapUserRecord(user) : null;
}

export async function listWorkspaceSummariesForUser(userId: string): Promise<Array<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
}>> {
  const prisma = getPrismaClient();
  const workspaces = await prisma.workspace.findMany({
    where: {
      OR: [
        { ownerUserId: userId },
        { memberships: { some: { userId } } },
      ],
    },
    include: {
      memberships: {
        include: {
          user: {
            select: {
              email: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
      sources: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return workspaces.map(workspace => ({
    workspace: mapWorkspaceRecord(workspace),
    members: workspace.memberships.map(mapMemberSummaryRecord),
    sources: workspace.sources.filter(isActiveHostedSourceRecord).map(mapSourceRecord),
  }));
}

export async function listWorkspaceSummariesPageForUser(
  userId: string,
  options: {
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResult<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
}>> {
  const prisma = getPrismaClient();
  const page = normalizePageNumber(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const q = options.q?.trim() ?? "";
  const where: Prisma.WorkspaceWhereInput = {
    OR: [
      { ownerUserId: userId },
      { memberships: { some: { userId } } },
    ],
    ...(q
      ? {
        AND: [
          {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { memberships: { some: { user: { email: { contains: q, mode: "insensitive" } } } } },
              { memberships: { some: { user: { displayName: { contains: q, mode: "insensitive" } } } } },
              { sources: { some: { displayName: { contains: q, mode: "insensitive" } } } },
              { sources: { some: { location: { contains: q, mode: "insensitive" } } } },
            ],
          },
        ],
      }
      : {}),
  };
  const [total, workspaces] = await prisma.$transaction([
    prisma.workspace.count({ where }),
    prisma.workspace.findMany({
      where,
      include: {
        memberships: {
          include: {
            user: {
              select: {
                email: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        sources: true,
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: workspaces.map(workspace => ({
      workspace: mapWorkspaceRecord(workspace),
      members: workspace.memberships.map(mapMemberSummaryRecord),
      sources: workspace.sources.filter(isActiveHostedSourceRecord).map(mapSourceRecord),
    })),
    pageInfo: buildPageInfo(total, page, pageSize),
  };
}

export async function getWorkspaceDetailForUser(workspaceId: string, userId: string): Promise<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
  installations: GithubInstallation[];
  jobs: JobEnvelope[];
}> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      memberships: {
        include: {
          user: {
            select: {
              email: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
      sources: true,
      installations: true,
    },
  });
  const jobs = await prisma.analysisJob.findMany({
    where: { workspaceId },
    include: {
      logs: { orderBy: logOrderBy },
      report: {
        include: {
          artifacts: { orderBy: artifactOrderBy },
        },
      },
      artifacts: { orderBy: artifactOrderBy },
      source: true,
      companionSource: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    workspace: mapWorkspaceRecord(workspace),
    members: workspace.memberships.map(mapMemberSummaryRecord),
    sources: workspace.sources.filter(isActiveHostedSourceRecord).map(mapSourceRecord),
    installations: workspace.installations.map(mapInstallationRecord),
    jobs: jobs
      .filter(isActiveHostedJobRecord)
      .map(buildJobEnvelope),
  };
}

export async function getWorkspaceConsoleForUser(workspaceId: string, userId: string): Promise<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
  installations: GithubInstallation[];
  jobs: WorkspaceConsoleJob[];
  stats: WorkspaceConsoleStats;
}> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      memberships: {
        include: {
          user: {
            select: {
              email: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
      sources: true,
      installations: true,
    },
  });
  const workspaceJobsWhere = activeHostedJobWhere({ workspaceId });
  const [
    totalJobs,
    activeJobs,
    completedJobs,
    reportBackedJobs,
    sourceRowsWithReports,
    recentJobs,
  ] = await prisma.$transaction([
    prisma.analysisJob.count({ where: workspaceJobsWhere }),
    prisma.analysisJob.count({
      where: activeHostedJobWhere({
        workspaceId,
        status: { in: ["pending", "queued", "running"] },
      }),
    }),
    prisma.analysisJob.count({
      where: activeHostedJobWhere({
        workspaceId,
        status: "succeeded",
      }),
    }),
    prisma.analysisJob.count({
      where: activeHostedJobWhere({
        workspaceId,
        report: { isNot: null },
      }),
    }),
    prisma.analysisJob.findMany({
      where: activeHostedJobWhere({
        workspaceId,
        report: { isNot: null },
      }),
      distinct: ["sourceId"],
      select: { sourceId: true },
    }),
    prisma.analysisJob.findMany({
      where: workspaceJobsWhere,
      include: jobSummaryInclude,
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ]);
  return {
    workspace: mapWorkspaceRecord(workspace),
    members: workspace.memberships.map(mapMemberSummaryRecord),
    sources: workspace.sources.filter(isActiveHostedSourceRecord).map(mapSourceRecord),
    installations: workspace.installations.map(mapInstallationRecord),
    jobs: recentJobs.map(buildWorkspaceConsoleJob),
    stats: {
      totalJobs,
      activeJobs,
      completedJobs,
      reportBackedJobs,
      sourcesWithReports: sourceRowsWithReports.length,
    },
  };
}

export async function createWorkspaceForUser(owner: User, input: CreateWorkspaceInput): Promise<Workspace> {
  const prisma = getPrismaClient();
  const slug = await nextWorkspaceSlug(input.name);
  const workspace = await prisma.workspace.create({
    data: {
      id: createId("workspace"),
      ownerUserId: owner.id,
      name: input.name,
      slug,
      description: input.description ?? null,
      entitlement: owner.entitlement,
      memberships: {
        create: {
          id: createId("membership"),
          userId: owner.id,
          role: "owner",
        },
      },
    },
  });
  return mapWorkspaceRecord(workspace);
}

export async function listWorkspaceMembersForUser(workspaceId: string, userId: string): Promise<WorkspaceMemberSummary[]> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const members = await prisma.workspaceMembership.findMany({
    where: { workspaceId },
    include: {
      user: {
        select: {
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return members.map(mapMemberSummaryRecord);
}

export async function listWorkspaceMembersPageForUser(
  workspaceId: string,
  userId: string,
  options: {
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResult<WorkspaceMemberSummary>> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const page = normalizePageNumber(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const q = options.q?.trim() ?? "";
  const where: Prisma.WorkspaceMembershipWhereInput = {
    workspaceId,
    ...(q
      ? {
          OR: [
            { role: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
            { user: { displayName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, members] = await Promise.all([
    prisma.workspaceMembership.count({ where }),
    prisma.workspaceMembership.findMany({
      where,
      include: {
        user: {
          select: {
            email: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [
        { role: "asc" },
        { createdAt: "asc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: members.map(mapMemberSummaryRecord),
    pageInfo: buildPageInfo(total, page, pageSize),
  };
}

export async function addWorkspaceMember(
  workspaceId: string,
  actorUserId: string,
  input: CreateWorkspaceMemberInput,
): Promise<WorkspaceMemberSummary> {
  await requireWorkspaceRole(workspaceId, actorUserId, "owner");
  const prisma = getPrismaClient();
  const targetUser = await prisma.user.findUnique({
    where: {
      email: input.email.trim().toLowerCase(),
    },
    select: {
      id: true,
    },
  });
  if (!targetUser) {
    throw statusError(404, `No existing user was found for ${input.email}. Ask them to sign in first.`);
  }
  const existing = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: targetUser.id,
      },
    },
    include: {
      user: {
        select: {
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });
  if (existing) {
    return mapMemberSummaryRecord(existing);
  }
  const membership = await prisma.workspaceMembership.create({
    data: {
      id: createId("membership"),
      workspaceId,
      userId: targetUser.id,
      role: "member",
    },
    include: {
      user: {
        select: {
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });
  return mapMemberSummaryRecord(membership);
}

export async function removeWorkspaceMember(
  workspaceId: string,
  actorUserId: string,
  membershipId: string,
): Promise<{ removedMembershipId: string }> {
  const workspace = await requireWorkspaceRole(workspaceId, actorUserId, "owner");
  const prisma = getPrismaClient();
  const membership = await prisma.workspaceMembership.findUnique({
    where: { id: membershipId },
  });
  if (!membership || membership.workspaceId !== workspaceId) {
    throw statusError(404, `Workspace member not found: ${membershipId}`);
  }
  if (membership.userId === workspace.ownerUserId || membership.role === "owner") {
    throw statusError(400, "The workspace owner cannot be removed.");
  }
  await prisma.workspaceMembership.delete({
    where: { id: membershipId },
  });
  return {
    removedMembershipId: membershipId,
  };
}

export async function listWorkspaceSecretsForUser(workspaceId: string, userId: string): Promise<WorkspaceSecret[]> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const secrets = await prisma.workspaceSecret.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  return secrets.map(mapSecretRecord);
}

export async function listWorkspaceSecretsPageForUser(
  workspaceId: string,
  userId: string,
  options: {
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResult<WorkspaceSecret>> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const page = normalizePageNumber(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const q = options.q?.trim() ?? "";
  const where: Prisma.WorkspaceSecretWhereInput = {
    workspaceId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { kind: { contains: q, mode: "insensitive" } },
            { valuePreview: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, secrets] = await Promise.all([
    prisma.workspaceSecret.count({ where }),
    prisma.workspaceSecret.findMany({
      where,
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: secrets.map(mapSecretRecord),
    pageInfo: buildPageInfo(total, page, pageSize),
  };
}

export async function createWorkspaceSecretForUser(
  workspaceId: string,
  userId: string,
  input: CreateWorkspaceSecretInput,
): Promise<WorkspaceSecret> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const secret = await prisma.workspaceSecret.create({
    data: {
      id: createId("secret"),
      workspaceId,
      name: input.name,
      kind: input.kind,
      valuePreview: buildWorkspaceSecretPreview(input.kind),
      encryptedValue: encryptSecretValue(input.value),
    },
  });
  return mapSecretRecord(secret);
}

export async function updateWorkspaceSecretForUser(
  workspaceId: string,
  userId: string,
  secretId: string,
  input: UpdateWorkspaceSecretInput,
): Promise<WorkspaceSecret> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const secret = await prisma.workspaceSecret.findUnique({
    where: { id: secretId },
  });
  if (!secret || secret.workspaceId !== workspaceId) {
    throw statusError(404, `Workspace secret not found: ${secretId}`);
  }
  const updated = await prisma.workspaceSecret.update({
    where: { id: secretId },
    data: {
      name: input.name,
      kind: input.kind,
      valuePreview: buildWorkspaceSecretPreview(input.kind),
      encryptedValue: encryptSecretValue(input.value),
    },
  });
  return mapSecretRecord(updated);
}

export async function deleteWorkspaceSecretForUser(
  workspaceId: string,
  userId: string,
  secretId: string,
): Promise<{ removedSecretId: string }> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const secret = await prisma.workspaceSecret.findUnique({
    where: { id: secretId },
  });
  if (!secret || secret.workspaceId !== workspaceId) {
    throw statusError(404, `Workspace secret not found: ${secretId}`);
  }
  await prisma.workspaceSecret.delete({
    where: { id: secretId },
  });
  return {
    removedSecretId: secretId,
  };
}

export async function resolveWorkspaceSecrets(workspaceId: string, secretRefs: string[]): Promise<ResolvedWorkspaceSecret[]> {
  if (secretRefs.length === 0) {
    return [];
  }
  const prisma = getPrismaClient();
  const secrets = await prisma.workspaceSecret.findMany({
    where: {
      workspaceId,
      id: { in: secretRefs },
    },
  });
  const ordered = new Map(secrets.map(secret => [secret.id, secret]));
  return secretRefs.flatMap(secretId => {
    const secret = ordered.get(secretId);
    if (!secret) {
      return [];
    }
    return [{
      id: secret.id,
      kind: secret.kind as WorkspaceSecret["kind"],
      value: decryptSecretValue(secret.encryptedValue),
      name: secret.name,
    }];
  });
}

export async function listWorkspaceSourcesForUser(workspaceId: string, userId: string): Promise<Source[]> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const sources = await prisma.source.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  return sources.filter(isActiveHostedSourceRecord).map(mapSourceRecord);
}

export async function listWorkspaceSourcesPageForUser(
  workspaceId: string,
  userId: string,
  options: {
    q?: string;
    type?: Source["type"] | null;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResult<Source>> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const page = normalizePageNumber(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const q = options.q?.trim() ?? "";
  const where: Prisma.SourceWhereInput = {
    workspaceId,
    ...(options.type ? { type: options.type } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
            { verificationStatus: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, sources] = await Promise.all([
    prisma.source.count({ where }),
    prisma.source.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: sources.filter(isActiveHostedSourceRecord).map(mapSourceRecord),
    pageInfo: buildPageInfo(total, page, pageSize),
  };
}

export async function listSourceLearnablesForUser(
  workspaceId: string,
  sourceId: string,
  userId: string,
): Promise<Learnable[]> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      workspaceId,
    },
  });
  if (!source) {
    throw statusError(404, `Source not found: ${sourceId}`);
  }
  const learnables = await prisma.sourceLearnable.findMany({
    where: {
      workspaceId,
      sourceId,
      active: true,
    },
    orderBy: [
      { order: "asc" },
      { createdAt: "asc" },
    ],
  });
  return learnables.map(mapLearnableRecord);
}

export async function listActiveSourceLearnables(sourceId: string): Promise<Learnable[]> {
  const prisma = getPrismaClient();
  const learnables = await prisma.sourceLearnable.findMany({
    where: {
      sourceId,
      active: true,
    },
    orderBy: [
      { order: "asc" },
      { createdAt: "asc" },
    ],
  });
  return learnables.map(mapLearnableRecord);
}

export async function replaceSourceLearnables(
  workspaceId: string,
  sourceId: string,
  learnedFromJobId: string,
  learnables: Array<{
    statement: string;
    category: Learnable["category"];
    evidence?: string[];
    order?: number;
  }>,
): Promise<Learnable[]> {
  const prisma = getPrismaClient();
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      workspaceId,
    },
  });
  if (!source) {
    throw statusError(404, `Source not found: ${sourceId}`);
  }

  await prisma.$transaction(async tx => {
    await tx.sourceLearnable.updateMany({
      where: {
        workspaceId,
        sourceId,
        active: true,
      },
      data: {
        active: false,
      },
    });

    if (learnables.length === 0) {
      return;
    }

    await tx.sourceLearnable.createMany({
      data: learnables.map((learnable, index) => ({
        id: createId("learnable"),
        workspaceId,
        sourceId,
        learnedFromJobId,
        statement: learnable.statement,
        category: learnable.category,
        evidenceJson: learnable.evidence ?? [],
        order: learnable.order ?? index,
        active: true,
      })),
    });
  });

  return listActiveSourceLearnables(sourceId);
}

export async function createSourceForUser(
  workspaceId: string,
  userId: string,
  input: AddSourceInput,
): Promise<Source> {
  return await createSourceForUserInternal(workspaceId, userId, input, { allowFileTransport: false });
}

async function createSourceForUserInternal(
  workspaceId: string,
  userId: string,
  input: AddSourceInput,
  options: { allowFileTransport: boolean },
): Promise<Source> {
  const workspace = await requireWorkspaceRole(workspaceId, userId, "owner");
  if (input.type === "github-private" && workspace.entitlement === "free") {
    throw statusError(403, "Pro entitlement is required for private repositories.");
  }
  await assertHostedGitLocation(input.type, input.location, {
    allowFileTransport: options.allowFileTransport,
  });
  const prisma = getPrismaClient();
  const installations = input.type === "github-private"
    ? await prisma.githubInstallation.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const selectedInstallation = input.type === "github-private"
    ? selectInstallationForGithubRepo(installations.map(installation => ({
        githubInstallationId: installation.githubInstallationId,
        githubAccountLogin: installation.githubAccountLogin,
      })), input.location, input.githubInstallationId ?? null)
    : null;
  if (input.type === "github-private" && !selectedInstallation) {
    throw statusError(403, "Connect a matching GitHub App installation before adding a private GitHub repository source.");
  }
  if (input.type === "github-private" && selectedInstallation) {
    await verifyHostedGithubPrivateLocation(input.location, selectedInstallation.githubInstallationId);
  }
  const visibility = input.type === "github-private" ? "private" : "public";
  const source = await prisma.source.create({
    data: {
      id: createId("source"),
      workspaceId,
      type: input.type,
      displayName: input.displayName,
      location: input.location,
      visibility,
      verificationStatus: input.type === "git-public" ? "pending" : "verified",
      verificationError: null,
      githubInstallationId: selectedInstallation?.githubInstallationId ?? null,
      uploadObjectKey: null,
    },
  });
  return mapSourceRecord(source);
}

export async function verifySourceForUser(sourceId: string): Promise<Source> {
  const prisma = getPrismaClient();
  const current = await prisma.source.findUnique({
    where: { id: sourceId },
  });
  if (!current || !isActiveHostedSourceRecord(current)) {
    throw statusError(404, `Source not found: ${sourceId}`);
  }

  const sourceType = requirePersistedHostedSourceType(current.type, `source ${sourceId}`);
  if (sourceType === "upload-archive") {
    return mapSourceRecord(current);
  }

  await setSourceVerificationState(sourceId, "pending", null);
  try {
    if (sourceType === "git-public") {
      await verifyHostedPublicGitLocation(current.location);
    } else {
      const installationId = current.githubInstallationId;
      if (!installationId) {
        throw statusError(400, `Reconnect the GitHub App installation for ${current.displayName} before verifying this source.`);
      }
      const linkedInstallation = await prisma.githubInstallation.findFirst({
        where: {
          workspaceId: current.workspaceId,
          githubInstallationId: installationId,
        },
        select: { id: true },
      });
      if (!linkedInstallation) {
        throw statusError(
          400,
          `The linked GitHub App installation for ${current.displayName} is no longer attached to this workspace. Reconnect it in workspace settings, then retry verification.`,
        );
      }
      await verifyHostedGithubPrivateLocation(current.location, installationId);
    }
    await setSourceVerificationState(sourceId, "verified", null);
  } catch (error) {
    await setSourceVerificationState(sourceId, "failed", verificationErrorMessage(error));
    throw error;
  }

  const verified = await prisma.source.findUnique({
    where: { id: sourceId },
  });
  if (!verified || !isActiveHostedSourceRecord(verified)) {
    throw statusError(404, `Source not found after verification: ${sourceId}`);
  }
  return mapSourceRecord(verified);
}

export async function createUploadSourceForUser(
  workspaceId: string,
  userId: string,
  input: {
    displayName: string;
    location: string;
    uploadObjectKey: string;
  },
): Promise<Source> {
  const workspace = await requireWorkspaceRole(workspaceId, userId, "owner");
  if (workspace.entitlement === "free") {
    throw statusError(403, "Pro entitlement is required for Git repository archive uploads.");
  }
  const prisma = getPrismaClient();
  const source = await prisma.source.create({
    data: {
      id: createId("source"),
      workspaceId,
      type: "upload-archive",
      displayName: input.displayName,
      location: input.location,
      visibility: "private",
      verificationStatus: "verified",
      verificationError: null,
      uploadObjectKey: input.uploadObjectKey,
    },
  });
  return mapSourceRecord(source);
}

export async function updateSourceForUser(
  workspaceId: string,
  userId: string,
  sourceId: string,
  input: UpdateSourceInput,
): Promise<Source> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      workspaceId,
    },
  });
  if (!source || !isActiveHostedSourceRecord(source)) {
    throw statusError(404, `Source not found: ${sourceId}`);
  }
  const updated = await prisma.source.update({
    where: { id: sourceId },
    data: {
      displayName: input.displayName,
    },
  });
  return mapSourceRecord(updated);
}

export async function deleteSourceForUser(
  workspaceId: string,
  userId: string,
  sourceId: string,
  config: ObjectStorageConfig,
): Promise<{ removedSourceId: string }> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      workspaceId,
    },
  });
  if (!source || !isActiveHostedSourceRecord(source)) {
    throw statusError(404, `Source not found: ${sourceId}`);
  }
  const referencedJobCount = await prisma.analysisJob.count({
    where: {
      OR: [
        { sourceId },
        { companionSourceId: sourceId },
      ],
    },
  });
  if (referencedJobCount > 0) {
    throw statusError(409, "This source is retained for historical job and report provenance and cannot be removed.");
  }
  if (source.uploadObjectKey) {
    await deleteObject(config, source.uploadObjectKey);
  }
  await prisma.source.delete({
    where: { id: sourceId },
  });
  return {
    removedSourceId: sourceId,
  };
}

export async function findSourceForExecution(sourceId: string): Promise<Source | null> {
  const prisma = getPrismaClient();
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  return source && isActiveHostedSourceRecord(source) ? mapSourceRecord(source) : null;
}

export async function createAnalysisJobForUser(
  workspaceId: string,
  userId: string,
  input: CreateAnalysisJobInput,
  options: { requestId?: string; agentId?: string } = {},
): Promise<JobEnvelope> {
  const { role } = await getAccessibleWorkspaceRecord(workspaceId, userId);
  if ((input.secretRefs?.length ?? 0) > 0 && role !== "owner") {
    throw statusError(403, "Workspace owner access is required to attach workspace secrets to analysis jobs.");
  }
  const prisma = getPrismaClient();
  const source = await prisma.source.findFirst({
    where: {
      id: input.sourceId,
      workspaceId,
    },
  });
  if (!source) {
    throw statusError(404, `Source not found: ${input.sourceId}`);
  }
  assertHostedSourceReady(source, "analysis");
  const companionSource = input.companionSourceId
    ? await prisma.source.findFirst({
        where: {
          id: input.companionSourceId,
          workspaceId,
        },
      })
    : null;
  if (input.companionSourceId && !companionSource) {
    throw statusError(404, `Companion source not found: ${input.companionSourceId}`);
  }
  if (companionSource) {
    assertHostedSourceReady(companionSource, "analysis");
  }
  if (companionSource && companionSource.id === source.id) {
    throw statusError(400, "Companion source must be different from the primary source.");
  }
  const jobId = createId("job");
  const requestedRoles = input.roles ?? [];
  const runtimeMode = input.runtimeMode ?? (
    requestedRoles.some(role =>
      role === "browser-self-check"
      || role === "visual-inspection"
      || role === "interaction-test")
      ? "browser"
      : "static"
  );
  const resolvedAgentId = options.agentId
    ?? input.agentId
    ?? resolveDefaultAgentIdForRequest(requestedRoles, runtimeMode);
  const roles = requestedRoles.length > 0
    ? requestedRoles
    : (await getAiAgentExecutionPlan(resolvedAgentId)).roles.map(role => role.id);
  const codexAuthBinding = await resolveCodexAuthBindingForJob(workspaceId, userId, input.codexAuthScope ?? null);
  const logs = [
    createLog(
      jobId,
      "queue",
      `Job accepted and pending durable queue dispatch via unified agent ${resolvedAgentId}.`,
      "info",
      options.requestId,
    ),
  ];
  await prisma.$transaction([
    prisma.analysisJob.create({
      data: {
        id: jobId,
        workspaceId,
        sourceId: source.id,
        companionSourceId: companionSource?.id ?? null,
        parentReportId: null,
        jobKind: "audit",
        status: "pending",
        agentId: resolvedAgentId,
        sourceType: source.type,
        sourceLocation: source.location,
        companionSourceType: companionSource?.type ?? null,
        companionSourceLocation: companionSource?.location ?? null,
        rolesJson: roles,
        metadataJson: codexAuthBinding
          ? ({ codexAuth: codexAuthBinding } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        runtimeMode,
        secretRefsJson: input.secretRefs ?? [],
        requestedByUserId: userId,
      },
    }),
    prisma.analysisJobLog.createMany({
      data: logs.map(log => ({
        id: log.id,
        jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility,
        requestId: log.requestId ?? null,
        createdAt: new Date(log.createdAt),
      })),
    }),
  ]);
  return await getJobEnvelopeById(jobId);
}

export async function createAgentJobForUser(
  workspaceId: string,
  userId: string,
  agentId: string,
  input: CreateAgentJobInput,
  options: { requestId?: string } = {},
): Promise<JobEnvelope> {
  assertAllowedHostedAgentId(agentId);
  const plan = await getAiAgentExecutionPlan(agentId);
  const roleIds = plan.roles.map(role => role.id);
  return createAnalysisJobForUser(
    workspaceId,
    userId,
    {
      sourceId: input.sourceId,
      companionSourceId: input.companionSourceId,
      agentId,
      roles: roleIds,
      runtimeMode: input.runtimeMode,
      codexAuthScope: input.codexAuthScope,
      secretRefs: input.secretRefs,
    },
    {
      ...(options.requestId != null ? { requestId: options.requestId } : {}),
      agentId,
    },
  );
}

export async function createRemediationJobForUser(
  reportId: string,
  userId: string,
  input: CreateRemediationTaskInput,
  options: {
    requestId?: string;
  } = {},
): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  const report = await prisma.analysisReport.findFirst({
    where: {
      id: reportId,
      OR: [
        { workspace: { ownerUserId: userId } },
        { workspace: { memberships: { some: { userId } } } },
      ],
    },
    include: { job: true },
  });
  if (!report) {
    throw statusError(404, `Report not found: ${reportId}`);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: report.workspaceId },
    include: { memberships: true },
  });
  if (!workspace) {
    throw statusError(404, `Workspace not found for report ${reportId}.`);
  }
  const role = buildRoleFromWorkspace(workspace, userId);
  if (role !== "owner") {
    throw statusError(403, "Workspace owner access is required for remediation jobs.");
  }

  const primarySource = await prisma.source.findUnique({
    where: { id: report.job.sourceId },
  });
  const companionSource = report.job.companionSourceId
    ? await prisma.source.findUnique({
        where: { id: report.job.companionSourceId },
      })
    : null;
  const candidateSources = [primarySource, companionSource].filter(Boolean) as NonNullable<typeof primarySource>[];
  const selectedSource = candidateSources.find(source => source.id === input.sourceId);
  if (!selectedSource) {
    throw statusError(400, "Remediation source must be one of the report job's Git-backed sources.");
  }

  const alternateSource = candidateSources.find(source => source.id !== selectedSource.id) ?? null;
  const jobId = createId("job");
  const inheritedBinding = await resolveFollowOnCodexAuthBinding(
    report.workspaceId,
    userId,
    parseJobMetadata(report.job.metadataJson).codexAuth ?? null,
  );
  const metadata: PersistedJobMetadata = {
    ...(inheritedBinding ? { codexAuth: inheritedBinding } : {}),
    remediation: {
      reportId,
      sourceId: input.sourceId,
      baseRef: input.baseRef,
      selectionMode: input.selectionMode,
      selectedFindingIds: input.selectedFindingIds,
      maxIterations: input.maxIterations,
      outputMode: input.outputMode,
      publishRemote: input.publishRemote,
      changeset: null,
    },
  };
  const logs = [
    createLog(
      jobId,
      "queue",
      "Remediation job accepted and pending durable queue dispatch.",
      "info",
      options.requestId,
    ),
    createLog(
      jobId,
      "remediation",
      `Queued remediation against source ${selectedSource.displayName} from report ${reportId}.`,
      "info",
      options.requestId,
    ),
  ];

  await prisma.$transaction([
    prisma.analysisJob.create({
      data: {
        id: jobId,
        workspaceId: report.workspaceId,
        sourceId: selectedSource.id,
        companionSourceId: alternateSource?.id ?? null,
        parentReportId: reportId,
        jobKind: "remediation",
        status: "pending",
        agentId: "agent-fix-readiness",
        sourceType: selectedSource.type,
        sourceLocation: selectedSource.location,
        companionSourceType: alternateSource?.type ?? null,
        companionSourceLocation: alternateSource?.location ?? null,
        rolesJson: [],
        metadataJson: metadata as Prisma.InputJsonValue,
        runtimeMode: "static",
        secretRefsJson: [],
        requestedByUserId: userId,
      },
    }),
    prisma.analysisJobLog.createMany({
      data: logs.map(log => ({
        id: log.id,
        jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility,
        requestId: log.requestId ?? null,
        createdAt: new Date(log.createdAt),
      })),
    }),
  ]);

  const existingSummary = report.summaryJson && typeof report.summaryJson === "object" && !Array.isArray(report.summaryJson)
    ? report.summaryJson as Record<string, unknown>
    : {};
  await prisma.analysisReport.update({
    where: { id: reportId },
    data: {
      summaryJson: analysisReportSummarySchema.parse({
        ...existingSummary,
        latestRemediationJobId: jobId,
      }) as Prisma.InputJsonValue,
    },
  });

  return await getJobEnvelopeById(jobId);
}

export async function leaseAnalysisJobForDispatch(jobId: string, dispatcherId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + getDispatchLeaseMs());
  const result = await prisma.analysisJob.updateMany({
    where: {
      id: jobId,
      status: "pending",
      AND: [
        {
          OR: [
            { dispatchNextAttemptAt: null },
            { dispatchNextAttemptAt: { lte: now } },
          ],
        },
        {
          OR: [
            { dispatchLeaseExpiresAt: null },
            { dispatchLeaseExpiresAt: { lt: now } },
            { dispatchLeaseOwner: dispatcherId },
          ],
        },
      ],
    },
    data: {
      dispatchAttempts: { increment: 1 },
      dispatchLastAttemptAt: now,
      dispatchLeaseOwner: dispatcherId,
      dispatchLeaseExpiresAt: leaseExpiresAt,
      dispatchLastError: null,
    },
  });
  return result.count > 0;
}

export async function leaseNextPendingAnalysisJobForDispatch(dispatcherId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const now = new Date();
  const candidates = await prisma.analysisJob.findMany({
    where: {
      status: "pending",
      AND: [
        {
          OR: [
            { dispatchNextAttemptAt: null },
            { dispatchNextAttemptAt: { lte: now } },
          ],
        },
        {
          OR: [
            { dispatchLeaseExpiresAt: null },
            { dispatchLeaseExpiresAt: { lt: now } },
          ],
        },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  for (const candidate of candidates) {
    if (await leaseAnalysisJobForDispatch(candidate.id, dispatcherId)) {
      return candidate.id;
    }
  }

  return null;
}

export async function setAnalysisJobQueueMessage(
  jobId: string,
  payload: RunnerJobPayload & { messageId: string },
  dispatcherId?: string,
): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  const log = createLog(jobId, "queue", `Queue publish succeeded for payload ${payload.jobId}.`);
  await prisma.$transaction(async tx => {
    const updated = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["pending", "queued"] },
        ...(dispatcherId
          ? {
              AND: [{
                OR: [
                  { dispatchLeaseOwner: null },
                  { dispatchLeaseOwner: dispatcherId },
                ],
              }],
            }
          : {}),
      },
      data: {
        status: "queued",
        queueMessageId: payload.messageId,
        dispatchLastError: null,
        dispatchNextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
      },
    });

    if (updated.count > 0) {
      await tx.analysisJobLog.create({
        data: {
          id: log.id,
          jobId: log.jobId,
          level: log.level,
          scope: log.scope,
          message: log.message,
          visibility: log.visibility,
          requestId: log.requestId ?? null,
          createdAt: new Date(log.createdAt),
        },
      });
    }
  });
  return await getJobEnvelopeById(jobId);
}

export async function markAnalysisJobDispatchFailure(
  jobId: string,
  payload: { dispatcherId: string; errorMessage: string },
): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  await prisma.$transaction(async tx => {
    const current = await tx.analysisJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        dispatchAttempts: true,
        dispatchLeaseOwner: true,
      },
    });
    if (!current || current.status !== "pending") {
      return;
    }
    if (current.dispatchLeaseOwner && current.dispatchLeaseOwner !== payload.dispatcherId) {
      return;
    }

    const reachedLimit = current.dispatchAttempts >= getMaxDispatchAttempts();
    const now = new Date();
    const retryAt = new Date(now.getTime() + getDispatchBackoffMs(current.dispatchAttempts));
    const log = reachedLimit
      ? createLog(
          jobId,
          "queue",
          `Queue dispatch permanently failed after ${current.dispatchAttempts} attempts: ${payload.errorMessage}`,
          "error",
        )
      : createLog(
          jobId,
          "queue",
          `Queue dispatch attempt ${current.dispatchAttempts} failed and will retry: ${payload.errorMessage}`,
          "warn",
        );

    const updated = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: "pending",
        dispatchAttempts: current.dispatchAttempts,
        ...(current.dispatchLeaseOwner
          ? { dispatchLeaseOwner: current.dispatchLeaseOwner }
          : { dispatchLeaseOwner: null }),
      },
      data: reachedLimit
        ? {
            status: "failed",
            failureReason: payload.errorMessage,
            finishedAt: now,
            dispatchLastError: payload.errorMessage,
            dispatchNextAttemptAt: null,
            dispatchLeaseOwner: null,
            dispatchLeaseExpiresAt: null,
          }
        : {
            dispatchLastError: payload.errorMessage,
            dispatchNextAttemptAt: retryAt,
            dispatchLeaseOwner: null,
            dispatchLeaseExpiresAt: null,
          },
    });
    if (updated.count === 0) {
      return;
    }
    await tx.analysisJobLog.create({
      data: {
        id: log.id,
        jobId: log.jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility,
        requestId: log.requestId ?? null,
        createdAt: new Date(log.createdAt),
      },
    });
  });
  return await getJobEnvelopeById(jobId);
}

export async function getJobEnvelopeById(jobId: string): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
    include: {
      logs: { orderBy: logOrderBy },
      report: {
        include: {
          artifacts: { orderBy: artifactOrderBy },
        },
      },
      artifacts: { orderBy: artifactOrderBy },
      source: true,
      companionSource: true,
    },
  });
  if (!job) {
    throw statusError(404, `Job not found: ${jobId}`);
  }
  if (!isActiveHostedJobRecord(job)) {
    throw statusError(404, `Job ${jobId} is no longer available on the active hosted product path.`);
  }
  return buildJobEnvelope(job);
}

export async function getAnalysisJobExecutionPath(jobId: string): Promise<JobExecutionPath | null> {
  const prisma = getPrismaClient();
  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
    select: { id: true },
  });
  return job ? "unified-agent" : null;
}

export async function listJobLogsAfter(jobId: string, afterId?: string | null): Promise<AnalysisLogEvent[]> {
  return listJobLogsAfterWithVisibility(jobId, afterId, "default");
}

export async function listJobLogsAfterWithVisibility(
  jobId: string,
  afterId: string | null | undefined,
  visibility: AnalysisLogEvent["visibility"] | "all",
): Promise<AnalysisLogEvent[]> {
  const prisma = getPrismaClient();
  let afterCursor: { id: string; createdAt: Date } | null = null;
  if (afterId) {
    const existing = await prisma.analysisJobLog.findFirst({
      where: { id: afterId, jobId },
      select: { id: true, createdAt: true },
    });
    if (existing) {
      afterCursor = existing;
    }
  }
  const logs = await prisma.analysisJobLog.findMany({
    where: {
      jobId,
      ...(visibility === "all" ? {} : { visibility }),
      ...(afterCursor
        ? {
            OR: [
              { createdAt: { gt: afterCursor.createdAt } },
              { createdAt: afterCursor.createdAt, id: { gt: afterCursor.id } },
            ],
          }
        : {}),
    },
    orderBy: logOrderBy,
  });
  return logs.map(mapLogRecord);
}

export async function getJobEnvelopeForUser(
  jobId: string,
  userId: string,
  options: { logVisibility?: AnalysisLogEvent["visibility"] | "all" } = {},
): Promise<JobEnvelope> {
  return buildJobEnvelope(await requireJobAccessWithLogVisibility(jobId, userId, options.logVisibility ?? "default"));
}

export async function listJobsForUser(userId: string): Promise<JobEnvelope[]> {
  const prisma = getPrismaClient();
  const jobs = await prisma.analysisJob.findMany({
    where: {
      OR: [
        { workspace: { ownerUserId: userId } },
        { workspace: { memberships: { some: { userId } } } },
      ],
    },
    include: {
      logs: { orderBy: logOrderBy },
      report: {
        include: {
          artifacts: { orderBy: artifactOrderBy },
        },
      },
      artifacts: { orderBy: artifactOrderBy },
      source: true,
      companionSource: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return jobs.filter(isActiveHostedJobRecord).map(buildJobEnvelope);
}

export async function listJobsPageForUser(
  userId: string,
  options: {
    workspaceId?: string;
    status?: AnalysisJob["status"] | null;
    q?: string;
    hasReport?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResult<JobEnvelope>> {
  const prisma = getPrismaClient();
  const page = normalizePageNumber(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const q = options.q?.trim() ?? "";
  const where = accessibleJobsWhere(
    userId,
    ...(options.workspaceId ? [{ workspaceId: options.workspaceId }] satisfies Prisma.AnalysisJobWhereInput[] : []),
    ...(options.status ? [{ status: options.status }] satisfies Prisma.AnalysisJobWhereInput[] : []),
    ...(options.hasReport === undefined
      ? []
      : [{ report: options.hasReport ? { isNot: null } : { is: null } }] satisfies Prisma.AnalysisJobWhereInput[]),
    ...(q
      ? [{
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { status: { contains: q, mode: "insensitive" } },
            { sourceLocation: { contains: q, mode: "insensitive" } },
            { companionSourceLocation: { contains: q, mode: "insensitive" } },
            { agentId: { contains: q, mode: "insensitive" } },
            { failureReason: { contains: q, mode: "insensitive" } },
            { report: { is: { title: { contains: q, mode: "insensitive" } } } },
          ],
        }] satisfies Prisma.AnalysisJobWhereInput[]
      : []),
  );
  const [total, jobs] = await prisma.$transaction([
    prisma.analysisJob.count({ where }),
    prisma.analysisJob.findMany({
      where,
      include: jobSummaryInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: jobs.map(buildJobSummaryEnvelope),
    pageInfo: buildPageInfo(total, page, pageSize),
  };
}

export async function requestJobCancellationForUser(
  jobId: string,
  userId: string,
  options: { requestId?: string } = {},
): Promise<{
  job: JobEnvelope;
  queueMessageId: string | null;
  shouldCancelQueueMessage: boolean;
  executionPath: JobExecutionPath;
}> {
  const job = await requireJobLifecycleMutationAccess(jobId, userId);
  const prisma = getPrismaClient();
  const executionPath = resolveJobExecutionPath({
    agentId: job.agentId,
  });
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return {
      job: buildJobEnvelope(job),
      queueMessageId: job.queueMessageId,
      shouldCancelQueueMessage: false,
      executionPath,
    };
  }

  if (job.status === "pending" || job.status === "queued") {
    const log = createLog(jobId, "queue", "Job was cancelled before runner claim.", "warn", options.requestId);
    let cancelledBeforeClaim = false;
    await prisma.$transaction(async tx => {
      const updated = await tx.analysisJob.updateMany({
        where: {
          id: jobId,
          status: { in: ["pending", "queued"] },
        },
        data: {
          status: "cancelled",
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
          failureReason: "Cancelled before runner claim.",
          dispatchLastError: null,
          dispatchNextAttemptAt: null,
          dispatchLeaseOwner: null,
          dispatchLeaseExpiresAt: null,
        },
      });
      if (updated.count === 0) {
        return;
      }
      cancelledBeforeClaim = true;
      await tx.analysisJobLog.create({
        data: {
          id: log.id,
          jobId: log.jobId,
          level: log.level,
          scope: log.scope,
          message: log.message,
          visibility: log.visibility,
          requestId: log.requestId ?? null,
          createdAt: new Date(log.createdAt),
        },
      });
    });
    if (cancelledBeforeClaim) {
      return {
        job: await getJobEnvelopeById(jobId),
        queueMessageId: job.queueMessageId,
        shouldCancelQueueMessage: Boolean(job.queueMessageId),
        executionPath,
      };
    }
  }

  const log = createLog(jobId, "queue", "Cancellation requested for a running job.", "warn", options.requestId);
  await prisma.$transaction(async tx => {
    const updated = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: "running",
        cancelRequestedAt: null,
      },
      data: {
        cancelRequestedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      return;
    }
    await tx.analysisJobLog.create({
      data: {
        id: log.id,
        jobId: log.jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility,
        requestId: log.requestId ?? null,
        createdAt: new Date(log.createdAt),
      },
    });
  });
  return {
    job: await getJobEnvelopeById(jobId),
    queueMessageId: null,
    shouldCancelQueueMessage: false,
    executionPath,
  };
}

export async function retryAnalysisJobForUser(jobId: string, userId: string): Promise<JobEnvelope> {
  const current = buildJobEnvelope(await requireJobLifecycleMutationAccess(jobId, userId));
  if (current.job.status !== "failed" && current.job.status !== "cancelled") {
    throw statusError(403, "Only failed or cancelled jobs can be retried.");
  }
  if (current.job.jobKind === "remediation") {
    const metadata = parseJobMetadata((await getPrismaClient().analysisJob.findUnique({
      where: { id: jobId },
      select: { metadataJson: true },
    }))?.metadataJson);
    if (!current.job.parentReportId || !metadata.remediation) {
      throw statusError(400, "Remediation retry metadata is missing.");
    }
    return createRemediationJobForUser(current.job.parentReportId, userId, {
      sourceId: metadata.remediation.sourceId,
      baseRef: metadata.remediation.baseRef,
      selectionMode: metadata.remediation.selectionMode,
      selectedFindingIds: metadata.remediation.selectedFindingIds,
      maxIterations: metadata.remediation.maxIterations,
      outputMode: metadata.remediation.outputMode,
      publishRemote: metadata.remediation.publishRemote,
    });
  }
  const retryAgentId = current.job.agentId
    ?? resolveDefaultAgentIdForRequest(current.job.roles, current.job.runtimeMode);
  return createAgentJobForUser(current.job.workspaceId, userId, retryAgentId, {
    sourceId: current.job.sourceId,
    companionSourceId: current.job.companionSourceId ?? undefined,
    runtimeMode: current.job.runtimeMode,
    codexAuthScope: current.job.codexAuthScope ?? undefined,
    secretRefs: current.job.secretRefs,
  });
}

export async function claimAnalysisJob(jobId: string, runnerId: string, queueMessageId?: string): Promise<JobExecutionRecord | null> {
  const prisma = getPrismaClient();
  const claimResult = await prisma.$transaction(async tx => {
    const cancelLog = createLog(jobId, "queue", "Job was cancelled before runner claim.", "warn");
    const cancelled = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["pending", "queued"] },
        cancelRequestedAt: { not: null },
      },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
        failureReason: "Cancelled before runner claim.",
        dispatchLastError: null,
        dispatchNextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
      },
    });
    if (cancelled.count > 0) {
      await tx.analysisJobLog.create({
        data: {
          id: cancelLog.id,
          jobId: cancelLog.jobId,
          level: cancelLog.level,
          scope: cancelLog.scope,
          message: cancelLog.message,
          visibility: cancelLog.visibility,
          requestId: cancelLog.requestId ?? null,
          createdAt: new Date(cancelLog.createdAt),
        },
      });
      return { claimed: false as const, cancelled: true as const };
    }
    const claimed = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["pending", "queued"] },
        cancelRequestedAt: null,
      },
      data: {
        status: "running",
        claimedRunnerId: runnerId,
        startedAt: new Date(),
        dispatchLastError: null,
        dispatchNextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
        ...(queueMessageId ? { queueMessageId } : {}),
      },
    });
    if (claimed.count === 0) {
      return { claimed: false as const, cancelled: false as const };
    }
    const log = createLog(jobId, "queue", `Runner ${runnerId} claimed dispatched job and started analysis.`);
    await tx.analysisJobLog.create({
      data: {
        id: log.id,
        jobId: log.jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility,
        requestId: log.requestId ?? null,
        createdAt: new Date(log.createdAt),
      },
    });
    return { claimed: true as const, cancelled: false as const };
  });

  if (!claimResult.claimed) {
    return null;
  }

  try {
    return await getExecutionRecord(jobId);
  } catch (error) {
    const prisma = getPrismaClient();
    const message = error instanceof Error ? error.message : "Failed to prepare claimed job execution context.";
    const log = createLog(jobId, "runner", message, "error");
    await prisma.$transaction(async tx => {
      const updated = await tx.analysisJob.updateMany({
        where: {
          id: jobId,
          status: "running",
          claimedRunnerId: runnerId,
        },
        data: {
          status: "failed",
          failureReason: message,
          finishedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        return;
      }
      await tx.analysisJobLog.create({
        data: {
          id: log.id,
          jobId: log.jobId,
          level: log.level,
          scope: log.scope,
          message: log.message,
          visibility: log.visibility,
          requestId: log.requestId ?? null,
          createdAt: new Date(log.createdAt),
        },
      });
    });
    return null;
  }
}

export async function claimAgentJob(jobId: string, agentId: string, queueMessageId?: string): Promise<JobExecutionRecord | null> {
  const prisma = getPrismaClient();
  const claimResult = await prisma.$transaction(async tx => {
    const cancelLog = createLog(jobId, "queue", "Job was cancelled before agent claim.", "warn");
    const cancelled = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["pending", "queued"] },
        agentId: { not: null },
        cancelRequestedAt: { not: null },
      },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
        failureReason: "Cancelled before agent claim.",
        dispatchLastError: null,
        dispatchNextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
      },
    });
    if (cancelled.count > 0) {
      await tx.analysisJobLog.create({
        data: {
          id: cancelLog.id,
          jobId: cancelLog.jobId,
          level: cancelLog.level,
          scope: cancelLog.scope,
          message: cancelLog.message,
          visibility: cancelLog.visibility,
          requestId: cancelLog.requestId ?? null,
          createdAt: new Date(cancelLog.createdAt),
        },
      });
      return { claimed: false as const, cancelled: true as const };
    }
    const claimed = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["pending", "queued"] },
        agentId: { not: null },
        cancelRequestedAt: null,
      },
      data: {
        status: "running",
        claimedRunnerId: agentId,
        startedAt: new Date(),
        dispatchLastError: null,
        dispatchNextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
        ...(queueMessageId ? { queueMessageId } : {}),
      },
    });
    if (claimed.count === 0) {
      return { claimed: false as const, cancelled: false as const };
    }
    const log = createLog(jobId, "queue", `Agent ${agentId} claimed dispatched job and started analysis.`);
    await tx.analysisJobLog.create({
      data: {
        id: log.id,
        jobId: log.jobId,
        level: log.level,
        scope: log.scope,
        message: log.message,
        visibility: log.visibility,
        requestId: log.requestId ?? null,
        createdAt: new Date(log.createdAt),
      },
    });
    return { claimed: true as const, cancelled: false as const };
  });

  if (!claimResult.claimed) {
    return null;
  }

  try {
    return await getExecutionRecord(jobId);
  } catch (error) {
    const prisma = getPrismaClient();
    const message = error instanceof Error ? error.message : "Failed to prepare claimed job execution context.";
    const log = createLog(jobId, "agent", message, "error");
    await prisma.$transaction(async tx => {
      const updated = await tx.analysisJob.updateMany({
        where: {
          id: jobId,
          status: "running",
          claimedRunnerId: agentId,
        },
        data: {
          status: "failed",
          failureReason: message,
          finishedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        return;
      }
      await tx.analysisJobLog.create({
        data: {
          id: log.id,
          jobId: log.jobId,
          level: log.level,
          scope: log.scope,
          message: log.message,
          visibility: log.visibility,
          requestId: log.requestId ?? null,
          createdAt: new Date(log.createdAt),
        },
      });
    });
    return null;
  }
}

async function getExecutionRecord(jobId: string): Promise<JobExecutionRecord> {
  const prisma = getPrismaClient();
  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw statusError(404, `Job not found: ${jobId}`);
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: job.workspaceId },
  });
  if (!workspace) {
    throw statusError(404, `Workspace not found for job ${jobId}.`);
  }
  const source = await prisma.source.findUnique({
    where: { id: job.sourceId },
  });
  if (!source) {
    throw statusError(404, `Source not found for job ${jobId}.`);
  }
  const companionSource = job.companionSourceId
    ? await prisma.source.findUnique({
        where: { id: job.companionSourceId },
      })
    : null;
  const parentReport = job.parentReportId
    ? await prisma.analysisReport.findUnique({
        where: { id: job.parentReportId },
        include: {
          artifacts: { orderBy: artifactOrderBy },
        },
      })
    : null;
  const secrets = await resolveWorkspaceSecrets(job.workspaceId, asJsonArray<string>(job.secretRefsJson));
  return {
    job: mapJobRecord(job),
    workspace: mapWorkspaceRecord(workspace),
    source: mapSourceRecord(source),
    companionSource: companionSource ? mapSourceRecord(companionSource) : null,
    parentReport: parentReport ? mapReportRecord(parentReport) : null,
    metadata: parseJobMetadata(job.metadataJson),
    secrets,
  };
}

export async function isCancellationRequested(jobId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
    select: { cancelRequestedAt: true },
  });
  return Boolean(job?.cancelRequestedAt);
}

export async function finalizeAnalysisJobSuccess(
  jobId: string,
  envelope: JobEnvelope,
  extraArtifacts: ArtifactReference[] = [],
): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  const report = envelope.report;
  const artifacts = [...(report?.artifacts ?? []), ...extraArtifacts];
  const roleIds = envelope.job.roles;
  let finalized = false;
  await prisma.$transaction(async tx => {
    const updated = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: "running",
        cancelRequestedAt: null,
      },
      data: {
        reportId: report?.id ?? null,
        status: "succeeded",
        agentId: envelope.job.agentId ?? null,
        rolesJson: roleIds as Prisma.InputJsonValue,
        runtimeMode: envelope.job.runtimeMode,
        failureReason: null,
        startedAt: asTimestamp(envelope.job.startedAt) ?? new Date(),
        finishedAt: asTimestamp(envelope.job.finishedAt) ?? new Date(),
        ...(envelope.job.queueMessageId !== undefined ? { queueMessageId: envelope.job.queueMessageId } : {}),
        ...(envelope.job.claimedRunnerId !== undefined ? { claimedRunnerId: envelope.job.claimedRunnerId } : {}),
        ...(envelope.job.cancelRequestedAt !== undefined
          ? { cancelRequestedAt: asTimestamp(envelope.job.cancelRequestedAt) }
          : {}),
      },
    });
    if (updated.count === 0) {
      return;
    }
    finalized = true;

    if (report) {
      await tx.analysisReport.upsert({
        where: { jobId },
        update: {
          status: report.status,
          rolesJson: report.roles as Prisma.InputJsonValue,
          runtimeMode: report.runtimeMode,
          title: report.title,
          summaryJson: report.summary as Prisma.InputJsonValue,
          findingsJson: report.findings as Prisma.InputJsonValue,
          sectionsJson: report.sections as Prisma.InputJsonValue,
        },
        create: {
          id: report.id,
          workspaceId: report.workspaceId,
          jobId,
          status: report.status,
          rolesJson: report.roles as Prisma.InputJsonValue,
          runtimeMode: report.runtimeMode,
          title: report.title,
          summaryJson: report.summary as Prisma.InputJsonValue,
          findingsJson: report.findings as Prisma.InputJsonValue,
          sectionsJson: report.sections as Prisma.InputJsonValue,
          createdAt: new Date(report.createdAt),
        },
      });
    }

    await tx.artifactReference.deleteMany({
      where: { jobId },
    });
    if (artifacts.length > 0) {
      await tx.artifactReference.createMany({
        data: artifacts.map(artifact => ({
          id: artifact.id ?? createId("artifact"),
          jobId,
          reportId: artifact.reportId ?? report?.id ?? null,
          kind: artifact.kind ?? "artifact",
          objectKey: artifact.key,
          bucket: artifact.bucket,
          region: artifact.region,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          signedUrl: artifact.signedUrl ?? null,
          createdAt: asTimestamp(artifact.createdAt) ?? new Date(),
        })),
      });
    }
  });

  if (finalized) {
    await createManyLogs(envelope.logs);
  }
  return await getJobEnvelopeById(jobId);
}

export async function finalizeAnalysisJobFailure(
  jobId: string,
  options: {
    status?: "failed" | "cancelled";
    failureReason: string;
    logs?: AnalysisLogEvent[];
    artifacts?: ArtifactReference[];
  },
): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  const status = options.status ?? "failed";
  let finalized = false;
  await prisma.$transaction(async tx => {
    const updated = await tx.analysisJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["pending", "queued", "running"] },
      },
      data: {
        status,
        failureReason: options.failureReason,
        finishedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      return;
    }
    finalized = true;
    if (options.artifacts && options.artifacts.length > 0) {
      await tx.artifactReference.createMany({
        data: options.artifacts.map(artifact => ({
          id: artifact.id ?? createId("artifact"),
          jobId,
          reportId: artifact.reportId ?? null,
          kind: artifact.kind ?? "artifact",
          objectKey: artifact.key,
          bucket: artifact.bucket,
          region: artifact.region,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          signedUrl: artifact.signedUrl ?? null,
          createdAt: asTimestamp(artifact.createdAt) ?? new Date(),
        })),
      });
    }
  });
  if (finalized) {
    await createManyLogs(options.logs ?? []);
  }
  return await getJobEnvelopeById(jobId);
}

export async function getReportForUser(reportId: string, userId: string): Promise<AnalysisReport> {
  const report = await requireReportAccess(reportId, userId);
  const reportSources = [
    {
      id: report.job.source.id,
      displayName: report.job.source.displayName,
      location: report.job.source.location,
    },
    ...(report.job.companionSource ? [{
      id: report.job.companionSource.id,
      displayName: report.job.companionSource.displayName,
      location: report.job.companionSource.location,
    }] : []),
  ];
  return mapReportRecord(report, reportSources);
}

export async function storeReportChangeset(
  reportId: string,
  changeset: NonNullable<AnalysisReport["summary"]["changeset"]>,
  latestRemediationJobId: string | null = null,
): Promise<AnalysisReport> {
  const prisma = getPrismaClient();
  const report = await prisma.analysisReport.findUnique({
    where: { id: reportId },
  });
  if (!report) {
    throw statusError(404, `Report not found: ${reportId}`);
  }
  const existingSummary = report.summaryJson && typeof report.summaryJson === "object" && !Array.isArray(report.summaryJson)
    ? report.summaryJson as Record<string, unknown>
    : {};
  const summary = analysisReportSummarySchema.parse({
    ...existingSummary,
    changeset,
    latestRemediationJobId: latestRemediationJobId ?? existingSummary.latestRemediationJobId ?? null,
  });
  await prisma.analysisReport.update({
    where: { id: reportId },
    data: {
      summaryJson: summary as Prisma.InputJsonValue,
    },
  });
  const refreshed = await prisma.analysisReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      artifacts: { orderBy: artifactOrderBy },
      job: {
        include: {
          source: true,
          companionSource: true,
        },
      },
    },
  });
  const reportSources = [
    {
      id: refreshed.job.source.id,
      displayName: refreshed.job.source.displayName,
      location: refreshed.job.source.location,
    },
    ...(refreshed.job.companionSource ? [{
      id: refreshed.job.companionSource.id,
      displayName: refreshed.job.companionSource.displayName,
      location: refreshed.job.companionSource.location,
    }] : []),
  ];
  return mapReportRecord(refreshed, reportSources);
}

export async function storeReportChangesetForUser(
  reportId: string,
  userId: string,
  changeset: NonNullable<AnalysisReport["summary"]["changeset"]>,
): Promise<AnalysisReport> {
  await requireReportAccess(reportId, userId);
  return storeReportChangeset(reportId, changeset);
}

export async function storeRemediationJobChangeset(
  jobId: string,
  changeset: NonNullable<AnalysisJob["changeset"]>,
): Promise<JobEnvelope> {
  const prisma = getPrismaClient();
  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      metadataJson: true,
      parentReportId: true,
    },
  });
  if (!job) {
    throw statusError(404, `Job not found: ${jobId}`);
  }
  const existingMetadata = parseJobMetadata(job.metadataJson);
  const nextMetadata: PersistedJobMetadata = {
    ...existingMetadata,
    remediation: existingMetadata.remediation
      ? {
          ...existingMetadata.remediation,
          changeset,
        }
      : null,
  };
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: {
      metadataJson: nextMetadata as Prisma.InputJsonValue,
    },
  });
  return getJobEnvelopeById(jobId);
}

export async function listRemediationJobsForSourceForUser(
  workspaceId: string,
  sourceId: string,
  userId: string,
): Promise<JobEnvelope[]> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const prisma = getPrismaClient();
  const jobs = await prisma.analysisJob.findMany({
    where: {
      workspaceId,
      jobKind: "remediation",
      sourceId,
    },
    include: {
      logs: { orderBy: logOrderBy },
      report: {
        include: {
          artifacts: { orderBy: artifactOrderBy },
        },
      },
      artifacts: { orderBy: artifactOrderBy },
      source: true,
      companionSource: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return jobs.filter(isActiveHostedJobRecord).map(buildJobEnvelope);
}

export async function listArtifactsForJobForUser(jobId: string, userId: string): Promise<ArtifactReference[]> {
  const job = await requireJobAccess(jobId, userId);
  return job.artifacts.map(mapArtifactRecord);
}

export async function getArtifactForJobForUser(jobId: string, artifactIndex: number, userId: string): Promise<ArtifactReference> {
  const artifacts = await listArtifactsForJobForUser(jobId, userId);
  const artifact = artifacts[artifactIndex];
  if (!artifact) {
    throw statusError(404, `Artifact not found for job ${jobId} at index ${artifactIndex}`);
  }
  return artifact;
}

export async function purgeRetention(config: ObjectStorageConfig, cutoff: Date): Promise<{ artifacts: number; logs: number }> {
  const prisma = getPrismaClient();
  const artifacts = await prisma.artifactReference.findMany({
    where: {
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      objectKey: true,
    },
  });

  for (const artifact of artifacts) {
    try {
      await deleteObject(config, artifact.objectKey);
    } catch (error) {
      console.warn(`[retention] Failed to delete artifact ${artifact.objectKey}:`, error);
    }
  }

  const deleteArtifacts = prisma.artifactReference.deleteMany({
    where: {
      id: { in: artifacts.map(item => item.id) },
    },
  });

  const deleteLogs = prisma.analysisJobLog.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  const [artifactResult, logResult] = await prisma.$transaction([deleteArtifacts, deleteLogs]);
  return {
    artifacts: artifactResult.count,
    logs: logResult.count,
  };
}

export async function createCheckoutSessionForUser(
  userId: string,
  input: {
    workspaceId?: string | null;
    priceId: string | null;
    successUrl: string;
    cancelUrl: string;
    sessionId?: string;
    checkoutUrl?: string;
  },
): Promise<CheckoutSessionRecord> {
  if (input.workspaceId) {
    await requireWorkspaceRole(input.workspaceId, userId, "owner");
  }
  const prisma = getPrismaClient();
  const sessionId = input.sessionId ?? createId("checkout");
  const checkoutUrl = input.checkoutUrl ?? (() => {
    try {
      const url = new URL(input.successUrl);
      url.searchParams.set("session_id", sessionId);
      url.searchParams.set("plan", "pro");
      return url.toString();
    } catch {
      const separator = input.successUrl.includes("?") ? "&" : "?";
      return `${input.successUrl}${separator}session_id=${encodeURIComponent(sessionId)}&plan=pro`;
    }
  })();
  const session = await prisma.checkoutSession.create({
    data: {
      id: sessionId,
      workspaceId: input.workspaceId ?? null,
      userId,
      entitlement: "pro",
      checkoutUrl,
      status: "open",
    },
  });
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    userId: session.userId,
    entitlement: session.entitlement as "pro",
    checkoutUrl: session.checkoutUrl,
    status: session.status as CheckoutSessionRecord["status"],
    createdAt: session.createdAt.toISOString(),
  };
}

export async function getBillingPortalContextForUser(
  userId: string,
  workspaceId?: string | null,
): Promise<{
  customerId: string | null;
  email: string;
  workspaceId: string | null;
}> {
  if (workspaceId) {
    await requireWorkspaceRole(workspaceId, userId, "owner");
  }
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) {
    throw statusError(404, `User not found: ${userId}`);
  }
  const subscription = await prisma.billingSubscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return {
    customerId: subscription?.providerCustomerId ?? null,
    email: user.email,
    workspaceId: workspaceId ?? null,
  };
}

export async function applyStripeWebhookToDatabase(
  input: StripeWebhookInput,
): Promise<{ received: true; entitlement: User["entitlement"] }> {
  const prisma = getPrismaClient();
  if (input.eventId) {
    const existingEvent = await prisma.stripeEvent.findUnique({ where: { id: input.eventId } });
    if (existingEvent) {
      const user = input.userId ? await prisma.user.findUnique({ where: { id: input.userId } }) : null;
      return { received: true, entitlement: user?.entitlement as User["entitlement"] ?? "free" };
    }
  }
  const checkoutSession = input.sessionId
    ? await prisma.checkoutSession.findUnique({ where: { id: input.sessionId } })
    : null;
  const targetUserId = input.userId ?? checkoutSession?.userId ?? null;
  if (!targetUserId) {
    throw statusError(404, "Unknown user for Stripe webhook.");
  }
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) {
    throw statusError(404, `Unknown user for Stripe webhook: ${targetUserId}`);
  }

  if (input.type === "checkout.session.completed") {
    await prisma.$transaction(async tx => {
      if (input.subscriptionId) {
        const providerCustomerUpdate = input.customerId ? { providerCustomerId: input.customerId } : {};
        await tx.billingSubscription.upsert({
          where: { providerSubscriptionId: input.subscriptionId },
          update: {
            ...providerCustomerUpdate,
            entitlement: "pro",
            status: "active",
          },
          create: {
            id: createId("sub"),
            userId: user.id,
            provider: "stripe",
            providerCustomerId: input.customerId ?? `cus_${randomUUID()}`,
            providerSubscriptionId: input.subscriptionId,
            entitlement: "pro",
            status: "active",
          },
        });
      } else {
        await tx.billingSubscription.create({
          data: {
            id: createId("sub"),
            userId: user.id,
            provider: "stripe",
            providerCustomerId: input.customerId ?? `cus_${randomUUID()}`,
            providerSubscriptionId: `stripe_sub_${randomUUID()}`,
            entitlement: "pro",
            status: "active",
          },
        });
      }
      if (checkoutSession) {
        await tx.checkoutSession.update({
          where: { id: checkoutSession.id },
          data: { status: "completed" },
        });
      }
      if (input.eventId) {
        await tx.stripeEvent.create({
          data: {
            id: input.eventId,
            provider: "stripe",
          },
        });
      }
    });
    await updateOwnedWorkspaceEntitlement(user.id, "pro");
    return { received: true, entitlement: "pro" };
  }

  if (input.type === "customer.subscription.updated") {
    const status = input.status ?? "active";
    const entitlement = status === "active" || status === "trialing" ? "pro" : "free";
    if (input.subscriptionId) {
      const providerCustomerUpdate = input.customerId ? { providerCustomerId: input.customerId } : {};
      await prisma.billingSubscription.upsert({
        where: { providerSubscriptionId: input.subscriptionId },
        update: {
          ...providerCustomerUpdate,
          status,
          entitlement,
          updatedAt: new Date(),
        },
        create: {
          id: createId("sub"),
          userId: user.id,
          provider: "stripe",
          providerCustomerId: input.customerId ?? `cus_${randomUUID()}`,
          providerSubscriptionId: input.subscriptionId,
          entitlement,
          status,
        },
      });
    }
    if (input.eventId) {
      await prisma.stripeEvent.create({
        data: {
          id: input.eventId,
          provider: "stripe",
        },
      });
    }
    await updateOwnedWorkspaceEntitlement(user.id, entitlement);
    return { received: true, entitlement };
  }

  await prisma.billingSubscription.updateMany({
    where: { userId: user.id },
    data: {
      status: "cancelled",
      entitlement: "free",
      updatedAt: new Date(),
    },
  });
  if (input.eventId) {
    await prisma.stripeEvent.create({
      data: {
        id: input.eventId,
        provider: "stripe",
      },
    });
  }
  await updateOwnedWorkspaceEntitlement(user.id, "free");
  return { received: true, entitlement: "free" };
}

export function createGithubInstallUrl(state: string, baseInstallUrl = "https://github.com/apps/speclens/installations/new"): string {
  const params = new URLSearchParams({ state });
  return `${baseInstallUrl}?${params.toString()}`;
}

export async function createGithubInstallIntent(input: {
  workspaceId: string;
  requestedByUserId: string;
  targetAppUrl: string;
  nonce: string;
  expiresAt: Date;
}): Promise<GithubInstallIntent> {
  const prisma = getPrismaClient();
  const record = await prisma.githubInstallIntent.create({
    data: {
      id: createId("ghintent"),
      workspaceId: input.workspaceId,
      requestedByUserId: input.requestedByUserId,
      targetAppUrl: input.targetAppUrl,
      nonce: input.nonce,
      expiresAt: input.expiresAt,
    },
  });
  return mapGithubInstallIntentRecord(record);
}

export async function getGithubInstallIntentById(intentId: string): Promise<GithubInstallIntent | null> {
  const prisma = getPrismaClient();
  const record = await prisma.githubInstallIntent.findUnique({
    where: { id: intentId },
  });
  return record ? mapGithubInstallIntentRecord(record) : null;
}

export async function consumeGithubInstallIntent(intentId: string): Promise<GithubInstallIntent | null> {
  const prisma = getPrismaClient();
  const now = new Date();
  return prisma.$transaction(async tx => {
    const existing = await tx.githubInstallIntent.findUnique({
      where: { id: intentId },
    });
    if (!existing || existing.consumedAt || existing.expiresAt <= now) {
      return null;
    }
    const record = await tx.githubInstallIntent.update({
      where: { id: intentId },
      data: { consumedAt: now },
    });
    return mapGithubInstallIntentRecord(record);
  });
}

export async function registerGithubInstallationForUser(
  workspaceId: string,
  userId: string,
  installation: {
    installationId: string;
    accountLogin: string;
  },
): Promise<GithubInstallation> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const record = await prisma.githubInstallation.upsert({
    where: { githubInstallationId: installation.installationId },
    update: {
      workspaceId,
      githubAccountLogin: installation.accountLogin,
    },
    create: {
      id: createId("ghinst"),
      workspaceId,
      githubInstallationId: installation.installationId,
      githubAccountLogin: installation.accountLogin,
    },
  });
  return mapInstallationRecord(record);
}

export async function removeGithubInstallationForUser(
  workspaceId: string,
  userId: string,
  installationRecordId: string,
): Promise<{ removedInstallationId: string }> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  const prisma = getPrismaClient();
  const installation = await prisma.githubInstallation.findUnique({
    where: { id: installationRecordId },
  });
  if (!installation || installation.workspaceId !== workspaceId) {
    throw statusError(404, `GitHub installation not found: ${installationRecordId}`);
  }
  await markSourcesForGithubInstallationRepair(
    installation.workspaceId,
    installation.githubInstallationId,
    "The linked GitHub App installation was unlinked from this workspace. Reconnect it in workspace settings, then retry verification.",
  );
  await prisma.githubInstallation.delete({
    where: { id: installationRecordId },
  });
  return {
    removedInstallationId: installationRecordId,
  };
}

export async function registerGithubInstallationForIntent(
  intentId: string,
  nonce: string,
  installation: {
    installationId: string;
    accountLogin: string;
  },
): Promise<{ installation: GithubInstallation; intent: GithubInstallIntent }> {
  const intent = await consumeGithubInstallIntent(intentId);
  if (!intent) {
    throw statusError(410, "GitHub install intent is missing, expired, or already consumed.");
  }
  if (intent.nonce !== nonce) {
    throw statusError(400, "GitHub install intent nonce did not match.");
  }
  const prisma = getPrismaClient();
  const record = await prisma.githubInstallation.upsert({
    where: { githubInstallationId: installation.installationId },
    update: {
      workspaceId: intent.workspaceId,
      githubAccountLogin: installation.accountLogin,
    },
    create: {
      id: createId("ghinst"),
      workspaceId: intent.workspaceId,
      githubInstallationId: installation.installationId,
      githubAccountLogin: installation.accountLogin,
    },
  });
  return {
    installation: mapInstallationRecord(record),
    intent,
  };
}

export async function removeGithubInstallationByInstallationId(
  installationId: string,
): Promise<{ installationCount: number }> {
  const prisma = getPrismaClient();
  const existing = await prisma.githubInstallation.findUnique({
    where: { githubInstallationId: installationId },
  });
  if (!existing) {
    return { installationCount: 0 };
  }
  await markSourcesForGithubInstallationRepair(
    existing.workspaceId,
    existing.githubInstallationId,
    "The linked GitHub App installation was removed. Reconnect it in workspace settings, then retry verification.",
  );
  await prisma.githubInstallation.delete({
    where: { githubInstallationId: installationId },
  });
  const installationCount = await prisma.githubInstallation.count({
    where: { workspaceId: existing.workspaceId },
  });
  return { installationCount };
}

export async function applyGithubWebhookToDatabase(input: {
  workspaceId: string;
  action: "created" | "deleted";
  installationId: string;
  accountLogin: string;
}): Promise<{ received: true; provider: "github"; installationCount: number }> {
  const prisma = getPrismaClient();
  if (input.action === "deleted") {
    await markSourcesForGithubInstallationRepair(
      input.workspaceId,
      input.installationId,
      "The linked GitHub App installation was removed. Reconnect it in workspace settings, then retry verification.",
    );
    await prisma.githubInstallation.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        githubInstallationId: input.installationId,
      },
    });
    const installationCount = await prisma.githubInstallation.count({
      where: { workspaceId: input.workspaceId },
    });
    return { received: true, provider: "github", installationCount };
  }

  await prisma.githubInstallation.upsert({
    where: { githubInstallationId: input.installationId },
    update: {
      workspaceId: input.workspaceId,
      githubAccountLogin: input.accountLogin,
    },
    create: {
      id: createId("ghinst"),
      workspaceId: input.workspaceId,
      githubInstallationId: input.installationId,
      githubAccountLogin: input.accountLogin,
    },
  });
  const installationCount = await prisma.githubInstallation.count({
    where: { workspaceId: input.workspaceId },
  });
  return { received: true, provider: "github", installationCount };
}

export async function registerGithubWebhookTarget(
  input: GithubGatewayRegisterInput & {
    expiresAt: Date;
  },
): Promise<GithubWebhookTarget> {
  const parsed = githubGatewayRegisterInputSchema.parse(input);
  const prisma = getPrismaClient();
  const record = await prisma.githubWebhookTarget.upsert({
    where: {
      environmentLabel_kind: {
        environmentLabel: parsed.environmentLabel,
        kind: parsed.kind,
      },
    },
    update: {
      appUrl: parsed.appUrl,
      webhookForwardUrl: parsed.webhookForwardUrl,
      status: "active",
      expiresAt: input.expiresAt,
      lastSeenAt: new Date(),
    },
    create: {
      id: createId("ghwtarget"),
      environmentLabel: parsed.environmentLabel,
      appUrl: parsed.appUrl,
      webhookForwardUrl: parsed.webhookForwardUrl,
      kind: parsed.kind,
      status: "active",
      expiresAt: input.expiresAt,
      lastSeenAt: new Date(),
    },
  });
  return mapGithubWebhookTargetRecord(record);
}

export async function listActiveGithubWebhookTargets(now = new Date()): Promise<GithubWebhookTarget[]> {
  const prisma = getPrismaClient();
  const records = await prisma.githubWebhookTarget.findMany({
    where: {
      status: "active",
      expiresAt: { gt: now },
    },
    orderBy: [
      { kind: "asc" },
      { environmentLabel: "asc" },
    ],
  });
  return records.map(mapGithubWebhookTargetRecord);
}

export async function expireGithubWebhookTargets(now = new Date()): Promise<number> {
  const prisma = getPrismaClient();
  const result = await prisma.githubWebhookTarget.updateMany({
    where: {
      status: "active",
      expiresAt: { lte: now },
    },
    data: {
      status: "inactive",
    },
  });
  return result.count;
}

function mapAiSkillRecord(skill: Prisma.AiSkillGetPayload<Record<string, never>>): AiSkill {
  return aiSkillSchema.parse({
    id: skill.id,
    name: skill.name,
    description: skill.description ?? null,
    instructions: skill.instructions,
    toolCapabilities: normalizeAiToolCapabilities(skill.toolCapabilitiesJson),
    order: skill.order,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  });
}

function mapAiRoleRecord(role: HydratedAiRoleRecord): AiRole {
  return aiRoleSchema.parse({
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    prompt: role.prompt,
    order: role.order,
    consoleVisibility: role.consoleVisibility,
    executorKind: role.executorKind === "native" || role.executorKind === "hybrid" ? role.executorKind : "codex",
    nativeExecutorId: role.nativeExecutorId ?? null,
    dependsOnRoleIds: role.dependencies.map(link => link.dependsOnRole.id),
    skills: role.skills.map(link => ({
      id: link.skill.id,
      name: link.skill.name,
    })),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  });
}

function mapAiAgentRecord(agent: Prisma.AiAgentGetPayload<{
  include: { roles: { include: { role: true }; orderBy: { order: "asc" } } };
}>): AiAgent {
  return aiAgentSchema.parse({
    id: agent.id,
    name: agent.name,
    description: agent.description ?? null,
    order: agent.order,
    roles: agent.roles.map(link => ({
      id: link.role.id,
      name: link.role.name,
      order: link.order,
    })),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  });
}

type CodexAuthScopeTarget =
  | { scope: "global" }
  | { scope: "user"; userId: string }
  | { scope: "workspace"; workspaceId: string };

function buildCodexAuthScopeKey(target: CodexAuthScopeTarget): string {
  switch (target.scope) {
    case "global":
      return "codex:global";
    case "user":
      return `codex:user:${target.userId}`;
    case "workspace":
      return `codex:workspace:${target.workspaceId}`;
  }
}

function normalizeCodexAuthScope(value: string | null | undefined, scopeKey: string | null | undefined): CodexAuthStatus["scope"] {
  if (value === "user" || value === "workspace" || value === "global") {
    return value;
  }
  if (scopeKey?.startsWith("codex:user:")) {
    return "user";
  }
  if (scopeKey?.startsWith("codex:workspace:")) {
    return "workspace";
  }
  return "global";
}

function mapCodexAuthRecord(
  record: Prisma.AiAuthGetPayload<Record<string, never>> | null,
  scope: CodexAuthStatus["scope"] = "global",
): CodexAuthStatus {
  if (!record) {
    return codexAuthStatusSchema.parse({
      scope,
      status: "unauthenticated",
    });
  }
  const resolvedScope = normalizeCodexAuthScope(record.scopeType, record.scopeKey ?? record.id);
  return codexAuthStatusSchema.parse({
    scope: resolvedScope,
    status: record.status,
    authMode: record.authMode ?? null,
    accountId: record.accountId ?? null,
    userCode: record.userCode ?? null,
    verificationUri: record.verificationUri ?? null,
    verificationUriComplete: record.verificationUriComplete ?? null,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    intervalSeconds: record.intervalSeconds ?? null,
    lastError: record.lastError ?? null,
    lastRefresh: record.lastRefreshAt ? record.lastRefreshAt.toISOString() : null,
    disabled: record.disabled === true,
  });
}

function resolveCodexAuthFilePath(): string | null {
  const explicitPath = process.env.CODEX_AUTH_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) {
    return path.join(codexHome, "auth.json");
  }
  const home = process.env.HOME?.trim();
  if (home) {
    return path.join(home, ".codex", "auth.json");
  }
  return null;
}

function readCodexAuthFileFallback(): {
  tokens: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  };
  lastRefresh: string | null;
} | null {
  const authPath = resolveCodexAuthFilePath();
  if (!authPath || !fs.existsSync(authPath)) {
    return null;
  }

  const raw = fs.readFileSync(authPath, "utf8");
  const tokens = parseCodexAuthFile(raw);
  if (!tokens) {
    return null;
  }

  let lastRefresh: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { last_refresh?: unknown };
    if (typeof parsed.last_refresh === "string" && parsed.last_refresh.trim().length > 0) {
      lastRefresh = parsed.last_refresh;
    }
  } catch {
    // Ignore malformed metadata if the token payload parsed successfully.
  }

  return { tokens, lastRefresh };
}

function maskCodexAuthStatusForSelection(status: CodexAuthStatus): CodexAuthStatus {
  return codexAuthStatusSchema.parse({
    ...status,
    accountId: null,
    userCode: null,
    verificationUri: null,
    verificationUriComplete: null,
    expiresAt: null,
    intervalSeconds: null,
    lastError: null,
  });
}

function decodeJwtExpiryMs(token: string | null | undefined): number | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function decodeIsoTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectPreferredCodexTokenSource(options: {
  stored: {
    tokens: {
      accessToken: string;
      refreshToken: string | null;
      idToken: string | null;
      accountId: string | null;
    };
    lastRefresh: string | null;
  } | null;
  fallback: {
    tokens: {
      accessToken: string;
      refreshToken: string | null;
      idToken: string | null;
      accountId: string | null;
    };
    lastRefresh: string | null;
  } | null;
}): {
  tokens: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  };
  source: "stored" | "fallback";
} | null {
  const { stored, fallback } = options;
  if (!stored && !fallback) {
    return null;
  }
  if (!stored) {
    return { tokens: fallback!.tokens, source: "fallback" };
  }
  if (!fallback) {
    return { tokens: stored.tokens, source: "stored" };
  }

  const storedAccessExpiry = decodeJwtExpiryMs(stored.tokens.accessToken);
  const fallbackAccessExpiry = decodeJwtExpiryMs(fallback.tokens.accessToken);

  if (storedAccessExpiry !== null || fallbackAccessExpiry !== null) {
    if (storedAccessExpiry === null) {
      return { tokens: fallback.tokens, source: "fallback" };
    }
    if (fallbackAccessExpiry === null) {
      return { tokens: stored.tokens, source: "stored" };
    }
    if (fallbackAccessExpiry > storedAccessExpiry) {
      return { tokens: fallback.tokens, source: "fallback" };
    }
    return { tokens: stored.tokens, source: "stored" };
  }

  const storedRefreshTime = decodeIsoTimestampMs(stored.lastRefresh);
  const fallbackRefreshTime = decodeIsoTimestampMs(fallback.lastRefresh);
  if (storedRefreshTime !== null || fallbackRefreshTime !== null) {
    if (storedRefreshTime === null) {
      return { tokens: fallback.tokens, source: "fallback" };
    }
    if (fallbackRefreshTime === null) {
      return { tokens: stored.tokens, source: "stored" };
    }
    if (fallbackRefreshTime > storedRefreshTime) {
      return { tokens: fallback.tokens, source: "fallback" };
    }
  }

  return { tokens: stored.tokens, source: "stored" };
}

function normalizeCodexAuthErrorMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "Unknown Codex auth error.";
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = [
      typeof record.message === "string" ? record.message : null,
      typeof record.error_description === "string" ? record.error_description : null,
      typeof record.error === "string" ? record.error : null,
      typeof record.code === "string" ? `code: ${record.code}` : null,
      typeof record.type === "string" ? `type: ${record.type}` : null,
      typeof record.param === "string" ? `param: ${record.param}` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" | ");
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function getCodexAuthRecordForTarget(
  target: CodexAuthScopeTarget,
): Promise<Prisma.AiAuthGetPayload<Record<string, never>> | null> {
  return getPrismaClient().aiAuth.findUnique({
    where: { id: buildCodexAuthScopeKey(target) },
  });
}

function buildCodexAuthRecordSeed(target: CodexAuthScopeTarget) {
  const key = buildCodexAuthScopeKey(target);
  return {
    id: key,
    scopeKey: key,
    scopeType: target.scope,
  };
}

async function upsertCodexAuthRecord(
  target: CodexAuthScopeTarget,
  data: Prisma.AiAuthUncheckedUpdateInput,
): Promise<Prisma.AiAuthGetPayload<Record<string, never>>> {
  const prisma = getPrismaClient();
  const seed = buildCodexAuthRecordSeed(target);
  return prisma.aiAuth.upsert({
    where: { id: seed.id },
    update: data,
    create: {
      ...(data as Prisma.AiAuthUncheckedCreateInput),
      ...seed,
    },
  });
}

async function getCodexAuthStatusForTarget(
  target: CodexAuthScopeTarget,
  options: { allowGlobalLocalFallback?: boolean } = {},
): Promise<CodexAuthStatus> {
  const record = await getCodexAuthRecordForTarget(target);
  if (!record) {
    if (target.scope === "global" && options.allowGlobalLocalFallback !== false) {
      const fallback = readCodexAuthFileFallback();
      if (fallback) {
        return codexAuthStatusSchema.parse({
          scope: "global",
          status: "ready",
          authMode: "chatgpt",
          accountId: fallback.tokens.accountId,
          lastRefresh: fallback.lastRefresh,
          disabled: false,
        });
      }
    }
    return codexAuthStatusSchema.parse({
      scope: target.scope,
      status: "unauthenticated",
      disabled: false,
    });
  }
  return mapCodexAuthRecord(record, target.scope);
}

function buildStoredCodexTokens(record: Prisma.AiAuthGetPayload<Record<string, never>>): {
  tokens: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  };
  lastRefresh: string | null;
} | null {
  if (!record.accessTokenEncrypted) {
    return null;
  }
  return {
    tokens: {
      accessToken: decryptSecretValue(record.accessTokenEncrypted),
      refreshToken: record.refreshTokenEncrypted ? decryptSecretValue(record.refreshTokenEncrypted) : null,
      idToken: record.idTokenEncrypted ? decryptSecretValue(record.idTokenEncrypted) : null,
      accountId: record.accountId ?? null,
    },
    lastRefresh: record.lastRefreshAt ? record.lastRefreshAt.toISOString() : null,
  };
}

async function getCodexTokensForTarget(
  target: CodexAuthScopeTarget,
  options: { allowGlobalLocalFallback?: boolean } = {},
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
} | null> {
  const record = await getCodexAuthRecordForTarget(target);
  if (record?.disabled) {
    return null;
  }
  if (record && record.status !== "ready") {
    return null;
  }

  const fallback = target.scope === "global" && options.allowGlobalLocalFallback !== false
    ? readCodexAuthFileFallback()
    : null;
  if (!record) {
    return fallback?.tokens ?? null;
  }

  try {
    const stored = buildStoredCodexTokens(record);
    return selectPreferredCodexTokenSource({ stored, fallback })?.tokens ?? null;
  } catch (error) {
    if (fallback) {
      console.warn(
        `[codex-auth] Falling back to local auth file for ${buildCodexAuthScopeKey(target)} because stored Codex tokens could not be decrypted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback.tokens;
    }
    throw error;
  }
}

function createCodexAuthOption(input: {
  scope: CodexAuthOption["scope"];
  label: string;
  description: string;
  status: CodexAuthStatus;
}): CodexAuthOption {
  return codexAuthOptionSchema.parse({
    scope: input.scope,
    label: input.label,
    description: input.description,
    status: maskCodexAuthStatusForSelection(input.status),
    available: input.status.status === "ready" && input.status.disabled !== true,
    selectable: input.status.status === "ready" && input.status.disabled !== true,
  });
}

function buildCodexAuthBinding(target: CodexAuthScopeTarget): PersistedCodexAuthBinding {
  return {
    scope: target.scope,
    recordId: buildCodexAuthScopeKey(target),
  };
}

function parseCodexAuthBinding(recordId: string): CodexAuthScopeTarget | null {
  if (recordId === "codex:global") {
    return { scope: "global" };
  }
  if (recordId.startsWith("codex:user:")) {
    return { scope: "user", userId: recordId.slice("codex:user:".length) };
  }
  if (recordId.startsWith("codex:workspace:")) {
    return { scope: "workspace", workspaceId: recordId.slice("codex:workspace:".length) };
  }
  return null;
}

async function resolveDefaultCodexAuthBinding(
  workspaceId: string,
  userId: string,
): Promise<PersistedCodexAuthBinding | null> {
  const candidates: CodexAuthScopeTarget[] = [
    { scope: "user", userId },
    { scope: "workspace", workspaceId },
    { scope: "global" },
  ];
  for (const candidate of candidates) {
    const status = await getCodexAuthStatusForTarget(candidate);
    if (status.status === "ready" && status.disabled !== true) {
      return buildCodexAuthBinding(candidate);
    }
  }
  return null;
}

async function resolveFollowOnCodexAuthBinding(
  workspaceId: string,
  userId: string,
  inheritedBinding: PersistedCodexAuthBinding | null,
): Promise<PersistedCodexAuthBinding | null> {
  if (!inheritedBinding) {
    return resolveDefaultCodexAuthBinding(workspaceId, userId);
  }
  if (inheritedBinding.scope !== "user") {
    return inheritedBinding;
  }

  const inheritedTarget = parseCodexAuthBinding(inheritedBinding.recordId);
  if (inheritedTarget?.scope === "user" && inheritedTarget.userId === userId) {
    return inheritedBinding;
  }

  return resolveDefaultCodexAuthBinding(workspaceId, userId);
}

export async function getCodexAuthSelectionForWorkspace(
  workspaceId: string,
  userId: string,
): Promise<CodexAuthSelection> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  const [userStatus, workspaceStatus, globalStatus] = await Promise.all([
    getCodexAuthStatusForTarget({ scope: "user", userId }, { allowGlobalLocalFallback: false }),
    getCodexAuthStatusForTarget({ scope: "workspace", workspaceId }, { allowGlobalLocalFallback: false }),
    getCodexAuthStatusForTarget({ scope: "global" }),
  ]);
  const selected = await resolveDefaultCodexAuthBinding(workspaceId, userId);
  return codexAuthSelectionSchema.parse({
    selectedScope: selected?.scope ?? null,
    options: [
      createCodexAuthOption({
        scope: "user",
        label: "My Codex auth",
        description: "Use the Codex session stored on your own user account.",
        status: userStatus,
      }),
      createCodexAuthOption({
        scope: "workspace",
        label: "Workspace Codex auth",
        description: "Use the shared Codex session configured for this workspace.",
        status: workspaceStatus,
      }),
      createCodexAuthOption({
        scope: "global",
        label: "Global Codex auth",
        description: globalStatus.disabled
          ? "Admin disabled the shared global Codex fallback."
          : "Use the admin-managed global Codex fallback for this workspace run.",
        status: globalStatus,
      }),
    ],
  });
}

export async function resolveCodexAuthBindingForJob(
  workspaceId: string,
  userId: string,
  requestedScope?: "user" | "workspace" | "global" | null,
): Promise<PersistedCodexAuthBinding | null> {
  await getAccessibleWorkspaceRecord(workspaceId, userId);
  if (!requestedScope) {
    return resolveDefaultCodexAuthBinding(workspaceId, userId);
  }

  const target: CodexAuthScopeTarget = requestedScope === "user"
    ? { scope: "user", userId }
    : requestedScope === "workspace"
      ? { scope: "workspace", workspaceId }
      : { scope: "global" };
  const status = await getCodexAuthStatusForTarget(target, {
    allowGlobalLocalFallback: target.scope === "global",
  });
  if (status.status !== "ready" || status.disabled === true) {
    throw statusError(400, `${requestedScope} Codex auth is not available for this job.`);
  }
  return buildCodexAuthBinding(target);
}

export async function getCodexTokensForBinding(
  binding: PersistedCodexAuthBinding | null,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
} | null> {
  if (!binding) {
    return null;
  }
  const target = parseCodexAuthBinding(binding.recordId);
  if (!target) {
    return null;
  }
  return getCodexTokensForTarget(target, {
    allowGlobalLocalFallback: target.scope === "global",
  });
}

export async function getUserCodexAuthStatus(userId: string): Promise<CodexAuthStatus> {
  return getCodexAuthStatusForTarget({ scope: "user", userId }, { allowGlobalLocalFallback: false });
}

export async function getWorkspaceCodexAuthStatus(workspaceId: string, userId: string): Promise<CodexAuthStatus> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return getCodexAuthStatusForTarget({ scope: "workspace", workspaceId }, { allowGlobalLocalFallback: false });
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  return getCodexAuthStatusForTarget({ scope: "global" });
}

export async function getCodexAuthRecord(): Promise<Prisma.AiAuthGetPayload<Record<string, never>> | null> {
  return getCodexAuthRecordForTarget({ scope: "global" });
}

export async function getUserCodexAuthRecord(userId: string): Promise<Prisma.AiAuthGetPayload<Record<string, never>> | null> {
  return getCodexAuthRecordForTarget({ scope: "user", userId });
}

export async function getWorkspaceCodexAuthRecord(
  workspaceId: string,
  userId: string,
): Promise<Prisma.AiAuthGetPayload<Record<string, never>> | null> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return getCodexAuthRecordForTarget({ scope: "workspace", workspaceId });
}

async function startCodexDeviceFlowForTarget(
  target: CodexAuthScopeTarget,
  payload: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string | null;
    expiresAt: Date;
    intervalSeconds?: number | null;
  },
): Promise<CodexAuthStatus> {
  const record = await upsertCodexAuthRecord(target, {
    status: "pending",
    authMode: "chatgpt",
    deviceCode: payload.deviceCode,
    userCode: payload.userCode,
    verificationUri: payload.verificationUri,
    verificationUriComplete: payload.verificationUriComplete ?? null,
    expiresAt: payload.expiresAt,
    intervalSeconds: payload.intervalSeconds ?? null,
    lastError: null,
  });
  return mapCodexAuthRecord(record, target.scope);
}

export async function startCodexDeviceFlow(payload: {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  expiresAt: Date;
  intervalSeconds?: number | null;
}): Promise<CodexAuthStatus> {
  return startCodexDeviceFlowForTarget({ scope: "global" }, payload);
}

export async function startUserCodexDeviceFlow(
  userId: string,
  payload: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string | null;
    expiresAt: Date;
    intervalSeconds?: number | null;
  },
): Promise<CodexAuthStatus> {
  return startCodexDeviceFlowForTarget({ scope: "user", userId }, payload);
}

export async function startWorkspaceCodexDeviceFlow(
  workspaceId: string,
  userId: string,
  payload: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string | null;
    expiresAt: Date;
    intervalSeconds?: number | null;
  },
): Promise<CodexAuthStatus> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return startCodexDeviceFlowForTarget({ scope: "workspace", workspaceId }, payload);
}

async function storeCodexTokensForTarget(
  target: CodexAuthScopeTarget,
  payload: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  },
): Promise<CodexAuthStatus> {
  const record = await upsertCodexAuthRecord(target, {
    status: "ready",
    authMode: "chatgpt",
    accountId: payload.accountId ?? null,
    deviceCode: null,
    userCode: null,
    verificationUri: null,
    verificationUriComplete: null,
    expiresAt: null,
    intervalSeconds: null,
    accessTokenEncrypted: encryptSecretValue(payload.accessToken),
    refreshTokenEncrypted: payload.refreshToken ? encryptSecretValue(payload.refreshToken) : null,
    idTokenEncrypted: payload.idToken ? encryptSecretValue(payload.idToken) : null,
    lastRefreshAt: new Date(),
    lastError: null,
  });
  return mapCodexAuthRecord(record, target.scope);
}

export async function storeCodexTokens(payload: {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
}): Promise<CodexAuthStatus> {
  return storeCodexTokensForTarget({ scope: "global" }, payload);
}

export async function storeUserCodexTokens(
  userId: string,
  payload: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  },
): Promise<CodexAuthStatus> {
  return storeCodexTokensForTarget({ scope: "user", userId }, payload);
}

export async function storeWorkspaceCodexTokens(
  workspaceId: string,
  userId: string,
  payload: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  },
): Promise<CodexAuthStatus> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return storeCodexTokensForTarget({ scope: "workspace", workspaceId }, payload);
}

export async function storeCodexTokensForBinding(
  binding: PersistedCodexAuthBinding | null,
  payload: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    accountId: string | null;
  },
): Promise<CodexAuthStatus> {
  if (!binding) {
    return storeCodexTokens(payload);
  }
  const target = parseCodexAuthBinding(binding.recordId);
  if (!target) {
    return storeCodexTokens(payload);
  }
  return storeCodexTokensForTarget(target, payload);
}

export async function setCodexAuthErrorForBinding(
  binding: PersistedCodexAuthBinding | null,
  message: unknown,
): Promise<CodexAuthStatus> {
  if (!binding) {
    return setCodexAuthErrorForTarget({ scope: "global" }, message);
  }
  const target = parseCodexAuthBinding(binding.recordId);
  if (!target) {
    return setCodexAuthErrorForTarget({ scope: "global" }, message);
  }
  return setCodexAuthErrorForTarget(target, message);
}

async function importCodexTokensFromLocalAuthFileForTarget(target: CodexAuthScopeTarget): Promise<CodexAuthStatus> {
  const fallback = readCodexAuthFileFallback();
  if (!fallback) {
    throw statusError(404, "No local Codex auth file is available.");
  }
  return storeCodexTokensForTarget(target, fallback.tokens);
}

export async function importCodexTokensFromLocalAuthFile(): Promise<CodexAuthStatus> {
  return importCodexTokensFromLocalAuthFileForTarget({ scope: "global" });
}

export async function importUserCodexTokensFromLocalAuthFile(userId: string): Promise<CodexAuthStatus> {
  return importCodexTokensFromLocalAuthFileForTarget({ scope: "user", userId });
}

export async function importWorkspaceCodexTokensFromLocalAuthFile(
  workspaceId: string,
  userId: string,
): Promise<CodexAuthStatus> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return importCodexTokensFromLocalAuthFileForTarget({ scope: "workspace", workspaceId });
}

export async function getCodexTokens(): Promise<{
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
} | null> {
  return getCodexTokensForTarget({ scope: "global" });
}

async function clearCodexAuthForTarget(target: CodexAuthScopeTarget): Promise<CodexAuthStatus> {
  const record = await upsertCodexAuthRecord(target, {
    status: "unauthenticated",
    authMode: null,
    accountId: null,
    deviceCode: null,
    userCode: null,
    verificationUri: null,
    verificationUriComplete: null,
    expiresAt: null,
    intervalSeconds: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    idTokenEncrypted: null,
    lastRefreshAt: null,
    lastError: null,
  });
  return mapCodexAuthRecord(record, target.scope);
}

export async function clearCodexAuth(): Promise<CodexAuthStatus> {
  return clearCodexAuthForTarget({ scope: "global" });
}

export async function clearUserCodexAuth(userId: string): Promise<CodexAuthStatus> {
  return clearCodexAuthForTarget({ scope: "user", userId });
}

export async function clearWorkspaceCodexAuth(workspaceId: string, userId: string): Promise<CodexAuthStatus> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return clearCodexAuthForTarget({ scope: "workspace", workspaceId });
}

async function setCodexAuthErrorForTarget(target: CodexAuthScopeTarget, message: unknown): Promise<CodexAuthStatus> {
  const normalizedMessage = normalizeCodexAuthErrorMessage(message);
  const record = await upsertCodexAuthRecord(target, {
    status: "error",
    lastError: normalizedMessage,
  });
  return mapCodexAuthRecord(record, target.scope);
}

export async function setCodexAuthError(message: unknown): Promise<CodexAuthStatus> {
  return setCodexAuthErrorForTarget({ scope: "global" }, message);
}

export async function setUserCodexAuthError(userId: string, message: unknown): Promise<CodexAuthStatus> {
  return setCodexAuthErrorForTarget({ scope: "user", userId }, message);
}

export async function setWorkspaceCodexAuthError(
  workspaceId: string,
  userId: string,
  message: unknown,
): Promise<CodexAuthStatus> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  return setCodexAuthErrorForTarget({ scope: "workspace", workspaceId }, message);
}

export async function setGlobalCodexAuthDisabled(disabled: boolean): Promise<CodexAuthStatus> {
  const existing = await getCodexAuthRecordForTarget({ scope: "global" });
  const record = await upsertCodexAuthRecord({ scope: "global" }, existing
    ? { disabled }
    : {
        status: "unauthenticated",
        disabled,
      });
  return mapCodexAuthRecord(record, "global");
}

function normalizeRoleDependencies(roleId: string | null, dependsOnRoleIds: string[] | undefined): string[] {
  const normalized = [...new Set((dependsOnRoleIds ?? []).map(value => value.trim()).filter(Boolean))];
  if (roleId && normalized.includes(roleId)) {
    throw statusError(400, "A role cannot depend on itself.");
  }
  return normalized;
}

export async function listAiSkills(): Promise<AiSkill[]> {
  const prisma = getPrismaClient();
  const skills = await prisma.aiSkill.findMany({ orderBy: { order: "asc" } });
  return skills.map(mapAiSkillRecord);
}

export async function createAiSkill(input: CreateAiSkillInput): Promise<AiSkill> {
  const prisma = getPrismaClient();
  const skill = await prisma.aiSkill.create({
    data: {
      id: createId("aiskill"),
      name: input.name,
      description: input.description ?? null,
      instructions: input.instructions,
      toolCapabilitiesJson: input.toolCapabilities ?? [],
      order: input.order ?? 0,
    },
  });
  return mapAiSkillRecord(skill);
}

export async function updateAiSkill(skillId: string, input: CreateAiSkillInput): Promise<AiSkill> {
  const prisma = getPrismaClient();
  const skill = await prisma.aiSkill.update({
    where: { id: skillId },
    data: {
      name: input.name,
      description: input.description ?? null,
      instructions: input.instructions,
      toolCapabilitiesJson: input.toolCapabilities ?? [],
      order: input.order ?? 0,
    },
  });
  return mapAiSkillRecord(skill);
}

export async function deleteAiSkill(skillId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.aiSkill.delete({ where: { id: skillId } });
}

export async function listAiRoles(): Promise<AiRole[]> {
  const prisma = getPrismaClient();
  const roles = await prisma.aiRole.findMany({
    orderBy: { order: "asc" },
    include: {
      skills: { include: { skill: true }, orderBy: { order: "asc" } },
      dependencies: { include: { dependsOnRole: true }, orderBy: { order: "asc" } },
    },
  });
  return roles.map(mapAiRoleRecord);
}

export async function createAiRole(input: CreateAiRoleInput): Promise<AiRole> {
  const prisma = getPrismaClient();
  const roleId = createId("airole");
  const dependencyIds = normalizeRoleDependencies(roleId, input.dependsOnRoleIds);
  const createData: Prisma.AiRoleUncheckedCreateInput = {
    id: roleId,
    name: input.name,
    description: input.description ?? null,
    prompt: input.prompt,
    order: input.order ?? 0,
    consoleVisibility: input.consoleVisibility ?? "normal",
    executorKind: input.executorKind ?? "codex",
    nativeExecutorId: input.nativeExecutorId ?? null,
  };
  const role = await prisma.aiRole.create({
    data: createData,
  });
  if (input.skillIds && input.skillIds.length > 0) {
    await prisma.aiRoleSkill.createMany({
      data: input.skillIds.map((skillId, index) => ({
        roleId: role.id,
        skillId,
        order: index,
      })),
      skipDuplicates: true,
    });
  }
  if (dependencyIds.length > 0) {
    await prisma.aiRoleDependency.createMany({
      data: dependencyIds.map((dependsOnRoleId, index) => ({
        roleId: role.id,
        dependsOnRoleId,
        order: index,
      })),
      skipDuplicates: true,
    });
  }
  const hydrated = await prisma.aiRole.findUniqueOrThrow({
    where: { id: role.id },
    include: {
      skills: { include: { skill: true }, orderBy: { order: "asc" } },
      dependencies: { include: { dependsOnRole: true }, orderBy: { order: "asc" } },
    },
  });
  return mapAiRoleRecord(hydrated);
}

export async function updateAiRole(roleId: string, input: CreateAiRoleInput): Promise<AiRole> {
  const prisma = getPrismaClient();
  const dependencyIds = normalizeRoleDependencies(roleId, input.dependsOnRoleIds);
  const updateData: Prisma.AiRoleUncheckedUpdateInput = {
    name: input.name,
    description: input.description ?? null,
    prompt: input.prompt,
    order: input.order ?? 0,
    consoleVisibility: input.consoleVisibility ?? "normal",
    executorKind: input.executorKind ?? "codex",
    nativeExecutorId: input.nativeExecutorId ?? null,
  };
  await prisma.$transaction(async tx => {
    await tx.aiRole.update({
      where: { id: roleId },
      data: updateData,
    });
    await tx.aiRoleSkill.deleteMany({ where: { roleId } });
    await tx.aiRoleDependency.deleteMany({ where: { roleId } });
    if (input.skillIds && input.skillIds.length > 0) {
      await tx.aiRoleSkill.createMany({
        data: input.skillIds.map((skillId, index) => ({
          roleId,
          skillId,
          order: index,
        })),
        skipDuplicates: true,
      });
    }
    if (dependencyIds.length > 0) {
      await tx.aiRoleDependency.createMany({
        data: dependencyIds.map((dependsOnRoleId, index) => ({
          roleId,
          dependsOnRoleId,
          order: index,
        })),
        skipDuplicates: true,
      });
    }
  });
  const hydrated = await prisma.aiRole.findUniqueOrThrow({
    where: { id: roleId },
    include: {
      skills: { include: { skill: true }, orderBy: { order: "asc" } },
      dependencies: { include: { dependsOnRole: true }, orderBy: { order: "asc" } },
    },
  });
  return mapAiRoleRecord(hydrated);
}

export async function deleteAiRole(roleId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.aiRole.delete({ where: { id: roleId } });
}

export async function listAiAgents(): Promise<AiAgent[]> {
  const prisma = getPrismaClient();
  const agents = await prisma.aiAgent.findMany({
    orderBy: { order: "asc" },
    include: {
      roles: { include: { role: true }, orderBy: { order: "asc" } },
    },
  });
  return agents.map(mapAiAgentRecord);
}

export async function listAiAnalysisTasks(): Promise<AnalysisTask[]> {
  const prisma = getPrismaClient();
  const includeInternalE2eTasks = exposeInternalE2eTasks();
  const agents = await prisma.aiAgent.findMany({
    orderBy: { order: "asc" },
    include: {
      roles: {
        include: {
          role: {
            include: {
              skills: {
                include: { skill: true },
                orderBy: { order: "asc" },
              },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  return agents
    .filter(agent => includeInternalE2eTasks || !agent.id.startsWith("agent-e2e-"))
    .map(agent => {
    const skillNames = [...new Set(
      agent.roles.flatMap(link => link.role.skills.map(skillLink => skillLink.skill.name)),
    )];
    const toolCapabilities = normalizeAiToolCapabilities(
      agent.roles.flatMap(link => link.role.skills.flatMap(skillLink => normalizeAiToolCapabilities(skillLink.skill.toolCapabilitiesJson))),
    );

    return analysisTaskSchema.parse({
      id: agent.id,
      agentId: agent.id,
      title: agent.name,
      description: agent.description ?? null,
      roleCount: agent.roles.length,
      roles: agent.roles.map(link => ({
        id: link.role.id,
        name: link.role.name,
        description: link.role.description ?? null,
        order: link.order,
        executorKind: link.role.executorKind,
        nativeExecutorId: link.role.nativeExecutorId ?? null,
      })),
      skillNames,
      toolCapabilities,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    });
    });
}

export async function createAiAgent(input: CreateAiAgentInput): Promise<AiAgent> {
  const prisma = getPrismaClient();
  const agent = await prisma.aiAgent.create({
    data: {
      id: createId("aiagent"),
      name: input.name,
      description: input.description ?? null,
      order: input.order ?? 0,
    },
  });
  if (input.roleIds && input.roleIds.length > 0) {
    await prisma.aiAgentRole.createMany({
      data: input.roleIds.map((roleId, index) => ({
        agentId: agent.id,
        roleId,
        order: index,
      })),
    });
  }
  const hydrated = await prisma.aiAgent.findUniqueOrThrow({
    where: { id: agent.id },
    include: {
      roles: { include: { role: true }, orderBy: { order: "asc" } },
    },
  });
  return mapAiAgentRecord(hydrated);
}

export async function updateAiAgent(agentId: string, input: CreateAiAgentInput): Promise<AiAgent> {
  const prisma = getPrismaClient();
  await prisma.$transaction(async tx => {
    await tx.aiAgent.update({
      where: { id: agentId },
      data: {
        name: input.name,
        description: input.description ?? null,
        order: input.order ?? 0,
      },
    });
    await tx.aiAgentRole.deleteMany({ where: { agentId } });
    if (input.roleIds && input.roleIds.length > 0) {
      await tx.aiAgentRole.createMany({
        data: input.roleIds.map((roleId, index) => ({
          agentId,
          roleId,
          order: index,
        })),
      });
    }
  });
  const hydrated = await prisma.aiAgent.findUniqueOrThrow({
    where: { id: agentId },
    include: {
      roles: { include: { role: true }, orderBy: { order: "asc" } },
    },
  });
  return mapAiAgentRecord(hydrated);
}

export async function deleteAiAgent(agentId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.aiAgent.delete({ where: { id: agentId } });
}

export async function getAiAgentExecutionPlan(agentId: string): Promise<{
  agent: { id: string; name: string; description: string | null };
  roles: Array<{
    id: string;
    name: string;
    description: string | null;
    prompt: string;
    order: number;
    consoleVisibility: "normal" | "quiet";
    executorKind: AiRoleExecutorKind;
    nativeExecutorId: string | null;
    dependsOnRoleIds: string[];
    skills: Array<{ id: string; name: string; instructions: string; toolCapabilities: AiToolCapability[]; order: number }>;
  }>;
}> {
  const prisma = getPrismaClient();
  const agent = await prisma.aiAgent.findUnique({
    where: { id: agentId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              skills: { include: { skill: true }, orderBy: { order: "asc" } },
              dependencies: { include: { dependsOnRole: true }, orderBy: { order: "asc" } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!agent) {
    throw statusError(404, `AI agent not found: ${agentId}`);
  }
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description ?? null,
    },
    roles: agent.roles.map(link => {
      const hydratedRole = link.role as HydratedAiRoleRecord;
      return {
        id: hydratedRole.id,
        name: hydratedRole.name,
        description: hydratedRole.description ?? null,
        prompt: hydratedRole.prompt,
      order: link.order,
        consoleVisibility: hydratedRole.consoleVisibility === "quiet" ? "quiet" : "normal",
        executorKind: hydratedRole.executorKind === "native" || hydratedRole.executorKind === "hybrid" ? hydratedRole.executorKind : "codex",
        nativeExecutorId: hydratedRole.nativeExecutorId ?? null,
        dependsOnRoleIds: hydratedRole.dependencies.map(dependency => dependency.dependsOnRole.id),
        skills: hydratedRole.skills.map(skillLink => ({
        id: skillLink.skill.id,
        name: skillLink.skill.name,
        instructions: skillLink.skill.instructions,
        toolCapabilities: normalizeAiToolCapabilities(skillLink.skill.toolCapabilitiesJson),
        order: skillLink.order,
      })),
      };
    }),
  };
}
