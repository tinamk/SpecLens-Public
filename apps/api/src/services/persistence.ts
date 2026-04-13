import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AnalysisJob,
  AnalysisLogEvent,
  AnalysisReport,
  ArtifactReference,
  BillingSubscription,
  GithubInstallation,
  JobEnvelope,
  Source,
  User,
  Workspace,
  WorkspaceMembership,
  WorkspaceSecret,
} from "@speclens/contracts";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@speclens/db";
import type { AppState } from "./state";

interface PersistedState {
  users: Array<[string, AppState["users"] extends Map<string, infer V> ? V : never]>;
  workspaces: Array<[string, AppState["workspaces"] extends Map<string, infer V> ? V : never]>;
  memberships: Array<[string, AppState["memberships"] extends Map<string, infer V> ? V : never]>;
  secrets: Array<[string, AppState["secrets"] extends Map<string, infer V> ? V : never]>;
  secretValues: Array<[string, Array<[string, string]>]>;
  sources: Array<[string, AppState["sources"] extends Map<string, infer V> ? V : never]>;
  jobs: Array<[string, AppState["jobs"] extends Map<string, infer V> ? V : never]>;
  subscriptions: Array<[string, AppState["subscriptions"] extends Map<string, infer V> ? V : never]>;
  githubInstallations: Array<[string, AppState["githubInstallations"] extends Map<string, infer V> ? V : never]>;
  checkoutSessions: Array<[string, AppState["checkoutSessions"] extends Map<string, infer V> ? V : never]>;
}

type PersistenceBackend = "file" | "prisma";

let persistenceQueue: Promise<void> = Promise.resolve();

function getStatePath(): string {
  return path.resolve(process.cwd(), process.env.APP_STATE_PATH ?? ".speclens-workspace/app-state/hosted-api-state.json");
}

function getPersistenceBackend(): PersistenceBackend {
  return process.env.APP_STATE_BACKEND === "prisma" ? "prisma" : "file";
}

function getEncryptionKey(): Buffer {
  const source = process.env.APP_STATE_ENCRYPTION_KEY ?? "speclens-local-dev-key";
  return crypto.createHash("sha256").update(source).digest();
}

