import path from "node:path";
import type {
  AnalysisJob,
  AnalysisLogEvent,
  AnalysisReport,
  CapabilityId,
  JobEnvelope,
  PresetId,
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
import { generateWithOrderedProviders, resolveAiProvidersFromEnv, type AiProviderDescriptor } from "./ai";
import { analyzeBrowserCapabilities } from "./browser";
import {
  listCapabilities as listCapabilityDefinitions,
  listPresetDefinitions,
  resolveCapabilities,
  resolvePresetId,
  resolveRuntimeMode,
} from "./capabilities";
import { buildRepoInventory } from "./inventory";
import { exportPatchBundle, type ExportPatchOptions, type ExportPatchResult, type ExportPatchSelection } from "./patch";
import { analyzeCapabilities } from "./parity";
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
  source: SourceDescriptor;
  preset?: PresetId;
  capabilities?: CapabilityId[];
  runtimeMode?: "static" | "browser";
  secretRefs?: string[];
  secrets?: Array<{
    id: string;
    kind: "credential-pair" | "session-state" | "api-token";
    value: string;
    name?: string;
  }>;
  mode?: "standard" | "hosted";
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
  capabilities: CapabilityId[],
  runtimeMode: "static" | "browser",
  secretRefs: string[],
  jobId?: string,
): AnalysisJob {
  return analysisJobSchema.parse({
    id: jobId ?? makeRunId(path.basename(source.location)),
    workspaceId: workspace.id,
    sourceId: source.id,
    reportId: null,
    status: "succeeded",
    sourceType: source.type,
    sourceLocation: source.location,
    preset,
    capabilities,
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

export async function analyzeRepo(options: AnalyzeRepoOptions): Promise<JobEnvelope> {
  const workspaceHandle = createWorkspaceHandle(
    options.workspace ?? (options.rootDir ? { rootDir: options.rootDir } : {}),
  );
  const workspace = createWorkspaceRecord(workspaceHandle);
  const acquiredSource = acquireSource(options.source, workspaceHandle);
  const source = asHostedSource(acquiredSource, workspace.id);
  const inventory = buildRepoInventory(acquiredSource.repoPath);
  const preset = resolvePresetId(options.preset, inventory);
  const capabilities = resolveCapabilities(preset, options.capabilities);
  const runtimeMode = resolveRuntimeMode(preset, capabilities, options.runtimeMode);
  const secretRefs = options.secretRefs ?? [];
  const job = createJobRecord(workspace, source, preset, capabilities, runtimeMode, secretRefs, options.jobId);
  const capabilityResult = await analyzeCapabilities({
    jobId: job.id,
    repoPath: acquiredSource.repoPath,
    inventory,
    preset,
    capabilities,
    runtimeMode,
    workspace: workspaceHandle,
  });
  const browserResult = runtimeMode === "browser"
    ? await analyzeBrowserCapabilities({
        jobId: job.id,
        repoPath: acquiredSource.repoPath,
        inventory,
        capabilities,
        workspace: workspaceHandle,
        secrets: options.secrets ?? [],
      })
    : { findings: [], sections: [], logs: [] };
  const logs: AnalysisLogEvent[] = [...createLogs(job.id, runtimeMode), ...capabilityResult.logs, ...browserResult.logs];
  const report: AnalysisReport = {
    id: `report-${job.id}`,
    workspaceId: workspace.id,
    jobId: job.id,
    status: "ready",
    preset,
    capabilities,
    runtimeMode,
    title: `${inventory.repoName} parity analysis report`,
    summary: {
      totalFindings: [...capabilityResult.findings, ...browserResult.findings].length,
      high: [...capabilityResult.findings, ...browserResult.findings].filter(item => item.severity === "high").length,
      medium: [...capabilityResult.findings, ...browserResult.findings].filter(item => item.severity === "medium").length,
      low: [...capabilityResult.findings, ...browserResult.findings].filter(item => item.severity === "low").length,
    },
    findings: [...capabilityResult.findings, ...browserResult.findings],
    sections: [...capabilityResult.sections, ...browserResult.sections],
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

export function listPresets(): Array<{ id: string; description: string }> {
  return [
    { id: "auto", description: "Auto-detect the best behavioral parity preset for the repository." },
    ...listPresetDefinitions().map(preset => ({ id: preset.id, description: preset.description })),
  ];
}

export function listCapabilities(): Array<{ id: CapabilityId; title: string; runtime: "static" | "browser"; description: string }> {
  return listCapabilityDefinitions();
}

export function listAiProviders(): Array<{ id: string; label: string; model: string; kind: string }> {
  return resolveAiProvidersFromEnv().map(provider => ({
    id: provider.id,
    label: provider.label,
    model: provider.model,
    kind: provider.kind,
  }));
}

export { generateWithOrderedProviders, resolveAiProvidersFromEnv };
export type { AiProviderDescriptor };
