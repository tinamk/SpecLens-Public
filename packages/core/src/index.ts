import path from "node:path";
import type {
  AnalysisJob,
  AnalysisLogEvent,
  AnalysisReport,
  JobEnvelope,
  RoleId,
  Source,
  Workspace,
} from "@speclens/contracts";
import {
  analysisJobSchema,
  analysisLogEventSchema,
  jobEnvelopeSchema,
  workspaceSchema,
} from "@speclens/contracts";
import { createGeneratedSpecPack } from "./analyzers";
import { inspectGitRepositoryPathAsync } from "./archive";
export {
  extractArchiveFileAsync,
  inspectArchiveFileAsync,
  inspectGitRepositoryArchiveFileAsync,
  inspectGitRepositoryPathAsync,
  type ArchiveInspection,
  type ArchiveKind,
  type GitRepositoryArchiveInspection,
  type GitRepositoryPathInspection,
} from "./archive";
export {
  downloadPublicFileToPath,
  filenameFromPublicUrl,
  isValidPublicHttpUrl,
  resolvePublicCodeLocation,
  type ResolvedPublicCodeLocation,
} from "./public-download";
export {
  isAllowedDynamicReturnOrigin,
  isPrivateOrLocalHostname,
  isTrustedInternalServiceHostname,
  isTrustedLocalHostname,
  parseAllowedOrigins,
  resolvePublicRequestOrigin,
} from "./origin";
export { snapshotPublicWebsite } from "./web-snapshot";
export { analyzeBrowserRoles } from "./browser";
export { buildRepoInventory } from "./inventory";
export {
  createHomeTempDirSync,
  ensureSpecLensTempRoot,
  resolveSpecLensAppStatePath,
  resolveSpecLensCacheRoot,
  resolveSpecLensObjectStorageRoot,
  resolveSpecLensStateRoot,
  resolveSpecLensTempRoot,
} from "./local-paths";
export {
  createGithubAppJwt,
  createGithubCloneUrl,
  createGithubGitAuthEnv,
  createGithubInstallationAccessToken,
  parseGithubRepoLocation,
} from "./github-app";
export {
  buildPortalCsrfToken,
  decodePortalSessionToken,
  encodePortalSessionToken,
  type PortalSession,
} from "./portal-session";
export { presetIdSchema, type PresetId } from "./presets";
export { analyzeRoles } from "./parity";
export {
  createChangesetSummary,
  createRemediationTempDir,
  materializeRemediationRepo,
  maybePublishGithubPullRequest,
  resolveValidationCommands,
  runCodexRemediation,
  runGit,
  runValidationCommands,
  selectRemediationFindings,
} from "./remediation";
import {
  createAiBudgetTracker,
  generateWithOrderedProviders,
  resolveAiDefaults,
  resolveAiProvidersFromEnv,
  type AiProviderDescriptor,
} from "./ai";
import { analyzeBrowserRoles } from "./browser";
import {
  listRoleDefinitions as listRoleDefinitionsInternal,
  listPresetDefinitions,
  resolvePresetId,
  resolvePresetRoles,
  resolveRoleDefinitionsForRoles,
  resolveRuntimeMode,
} from "./roles";
import { buildRepoInventory } from "./inventory";
import { exportPatchBundle, type ExportPatchOptions, type ExportPatchResult, type ExportPatchSelection } from "./patch";
import { analyzeRoles } from "./parity";
import { type PresetId } from "./presets";
import { writeRunArtifacts } from "./reporting";
import { acquireSource, asHostedSource, type SourceDescriptor } from "./source";
import { createId, makeRunId, nowIso } from "./utils";
import {
  createWorkspace as createWorkspaceHandle,
  getRunEnvelope,
  listRunEnvelopes,
  type WorkspaceHandle,
  type WorkspaceOptions,
} from "./workspace";

export interface AnalyzeRepoOptions {
  rootDir?: string;
  workspace?: WorkspaceOptions;
  jobId?: string;
  source?: SourceDescriptor;
  repoPath?: string;
  preset?: PresetId;
  roles?: RoleId[];
  runtimeMode?: "static" | "browser";
  secretRefs?: string[];
  secrets?: Array<{
    id: string;
    kind: "credential-pair" | "session-state" | "api-token";
    value: string;
    name?: string;
  }>;
  mode?: "standard" | "hosted";
  allowHostExecution?: boolean;
}