function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(value: string): string {
  const raw = Buffer.from(value, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function snapshotAppState(state: AppState): PersistedState {
  return {
    users: [...state.users.entries()],
    workspaces: [...state.workspaces.entries()],
    memberships: [...state.memberships.entries()],
    secrets: [...state.secrets.entries()],
    secretValues: [...state.secretValues.entries()].map(([workspaceId, values]) => [
      workspaceId,
      [...values.entries()].map(([secretId, value]) => [secretId, encrypt(value)]),
    ]),
    sources: [...state.sources.entries()],
    jobs: [...state.jobs.entries()],
    subscriptions: [...state.subscriptions.entries()],
    githubInstallations: [...state.githubInstallations.entries()],
    checkoutSessions: [...state.checkoutSessions.entries()],
  };
}

function deserializeSnapshot(payload: PersistedState): Partial<AppState> {
  return {
    users: new Map(payload.users),
    workspaces: new Map(payload.workspaces),
    memberships: new Map(payload.memberships),
    secrets: new Map(payload.secrets),
    secretValues: new Map(payload.secretValues.map(([workspaceId, values]) => [
      workspaceId,
      new Map(values.map(([secretId, value]) => [secretId, decrypt(value)])),
    ])),
    sources: new Map(payload.sources),
    jobs: new Map(payload.jobs),
    subscriptions: new Map(payload.subscriptions),
    githubInstallations: new Map(payload.githubInstallations),
    checkoutSessions: new Map(payload.checkoutSessions),
  };
}

function persistFileSnapshot(snapshot: PersistedState): void {
  const filePath = getStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function loadFileSnapshot(): Partial<AppState> | null {
  const filePath = getStatePath();
  if (!fs.existsSync(filePath)) return null;
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as PersistedState;
  return deserializeSnapshot(payload);
}

function asTimestamp(value: string): Date {
  return new Date(value);
}

function asJsonArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? value as T[] : fallback;
}

async function persistPrismaSnapshot(snapshot: PersistedState): Promise<void> {
  const prisma = getPrismaClient();

  const users = snapshot.users.map(([, user]) => user);
  const workspaces = snapshot.workspaces.map(([, workspace]) => workspace);
  const memberships = snapshot.memberships.flatMap(([, items]) => items);
  const secrets = snapshot.secrets.flatMap(([workspaceId, items]) => {
    const valueMap = new Map(snapshot.secretValues.find(([id]) => id === workspaceId)?.[1] ?? []);
    return items.map(secret => ({
      id: secret.id,
      workspaceId: secret.workspaceId,
      name: secret.name,
      kind: secret.kind,
      valuePreview: secret.valuePreview,
      encryptedValue: valueMap.get(secret.id) ?? encrypt(""),
      createdAt: asTimestamp(secret.createdAt),
      updatedAt: asTimestamp(secret.updatedAt),
    }));
  });
  const sources = snapshot.sources.flatMap(([, items]) => items);
  const subscriptions = snapshot.subscriptions.map(([, subscription]) => subscription);
  const installations = snapshot.githubInstallations.flatMap(([, items]) => items);
  const checkoutSessions = snapshot.checkoutSessions.map(([, session]) => session);
  const jobs = snapshot.jobs.map(([, envelope]) => envelope.job);
  const logs = snapshot.jobs.flatMap(([, envelope]) => envelope.logs);
  const reports = snapshot.jobs.flatMap(([, envelope]) => envelope.report ? [envelope.report] : []);
  const artifacts = reports.flatMap(report => report.artifacts.map(artifact => ({
    reportId: report.id,
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
        createdAt: asTimestamp(user.createdAt),
        updatedAt: asTimestamp(user.updatedAt),
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
        createdAt: asTimestamp(workspace.createdAt),
        updatedAt: asTimestamp(workspace.updatedAt),
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
        createdAt: asTimestamp(membership.createdAt),
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
        createdAt: asTimestamp(source.createdAt),
      })),
    });
  }

  if (secrets.length > 0) {
    await prisma.workspaceSecret.createMany({
      data: secrets,
    });
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
        createdAt: asTimestamp(subscription.createdAt),
        updatedAt: asTimestamp(subscription.updatedAt),
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
        createdAt: asTimestamp(installation.createdAt),
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
        createdAt: asTimestamp(session.createdAt),
      })),
    });
  }

  if (jobs.length > 0) {
    await prisma.analysisJob.createMany({
      data: jobs.map(job => ({
        id: job.id,
        workspaceId: job.workspaceId,
        sourceId: job.sourceId,
        reportId: job.reportId,
        status: job.status,
        sourceType: job.sourceType,
        sourceLocation: job.sourceLocation,
        preset: job.preset,
        capabilitiesJson: job.capabilities,
        runtimeMode: job.runtimeMode,
        secretRefsJson: job.secretRefs,
        requestedByUserId: job.requestedByUserId,
        startedAt: job.startedAt ? asTimestamp(job.startedAt) : null,
        finishedAt: job.finishedAt ? asTimestamp(job.finishedAt) : null,
        createdAt: asTimestamp(job.createdAt),
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
        createdAt: asTimestamp(log.createdAt),
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
        preset: report.preset,
        capabilitiesJson: report.capabilities as Prisma.InputJsonValue,
        runtimeMode: report.runtimeMode,
        title: report.title,
        summaryJson: report.summary as Prisma.InputJsonValue,
        findingsJson: report.findings as Prisma.InputJsonValue,
        sectionsJson: report.sections as Prisma.InputJsonValue,
        createdAt: asTimestamp(report.createdAt),
      })),
    });
  }

  if (artifacts.length > 0) {
    await prisma.artifactReference.createMany({
      data: artifacts.map(({ reportId, artifact }) => ({
        id: crypto.randomUUID(),
        reportId,
        objectKey: artifact.key,
        bucket: artifact.bucket,
        region: artifact.region,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        signedUrl: artifact.signedUrl ?? null,
      })),
    });
  }
}

async function loadPrismaSnapshot(): Promise<Partial<AppState>> {
  const prisma = getPrismaClient();
  const [
    users,
    workspaces,
    memberships,
    secrets,
    sources,
    subscriptions,
    installations,
    checkoutSessions,
    jobs,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.workspace.findMany(),
    prisma.workspaceMembership.findMany(),
    prisma.workspaceSecret.findMany(),
    prisma.source.findMany(),
    prisma.billingSubscription.findMany(),
    prisma.githubInstallation.findMany(),
    prisma.checkoutSession.findMany(),
    prisma.analysisJob.findMany({
      include: {
        logs: true,
        report: {
          include: {
            artifacts: true,
          },
        },
      },
    }),
  ]);

  const userMap = new Map<string, User>(users.map(user => [user.id, {
    id: user.id,
    identityProvider: user.identityProvider,
    identitySubject: user.identitySubject,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    entitlement: user.entitlement as User["entitlement"],
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }]));
  const workspaceMap = new Map<string, Workspace>(workspaces.map(workspace => [workspace.id, {
    id: workspace.id,
    ownerUserId: workspace.ownerUserId,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    entitlement: workspace.entitlement as Workspace["entitlement"],
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  }]));

  const membershipMap = new Map<string, WorkspaceMembership[]>();
  for (const membership of memberships) {
    const current = membershipMap.get(membership.workspaceId) ?? [];
    current.push({
      id: membership.id,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: membership.role as WorkspaceMembership["role"],
      createdAt: membership.createdAt.toISOString(),
    });
    membershipMap.set(membership.workspaceId, current);
  }

  const secretMap = new Map<string, WorkspaceSecret[]>();
  const secretValueMap = new Map<string, Map<string, string>>();
  for (const secret of secrets) {
    const current = secretMap.get(secret.workspaceId) ?? [];
    current.push({
      id: secret.id,
      workspaceId: secret.workspaceId,
      name: secret.name,
      kind: secret.kind as WorkspaceSecret["kind"],
      valuePreview: secret.valuePreview,
      createdAt: secret.createdAt.toISOString(),
      updatedAt: secret.updatedAt.toISOString(),
    });
    secretMap.set(secret.workspaceId, current);
    const values = secretValueMap.get(secret.workspaceId) ?? new Map<string, string>();
    values.set(secret.id, decrypt(secret.encryptedValue));
    secretValueMap.set(secret.workspaceId, values);
  }

  const sourceMap = new Map<string, Source[]>();
  for (const source of sources) {
    const current = sourceMap.get(source.workspaceId) ?? [];
    current.push({
      id: source.id,
      workspaceId: source.workspaceId,
      type: source.type as Source["type"],
      displayName: source.displayName,
      location: source.location,
      visibility: source.visibility as Source["visibility"],
      githubInstallationId: source.githubInstallationId,
      uploadObjectKey: source.uploadObjectKey,
      createdAt: source.createdAt.toISOString(),
    });
    sourceMap.set(source.workspaceId, current);
  }

  const subscriptionMap = new Map<string, BillingSubscription>(subscriptions.map(subscription => [subscription.id, {
    id: subscription.id,
    userId: subscription.userId,
    provider: subscription.provider as BillingSubscription["provider"],
    providerCustomerId: subscription.providerCustomerId,
    providerSubscriptionId: subscription.providerSubscriptionId,
    entitlement: subscription.entitlement as BillingSubscription["entitlement"],
    status: subscription.status as BillingSubscription["status"],
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  }]));

  const installationMap = new Map<string, GithubInstallation[]>();
  for (const installation of installations) {
    const current = installationMap.get(installation.workspaceId) ?? [];
    current.push({
      id: installation.id,
      workspaceId: installation.workspaceId,
      githubInstallationId: installation.githubInstallationId,
      githubAccountLogin: installation.githubAccountLogin,
      createdAt: installation.createdAt.toISOString(),
    });
    installationMap.set(installation.workspaceId, current);
  }

  const checkoutSessionMap = new Map(snapshotFromCheckout(checkoutSessions));
  const jobMap = new Map<string, JobEnvelope>(jobs.map(job => {
    const report = job.report ? mapReport(job.report) : null;
    return [job.id, {
      job: {
        id: job.id,
        workspaceId: job.workspaceId,
        sourceId: job.sourceId,
        reportId: report?.id ?? job.reportId,
        status: job.status as AnalysisJob["status"],
        sourceType: job.sourceType as AnalysisJob["sourceType"],
        sourceLocation: job.sourceLocation,
        preset: job.preset as AnalysisJob["preset"],
        capabilities: asJsonArray(job.capabilitiesJson, []),
        runtimeMode: job.runtimeMode as AnalysisJob["runtimeMode"],
        secretRefs: asJsonArray(job.secretRefsJson, []),
        requestedByUserId: job.requestedByUserId,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
      },
      logs: job.logs.map(log => ({
        id: log.id,
        jobId: log.jobId,
        level: log.level as AnalysisLogEvent["level"],
        scope: log.scope,
        message: log.message,
        createdAt: log.createdAt.toISOString(),
      })),
      report,
    }];
  }));

  return {
    users: userMap,
    workspaces: workspaceMap,
    memberships: membershipMap,
    secrets: secretMap,
    secretValues: secretValueMap,
    sources: sourceMap,
    jobs: jobMap,
    subscriptions: subscriptionMap,
    githubInstallations: installationMap,
    checkoutSessions: checkoutSessionMap,
  };
}