function createWorkspaceRecord(handle: WorkspaceHandle): Workspace {
  return workspaceSchema.parse({
    id: createId("workspace", handle.workspaceDir),
    ownerUserId: "local-owner",
    name: handle.name,
    slug: handle.name,
    description: "Local development workspace",
    entitlement: "free",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

function createJobRecord(
  workspace: Workspace,
  source: Source,
  preset: Exclude<PresetId, "auto">,
  roles: RoleId[],
  runtimeMode: "static" | "browser",
  secretRefs: string[],
  jobId?: string,
): AnalysisJob {
  return analysisJobSchema.parse({
    id: jobId ?? makeRunId(path.basename(source.location)),
    workspaceId: workspace.id,
    sourceId: source.id,
    companionSourceId: null,
    reportId: null,
    status: "succeeded",
    executionPath: "unified-agent",
    agentId: null,
    sourceType: source.type,
    sourceLocation: source.location,
    companionSourceType: null,
    companionSourceLocation: null,
    roles,
    runtimeMode,
    secretRefs,
    requestedByUserId: workspace.ownerUserId,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    createdAt: nowIso(),
  });
}

function createLogs(jobId: string, runtimeMode: "static" | "browser"): AnalysisLogEvent[] {
  return [
    analysisLogEventSchema.parse({
      id: createId("log", `${jobId}:bootstrap`),
      jobId,
      level: "info",
      scope: "queue",
      message: "Job accepted by SpecLens.",
      createdAt: nowIso(),
    }),
    analysisLogEventSchema.parse({
      id: createId("log", `${jobId}:sandbox`),
      jobId,
      level: "info",
      scope: "sandbox",
      message: runtimeMode === "browser"
        ? "Sandbox execution prepared browser-capable parity analysis."
        : "Sandbox execution completed static parity analysis.",
      createdAt: nowIso(),
    }),
  ];
}

export function createWorkspace(options: WorkspaceOptions = {}): WorkspaceHandle {
  return createWorkspaceHandle(options);
}

export function writeHostedJobArtifacts(options: {
  rootDir?: string;
  workspaceName: string;
  repoPath: string;
  envelope: JobEnvelope;
}): JobEnvelope {
  const workspaceHandle = createWorkspaceHandle({
    ...(options.rootDir ? { rootDir: options.rootDir } : {}),
    name: options.workspaceName,
  });
  const inventory = buildRepoInventory(options.repoPath);
  return writeRunArtifacts({
    workspace: workspaceHandle,
    envelope: options.envelope,
    generatedSpecPack: createGeneratedSpecPack(inventory),
  });
}

function createLocalRepoSource(workspaceId: string, repoPath: string): Source {
  return {
    id: createId("source", `local:${repoPath}`),
    workspaceId,
    type: "git-public",
    displayName: `Local git repo: ${path.basename(repoPath)}`,
    location: repoPath,
    visibility: "private",
    verificationStatus: "verified",
    verificationError: null,
    githubInstallationId: null,
    uploadObjectKey: null,
    createdAt: nowIso(),
  };
}

export async function analyzeRepo(options: AnalyzeRepoOptions): Promise<JobEnvelope> {
  const workspaceHandle = createWorkspaceHandle(
    options.workspace ?? (options.rootDir ? { rootDir: options.rootDir } : {}),
  );
  const workspace = createWorkspaceRecord(workspaceHandle);
  const usingRepoPath = typeof options.repoPath === "string" && options.repoPath.trim().length > 0;
  const usingSource = options.source !== undefined;
  if (usingRepoPath === usingSource) {
    throw new Error("analyzeRepo requires exactly one of source or repoPath.");
  }

  let source: Source;
  let repoPath: string;
  if (usingRepoPath) {
    const inspected = await inspectGitRepositoryPathAsync(options.repoPath!);
    if (inspected.ok === false) {
      throw new Error(inspected.message);
    }
    repoPath = inspected.rootPath;
    source = createLocalRepoSource(workspace.id, repoPath);
  } else {
    const acquiredSource = await acquireSource(options.source!, workspaceHandle);
    source = asHostedSource(acquiredSource, workspace.id);
    repoPath = acquiredSource.repoPath;
  }

  const inventory = buildRepoInventory(repoPath);
  const preset = resolvePresetId(options.preset, inventory);
  const requestedRoles = options.roles && options.roles.length > 0 ? options.roles : undefined;
  const presetRoles = resolvePresetRoles(preset, requestedRoles);
  const roleIds = requestedRoles && requestedRoles.length > 0 ? requestedRoles : presetRoles;
  const roleDefinitions = resolveRoleDefinitionsForRoles(roleIds);
  const runtimeMode = resolveRuntimeMode(preset, presetRoles, options.runtimeMode);
  const secretRefs = options.secretRefs ?? [];
  const aiDefaults = resolveAiDefaults();
  const aiBudget = createAiBudgetTracker(aiDefaults.budgetUsd);
  const job = createJobRecord(workspace, source, preset, roleIds, runtimeMode, secretRefs, options.jobId);
  const roleResult = await analyzeRoles({
    jobId: job.id,
    repoPath,
    inventory,
    preset,
    roles: presetRoles,
    runtimeMode,
    workspace: workspaceHandle,
    aiDefaults,
    aiBudget,
  });
  const browserResult = runtimeMode === "browser"
    ? await analyzeBrowserRoles({
        jobId: job.id,
        repoPath,
        inventory,
        roles: presetRoles,
        workspace: workspaceHandle,
        secrets: options.secrets ?? [],
        allowHostExecution: options.allowHostExecution === true,
        aiDefaults,
        aiBudget,
      })
    : { findings: [], sections: [], logs: [] };
  const logs: AnalysisLogEvent[] = [...createLogs(job.id, runtimeMode), ...roleResult.logs, ...browserResult.logs];
  const report: AnalysisReport = {
    id: `report-${job.id}`,
    workspaceId: workspace.id,
    jobId: job.id,
    status: "ready",
    roles: roleDefinitions,
    runtimeMode,
    title: `${inventory.repoName} parity analysis report`,
    summary: {
      totalFindings: [...roleResult.findings, ...browserResult.findings].length,
      high: [...roleResult.findings, ...browserResult.findings].filter(item => item.severity === "high").length,
      medium: [...roleResult.findings, ...browserResult.findings].filter(item => item.severity === "medium").length,
      low: [...roleResult.findings, ...browserResult.findings].filter(item => item.severity === "low").length,
      auditBundleId: "standard",
      categoryCounts: {},
      releaseGateDecision: null,
      remediationPacks: [],
      fixHandoff: null,
      changeset: null,
      latestRemediationJobId: null,
      executionCoverage: {
        attempted: [],
        skipped: [],
      },
      qualityScorecard: null,
      capabilityGaps: [],
      artifactAnalysis: null,
      executionSteps: [],
    },
    findings: [...roleResult.findings, ...browserResult.findings],
    sections: [...roleResult.sections, ...browserResult.sections],
    artifacts: [],
    createdAt: nowIso(),
  };

  const envelope = jobEnvelopeSchema.parse({
    job: {
      ...job,
      reportId: report.id,
    },
    logs,
    report,
    artifacts: report.artifacts,
    timing: {
      queueDurationMs: null,
      runDurationMs: null,
      totalDurationMs: null,
      elapsedMs: 0,
      estimatedTotalMs: null,
      estimatedRemainingMs: null,
      confidence: "low",
      basis: "Core analysis did not compute job-level timing estimates.",
    },
    qualityScorecard: report.summary.qualityScorecard,
    capabilityGaps: report.summary.capabilityGaps,
    artifactAnalysis: report.summary.artifactAnalysis,
    executionSteps: report.summary.executionSteps,
  });

  return writeRunArtifacts({
    workspace: workspaceHandle,
    envelope,
    generatedSpecPack: createGeneratedSpecPack(inventory),
  });
}

export function listRuns(options: WorkspaceOptions = {}): JobEnvelope[] {
  return listRunEnvelopes(options);
}

export function getRun(runId: string, options: WorkspaceOptions = {}): JobEnvelope {
  return getRunEnvelope(runId, options);
}

export function exportPatch(
  runId: string,
  selection: ExportPatchSelection = {},
  options: ExportPatchOptions = {},
): ExportPatchResult {
  return exportPatchBundle(runId, selection, options);
}

export function listPresets(): Array<{
  id: string;
  title: string;
  description: string;
  runtimeMode: "static" | "browser" | "auto";
}> {
  return [
    {
      id: "auto",
      title: "Auto detect best fit",
      description: "Choose the most likely preset for the repository automatically.",
      runtimeMode: "auto",
    },
    ...listPresetDefinitions().map(preset => ({
      id: preset.id,
      title: preset.title,
      description: preset.description,
      runtimeMode: preset.runtimeMode,
    })),
  ];
}

export function listRoleDefinitions(): Array<{ id: string; title: string; description: string; order: number }> {
  return listRoleDefinitionsInternal().map(role => ({
    id: role.id,
    title: role.title,
    description: role.description,
    order: role.order,
  }));
}

export function listAiProviders(): Array<{ id: string; label: string; model: string; kind: string }> {
  return resolveAiProvidersFromEnv().map(provider => ({
    id: provider.id,
    label: provider.label,
    model: provider.model,
    kind: provider.kind,
  }));
}

export {
  createAiBudgetTracker,
  generateWithOrderedProviders,
  resolveAiDefaults,
  resolveAiProvidersFromEnv,
};
export {
  resolvePresetRoles,
  resolvePresetId,
  resolveRoleDefinitionsForRoles,
  resolveRuntimeMode,
} from "./roles";
export type { AiProviderDescriptor };