function mapReport(report: {
  id: string;
  workspaceId: string;
  jobId: string;
  status: string;
  preset: string;
  capabilitiesJson: unknown;
  runtimeMode: string;
  title: string;
  summaryJson: unknown;
  findingsJson: unknown;
  sectionsJson: unknown;
  createdAt: Date;
  artifacts: Array<{
    objectKey: string;
    bucket: string;
    region: string;
    mimeType: string;
    sizeBytes: number;
    signedUrl: string | null;
  }>;
}): AnalysisReport {
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    jobId: report.jobId,
    status: report.status as AnalysisReport["status"],
    preset: report.preset as AnalysisReport["preset"],
    capabilities: asJsonArray(report.capabilitiesJson, []),
    runtimeMode: report.runtimeMode as AnalysisReport["runtimeMode"],
    title: report.title,
    summary: report.summaryJson as AnalysisReport["summary"],
    findings: asJsonArray(report.findingsJson, []),
    sections: asJsonArray(report.sectionsJson, []),
    artifacts: report.artifacts.map((artifact): ArtifactReference => ({
      key: artifact.objectKey,
      bucket: artifact.bucket,
      region: artifact.region,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      ...(artifact.signedUrl ? { signedUrl: artifact.signedUrl } : {}),
    })),
    createdAt: report.createdAt.toISOString(),
  };
}

function snapshotFromCheckout(checkoutSessions: Array<{
  id: string;
  workspaceId: string | null;
  userId: string;
  entitlement: string;
  checkoutUrl: string;
  status: string;
  createdAt: Date;
}>): Array<[string, AppState["checkoutSessions"] extends Map<string, infer V> ? V : never]> {
  return checkoutSessions.map(session => [session.id, {
    id: session.id,
    workspaceId: session.workspaceId,
    userId: session.userId,
    entitlement: session.entitlement as "pro",
    checkoutUrl: session.checkoutUrl,
    status: session.status as "open" | "completed" | "cancelled",
    createdAt: session.createdAt.toISOString(),
  }]);
}

export function persistAppState(state: AppState): void {
  const snapshot = snapshotAppState(state);
  if (getPersistenceBackend() === "file") {
    persistFileSnapshot(snapshot);
    return;
  }

  persistenceQueue = persistenceQueue
    .then(async () => {
      await persistPrismaSnapshot(snapshot);
    })
    .catch(error => {
      console.error("[persistence] prisma persist failed", error);
    });
}

export async function loadPersistedAppState(): Promise<Partial<AppState> | null> {
  if (getPersistenceBackend() === "file") {
    return loadFileSnapshot();
  }

  const prisma = getPrismaClient();
  try {
    await prisma.$connect();
    return await loadPrismaSnapshot();
  } catch (error) {
    console.error("[persistence] prisma load failed, falling back to empty state", error);
    return null;
  }
}

export async function flushPersistedAppState(): Promise<void> {
  await persistenceQueue;
}

export function persistenceBackendLabel(): PersistenceBackend {
  return getPersistenceBackend();
}

export async function disconnectPersistence(): Promise<void> {
  if (getPersistenceBackend() !== "prisma") {
    return;
  }
  await flushPersistedAppState();
  await getPrismaClient().$disconnect();
}

export { decrypt, encrypt };
