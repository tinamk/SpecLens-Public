import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { z } from "zod";
import {
  analyzeBrowserRoles,
  analyzeRoles,
  buildRepoInventory,
  createChangesetSummary,
  createGithubCloneUrl,
  createGithubGitAuthEnv,
  createRemediationTempDir,
  createWorkspace as createCoreWorkspace,
  inspectGitRepositoryArchiveFileAsync,
  materializeRemediationRepo,
  maybePublishGithubPullRequest,
  resolveValidationCommands,
  runCodexRemediation,
  runGit,
  runValidationCommands,
  selectRemediationFindings,
  writeHostedJobArtifacts,
  type ArchiveKind,
} from "@speclens/core";
import {
  appendAnalysisJobLogs,
  checkDatabaseHealth,
  checkQueueHealth,
  claimAgentJob,
  downloadObjectToFile,
  finalizeAnalysisJobFailure,
  finalizeAnalysisJobSuccess,
  getAiAgentExecutionPlan,
  getCodexTokens,
  initializeDatabase,
  isCancellationRequested,
  listActiveSourceLearnables,
  mirrorArtifactsToObjectStorage,
  parseCodexAuthFile,
  putObjectFromFile,
  replaceSourceLearnables,
  renderCodexAuthFile,
  storeReportChangeset,
  storeRemediationJobChangeset,
  storeCodexTokens,
  workAgentJobs,
  type JobExecutionRecord,
  type ObjectStorageConfig,
} from "@speclens/db";
import {
  analysisLogEventSchema,
  analysisExecutionStepSchema,
  analysisReportSchema,
  artifactAnalysisSchema,
  auditBundleIdSchema,
  capabilityGapSchema,
  collectAnalysisExecutionSteps,
  encodeAnalysisExecutionStepEvent,
  fixHandoffSchema,
  findingCategorySchema,
  jobEnvelopeSchema,
  qualityScorecardSchema,
  releaseGateDecisionSchema,
  remediationPackSchema,
  executionCoverageSchema,
  type AiRoleExecutorKind,
  standardizedAgentBlockerSchema,
  standardizedAgentHandoffSchema,
  type AnalysisExecutionStep,
  type Learnable,
  type AiToolCapability,
  type AnalysisLogEvent,
  type AnalysisReport,
  type ChangesetSummary,
  type JobEnvelope,
  type RoleDefinition,
} from "@speclens/contracts";
import { loadAiWorkerConfig } from "./config";
import { beginAiWorkerJob, getMetricsContentType, getMetricsSnapshot } from "./metrics";

const roleOutputSchema = z.object({
  summary: z.string().default(""),
  sections: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string(),
        status: z.enum(["ready", "planned", "skipped"]),
        summary: z.string(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .default([]),
  findings: z
    .array(
      z.object({
        id: z.string().optional(),
        category: findingCategorySchema.optional(),
        severity: z.enum(["high", "medium", "low"]),
        title: z.string(),
        message: z.string(),
        suggestion: z.string(),
        evidence: z.array(z.string()).default([]),
        sourceIds: z.array(z.string()).default([]),
        paths: z.array(z.string()).default([]),
        remediationPackIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

type RoleOutput = z.infer<typeof roleOutputSchema>;
type PriorRoleOutput = {
  roleId: string;
  roleName: string;
  output: RoleOutput;
};

type LearnableSeed = Pick<Learnable, "statement" | "category"> & {
  evidence?: string[];
  order?: number;
};

type CodexRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

type ShellRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

type PlaywrightPreflightPlan = {
  label: string;
  command: string;
  workingDirectory: string;
  source: "package-script" | "config";
  packageManager: string | null;
  configPath: string | null;
};

type CodexSandboxMode = "read-only" | "workspace-write";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
type StandardizedHandoff = ReturnType<typeof standardizedAgentHandoffSchema.parse>;
type NativeExecutorId =
  | "native-repo-inventory"
  | "native-license-policy"
  | "native-component-inventory"
  | "native-ui-label-scan"
  | "native-browser-suite"
  | "native-visual-inspection"
  | "deterministic-standardized-handoff";

type RuntimeExecutionTarget = {
  label: string;
  workingDirectory: string;
  startCommand: string;
  baseUrl: string | null;
  healthUrls: string[];
  kind: string | null;
  framework: string | null;
};

type BrowserQaPageRecord = {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  h1: string | null;
  hasMain: boolean;
  screenshot: string | null;
  discoveredLinks: string[];
};

type BrowserQaInteractionRecord = {
  pageUrl: string;
  label: string;
  action: "click" | "fill" | "select" | "link";
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  success: boolean;
  error: string | null;
};

type NativeExecutionResult = {
  output: RoleOutput;
  logs: AnalysisLogEvent[];
};

const MAX_BROWSER_QA_PAGES = 8;
const MAX_BROWSER_QA_INTERACTIONS = 4;
let embeddedWorkerStarted = false;

const findingCategoryByRoleId: Record<string, z.infer<typeof findingCategorySchema>> = {
  "source-topology-scout": "architecture",
  "runtime-scout": "ops",
  "auth-cartographer": "auth",
  "live-surface-resolver": "navigation",
  "license-governor": "license",
  "dependency-risk-reviewer": "dependency",
  "architecture-reviewer": "architecture",
  "code-health-reviewer": "code",
  "component-cartographer": "consistency",
  "design-system-auditor": "visual",
  "copy-consistency-auditor": "copy",
  "accessibility-auditor": "accessibility",
  "navigation-qa-planner": "navigation",
  "browser-executor": "navigation",
  "playwright-operator": "navigation",
  "visual-qa-critic": "visual",
  "ux-friction-reviewer": "ux",
  "cross-surface-consistency-reviewer": "consistency",
  "artifact-auditor": "artifact",
  "remediation-planner": "ops",
  "fix-readiness-emitter": "ops",
  "release-gate-scorer": "ops",
  "standardized-json-output": "ops",
  "smoke-summary": "ops",
};

function truncateLogMessage(value: string, maxLength = 500): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateText(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatDurationMs(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return "0s";
  }
  const seconds = Math.round(value / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function summarizeExecutionStep(step: AnalysisExecutionStep): string {
  const owner = step.roleName ?? step.title;
  const agent = step.agentName ?? step.agentId ?? "unknown agent";
  const executor = step.executorKind
    ? step.executorKind === "native" && step.nativeExecutorId
      ? `native:${step.nativeExecutorId}`
      : step.executorKind
    : "unknown";
  const detail = step.detail ? ` ${step.detail}` : "";
  switch (step.status) {
    case "running":
      return `${agent} -> ${owner} started via ${executor}.${detail}`;
    case "succeeded":
      return `${agent} -> ${owner} succeeded via ${executor}${step.durationMs !== null ? ` in ${formatDurationMs(step.durationMs)}` : ""}.${detail}`;
    case "failed":
      return `${agent} -> ${owner} failed via ${executor}${step.durationMs !== null ? ` after ${formatDurationMs(step.durationMs)}` : ""}.${detail}`;
    case "skipped":
      return `${agent} -> ${owner} skipped via ${executor}.${detail}`;
  }
}

function capturePrompt(
  capturePath: string | null,
  payload: {
    roleId: string;
    roleName: string;
    prompt: string;
  },
): void {
  if (!capturePath) {
    return;
  }
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.appendFileSync(capturePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function shouldSuppressCodexLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const exactMatches = new Set([
    "Reading additional input from stdin...",
    "user",
    "Skills:",
    "Task:",
    "Constraints:",
    "Granted tools:",
    "Completed role handoff context (JSON):",
    "Output shape reminder:",
    "--------",
    "[]",
    "{",
    "}",
    "\"summary\": \"...\",",
    "\"sections\": [...],",
    "\"findings\": [...]",
  ]);
  if (exactMatches.has(trimmed)) {
    return true;
  }

  const prefixes = [
    "OpenAI Codex v",
    "model:",
    "workdir:",
    "approval:",
    "provider:",
    "reasoning summaries:",
    "reasoning effort:",
    "session id:",
    "sandbox:",
    "You are the \"",
    "Role description:",
    "- Evidence discipline [tools:",
    "- repo-read",
    "- Work only with files in the current repository.",
    "- You may use granted tools to inspect or execute work inside the temporary job workspace.",
    "- Do not make lasting source changes or write deliverables outside the requested JSON output.",
    "- Use prior role outputs when they are relevant, but prefer current repository evidence if there is a conflict.",
    "- Return ONLY valid JSON that matches the provided schema.",
    "- Do not wrap the JSON in Markdown fences.",
    "Survey the repository structure and summarize its shape.",
    "Identify top-level directories/files, primary languages, and manifest files.",
    "Include a section titled \"Repository inventory\" with counts and a concise summary.",
    "Data keys to include when possible:",
    "Use the evidence array to list file paths and short snippets or identifiers.",
    "If evidence is weak or missing, omit the finding.",
    "codex",
    "exec",
    "exited ",
    "/bin/bash ",
    "warning: Codex could not find bubblewrap on PATH.",
    "bwrap:",
    "mcp:",
    "tokens used",
    "The shell wrapper is blocked by the sandbox’s namespace setup.",
    "The direct shell path is unavailable here.",
    "Surveying the repository root and key manifests first, then I’ll condense the structure into the requested JSON with only repo-backed evidence.",
  ];

  return prefixes.some(prefix => trimmed.startsWith(prefix));
}

function sanitizeCodexDiagnosticText(value: string): string {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !shouldSuppressCodexLogLine(line))
    .join("\n");
}

function flushChunkLines(
  value: string,
  remainder: string,
  emit: (line: string) => void,
): string {
  const normalized = `${remainder}${value}`.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const nextRemainder = parts.pop() ?? "";
  for (const part of parts) {
    const line = part.trim();
    if (line.length === 0) {
      continue;
    }
    emit(truncateLogMessage(line));
  }
  return nextRemainder;
}

function storageConfig(): ObjectStorageConfig {
  const provider = process.env.OBJECT_STORAGE_PROVIDER;
  const mirrorProvider: ObjectStorageConfig["objectStorageProvider"] = process.env.OBJECT_STORAGE_MIRROR_PROVIDER === "s3-compatible" || process.env.OBJECT_STORAGE_MIRROR_PROVIDER === "digitalocean-spaces"
    ? process.env.OBJECT_STORAGE_MIRROR_PROVIDER
    : "local";
  const objectStorageMirror = process.env.OBJECT_STORAGE_MIRROR_PROVIDER
    ? {
        objectStorageProvider: mirrorProvider,
        objectStorageBucket: process.env.OBJECT_STORAGE_MIRROR_BUCKET ?? null,
        objectStorageEndpoint: process.env.OBJECT_STORAGE_MIRROR_ENDPOINT ?? null,
        objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_MIRROR_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_MIRROR_ENDPOINT ?? null,
        objectStorageRegion: process.env.OBJECT_STORAGE_MIRROR_REGION ?? null,
        objectStorageForcePathStyle: process.env.OBJECT_STORAGE_MIRROR_FORCE_PATH_STYLE === "true",
        objectStorageAccessKeyId: process.env.OBJECT_STORAGE_MIRROR_ACCESS_KEY_ID ?? null,
        objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_MIRROR_SECRET_ACCESS_KEY ?? null,
      }
    : null;
  return {
    objectStorageProvider:
      provider === "s3-compatible" || provider === "digitalocean-spaces" ? provider : "local",
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? process.env.SPACES_BUCKET ?? null,
    objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStoragePublicEndpoint:
      process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? process.env.SPACES_REGION ?? null,
    objectStorageForcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    objectStorageAccessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? process.env.SPACES_ACCESS_KEY_ID ?? null,
    objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? process.env.SPACES_SECRET_ACCESS_KEY ?? null,
    objectStorageMirror,
    objectStorageMirrorRequired: objectStorageMirror !== null && process.env.OBJECT_STORAGE_MIRROR_REQUIRED !== "false",
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
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
    createdAt: new Date().toISOString(),
  });
}

async function appendLog(
  jobId: string,
  logs: AnalysisLogEvent[],
  scope: string,
  message: string,
  level: AnalysisLogEvent["level"] = "info",
  requestId?: string,
  visibility: AnalysisLogEvent["visibility"] = "default",
): Promise<void> {
  const log = createLog(jobId, scope, message, level, requestId, visibility);
  logs.push(log);
  try {
    await appendAnalysisJobLogs(jobId, [log]);
  } catch (error) {
    console.warn("[ai-worker] Failed to append log:", error);
  }
}

async function appendExecutionStepLog(
  jobId: string,
  logs: AnalysisLogEvent[],
  step: AnalysisExecutionStep,
  summaryVisibility: AnalysisLogEvent["visibility"] = "default",
): Promise<void> {
  await appendLog(
    jobId,
    logs,
    "agent-step",
    encodeAnalysisExecutionStepEvent(step),
    step.status === "failed" ? "error" : step.status === "skipped" ? "warn" : "info",
    undefined,
    "default",
  );
  await appendLog(
    jobId,
    logs,
    "agent",
    summarizeExecutionStep(step),
    step.status === "failed" ? "error" : step.status === "skipped" ? "warn" : "info",
    undefined,
    summaryVisibility,
  );
}

function buildExecutionStep(step: Partial<AnalysisExecutionStep> & Pick<AnalysisExecutionStep, "id" | "order" | "title" | "status">): AnalysisExecutionStep {
  return analysisExecutionStepSchema.parse({
    stepType: "stage",
    agentId: null,
    agentName: null,
    roleId: null,
    roleName: null,
    executorKind: null,
    nativeExecutorId: null,
    detail: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    ...step,
  });
}

async function runProcess(command: string, args: string[], options: {
  env?: NodeJS.ProcessEnv | undefined;
} = {}): Promise<void> {
  const env = {
    ...(options.env ?? process.env),
    PATH: options.env?.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
  };
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", chunk => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", chunk => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", reject);
    child.on("close", status => {
      if (status !== 0) {
        reject(new Error(
          Buffer.concat(stderr).toString("utf8").trim()
          || Buffer.concat(stdout).toString("utf8").trim()
          || `${command} ${args.join(" ")} failed.`,
        ));
        return;
      }
      resolve();
    });
  });
}

async function extractArchive(archivePath: string, extractedDir: string, kind: ArchiveKind): Promise<void> {
  if (kind === "zip") {
    await runProcess("unzip", ["-q", archivePath, "-d", extractedDir]);
    return;
  }
  if (kind === "tar" || kind === "tar.gz") {
    await runProcess("tar", ["-xf", archivePath, "-C", extractedDir, "--no-same-owner", "--no-same-permissions"]);
    return;
  }
  throw new Error("Unsupported archive format. Use .zip, .tar, .tgz, or .tar.gz.");
}

function collapseSingleRoot(extractedDir: string): string {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true }).filter(entry => entry.name !== "__MACOSX");
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractedDir, entries[0].name);
  }
  return extractedDir;
}

async function cloneRepo(repoUrl: string, destination: string, env?: NodeJS.ProcessEnv): Promise<void> {
  await runProcess("git", ["clone", "--depth=1", repoUrl, destination], { env });
}

function stripGitMetadata(repoPath: string): string {
  const gitDir = path.join(repoPath, ".git");
  if (fs.existsSync(gitDir)) {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
  return repoPath;
}

async function materializeStandaloneSource(source: JobExecutionRecord["source"], targetDir: string, tempDir: string): Promise<string> {
  if (source.type === "upload-archive") {
    if (!source.uploadObjectKey) {
      throw new Error(`Archive source ${source.id} is missing uploadObjectKey.`);
    }
    const archivePath = path.join(tempDir, `${safeSegment(source.id)}-${safeSegment(path.basename(source.location))}`);
    fs.mkdirSync(targetDir, { recursive: true });
    await downloadObjectToFile(storageConfig(), source.uploadObjectKey, archivePath);
    const archiveInspection = await inspectGitRepositoryArchiveFileAsync(archivePath, source.location);
    if (!archiveInspection.ok) {
      throw new Error(archiveInspection.message);
    }
    await extractArchive(archivePath, targetDir, archiveInspection.kind);
    return stripGitMetadata(collapseSingleRoot(targetDir));
  }

  if (source.type === "github-private") {
    if (!source.githubInstallationId) {
      throw new Error(`Private GitHub source ${source.id} is missing githubInstallationId.`);
    }
    await cloneRepo(
      createGithubCloneUrl(source.location),
      targetDir,
      await createGithubGitAuthEnv(source.githubInstallationId, { baseEnv: process.env }),
    );
    return stripGitMetadata(targetDir);
  }

  await cloneRepo(source.location, targetDir);
  return stripGitMetadata(targetDir);
}

function writeCombinedSourceBundle(
  bundleRoot: string,
  primarySource: JobExecutionRecord["source"],
  companionSource: JobExecutionRecord["source"],
): void {
  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, "README.speclens.txt"),
    [
      "This directory is a SpecLens-generated paired source bundle.",
      "",
      "Use `primary/` as the main analysis target and `companion/` as the linked supporting source.",
      "",
      `Primary source: ${primarySource.displayName} (${primarySource.type})`,
      `Primary location: ${primarySource.location}`,
      `Companion source: ${companionSource.displayName} (${companionSource.type})`,
      `Companion location: ${companionSource.location}`,
      "",
      "Typical pairing: deployed website in `primary/` and source code in `companion/`.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleRoot, "speclens-source-bundle.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      primary: {
        id: primarySource.id,
        displayName: primarySource.displayName,
        type: primarySource.type,
        location: primarySource.location,
      },
      companion: {
        id: companionSource.id,
        displayName: companionSource.displayName,
        type: companionSource.type,
        location: companionSource.location,
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function materializeSource(
  execution: JobExecutionRecord,
  tempDir: string,
): Promise<{
  repoPath: string;
}> {
  const sourceRoot = path.join(tempDir, "source");
  const source = execution.source;

  if (execution.companionSource) {
    const bundleRoot = path.join(tempDir, "source-bundle");
    const primaryStageDir = path.join(tempDir, "materialized-primary");
    const companionStageDir = path.join(tempDir, "materialized-companion");
    const primaryMaterializedPath = await materializeStandaloneSource(source, primaryStageDir, tempDir);
    const companionMaterializedPath = await materializeStandaloneSource(execution.companionSource, companionStageDir, tempDir);
    const primaryBundleDir = path.join(bundleRoot, "primary");
    const companionBundleDir = path.join(bundleRoot, "companion");
    fs.mkdirSync(bundleRoot, { recursive: true });
    fs.cpSync(primaryMaterializedPath, primaryBundleDir, { recursive: true });
    fs.cpSync(companionMaterializedPath, companionBundleDir, { recursive: true });
    writeCombinedSourceBundle(bundleRoot, source, execution.companionSource);
    return {
      repoPath: bundleRoot,
    };
  }

  if (source.type === "upload-archive") {
    if (!source.uploadObjectKey) {
      throw new Error(`Archive source ${source.id} is missing uploadObjectKey.`);
    }
    const archivePath = path.join(tempDir, safeSegment(path.basename(source.location)));
    fs.mkdirSync(sourceRoot, { recursive: true });
    await downloadObjectToFile(storageConfig(), source.uploadObjectKey, archivePath);
    const archiveInspection = await inspectGitRepositoryArchiveFileAsync(archivePath, source.location);
    if (!archiveInspection.ok) {
      throw new Error(archiveInspection.message);
    }
    await extractArchive(archivePath, sourceRoot, archiveInspection.kind);
    return {
      repoPath: stripGitMetadata(collapseSingleRoot(sourceRoot)),
    };
  }

  if (source.type === "github-private") {
    if (!source.githubInstallationId) {
      throw new Error(`Private GitHub source ${source.id} is missing githubInstallationId.`);
    }
    await cloneRepo(
      createGithubCloneUrl(source.location),
      sourceRoot,
      await createGithubGitAuthEnv(source.githubInstallationId, { baseEnv: process.env }),
    );
    return {
      repoPath: stripGitMetadata(sourceRoot),
    };
  }

  await cloneRepo(source.location, sourceRoot);
  return {
    repoPath: stripGitMetadata(sourceRoot),
  };
}

function parseJsonFromOutput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Codex output was empty.");
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw error;
    }
    return JSON.parse(match[0]);
  }
}

function normalizeEvidenceItem(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record.path,
    record.file,
    record.location,
    record.identifier,
    record.snippet,
    record.summary,
  ];
  const text = candidates.find(candidate => typeof candidate === "string" && candidate.trim().length > 0);
  if (typeof text === "string") {
    return text.trim();
  }
  const serialized = JSON.stringify(record);
  return serialized === "{}" ? null : truncateLogMessage(serialized, 240);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSectionStatus(value: unknown): "ready" | "planned" | "skipped" {
  if (value === "ready" || value === "planned" || value === "skipped") {
    return value;
  }
  if (value === "verified" || value === "complete" || value === "completed" || value === "done") {
    return "ready";
  }
  if (value === "blocked" || value === "planned_with_blockers" || value === "partial") {
    return "planned";
  }
  if (value === "not_applicable" || value === "n/a") {
    return "skipped";
  }
  return "ready";
}

function normalizeFindingSeverity(value: unknown): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  if (typeof value !== "string") {
    return "medium";
  }

  const normalized = value.trim().toLowerCase();
  if (["critical", "blocker", "urgent", "sev0", "sev1", "p0", "p1"].includes(normalized)) {
    return "high";
  }
  if (["warning", "moderate", "normal", "default", "medium", "sev2", "p2"].includes(normalized)) {
    return "medium";
  }
  if (["info", "informational", "minor", "low", "sev3", "p3"].includes(normalized)) {
    return "low";
  }
  return "medium";
}

function normalizePriority(value: unknown): "high" | "medium" | "low" {
  return normalizeFindingSeverity(value);
}

function normalizeFindingCategory(value: unknown, roleId?: string): z.infer<typeof findingCategorySchema> {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const parsed = findingCategorySchema.safeParse(normalized);
    if (parsed.success) {
      return parsed.data;
    }
  }
  if (roleId && roleId in findingCategoryByRoleId) {
    return findingCategoryByRoleId[roleId]!;
  }
  return "ops";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map(item => normalizeEvidenceItem(item) ?? (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item && item.trim().length > 0));
}

function normalizeExecutionCommand(value: unknown): {
  label: string;
  command: string;
  workingDirectory?: string | null;
  purpose?: string | null;
} | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return {
      label: value.trim(),
      command: value.trim(),
      workingDirectory: null,
      purpose: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const command = firstString(record.command, record.run, record.script, record.value);
  if (!command) {
    return null;
  }
  return {
    label: firstString(record.label, record.name, record.title, command) ?? command,
    command,
    workingDirectory: firstString(record.workingDirectory, record.cwd, record.directory),
    purpose: firstString(record.purpose, record.description, record.summary),
  };
}

function normalizeExecutionCommandArray(values: unknown): Array<{
  label: string;
  command: string;
  workingDirectory?: string | null;
  purpose?: string | null;
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map(normalizeExecutionCommand)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function normalizePorts(values: unknown): Array<number | string> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap<number | string>(value => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return [value];
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const trimmed = value.trim();
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) && /^\d+$/.test(trimmed) ? [parsed] : [trimmed];
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const record = value as Record<string, unknown>;
    const portValue = record.port ?? record.value ?? record.number ?? record.exposed;
    if (typeof portValue === "number" && Number.isFinite(portValue)) {
      return [portValue];
    }
    if (typeof portValue === "string" && portValue.trim().length > 0) {
      const trimmed = portValue.trim();
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) && /^\d+$/.test(trimmed) ? [parsed] : [trimmed];
    }
    return [];
  });
}

function normalizeRuntimeTargets(values: unknown): Array<{
  label: string;
  kind: string | null;
  workingDirectory: string | null;
  startCommand: string | null;
  baseUrl: string | null;
  healthUrls: string[];
  framework: string | null;
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const label = firstString(record.label, record.name, record.id);
    if (!label) {
      return [];
    }
    return [{
      label,
      kind: firstString(record.kind, record.type),
      workingDirectory: firstString(record.workingDirectory, record.cwd, record.path),
      startCommand: firstString(record.startCommand, record.command),
      baseUrl: firstString(record.baseUrl, record.url),
      healthUrls: normalizeStringArray(record.healthUrls),
      framework: firstString(record.framework),
    }];
  });
}

function normalizeNavigationTargets(values: unknown): Array<{
  path: string;
  purpose: string | null;
  requiresAuth: boolean;
  source: "router" | "tests" | "docs" | "inferred";
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const targetPath = firstString(record.path, record.route, record.url);
    if (!targetPath) {
      return [];
    }
    const source = firstString(record.source) ?? "inferred";
    return [{
      path: targetPath,
      purpose: firstString(record.purpose, record.title, record.label),
      requiresAuth: record.requiresAuth === true || record.authenticated === true || record.protected === true,
      source: source === "router" || source === "tests" || source === "docs" ? source : "inferred",
    }];
  });
}

function normalizeQaJourneys(values: unknown): Array<{
  title: string;
  steps: string[];
  requiresAuth: boolean;
  priority: "high" | "medium" | "low";
  successSignals: string[];
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const title = firstString(record.title, record.name, record.label);
    if (!title) {
      return [];
    }
    return [{
      title,
      steps: normalizeStringArray(record.steps),
      requiresAuth: record.requiresAuth === true || record.authenticated === true || record.protected === true,
      priority: normalizePriority(record.priority ?? record.severity ?? record.level),
      successSignals: normalizeStringArray(record.successSignals),
    }];
  });
}

function normalizeBlocker(value: unknown): {
  id?: string;
  severity: "high" | "medium" | "low";
  title: string;
  message: string;
  evidence: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const message = firstString(record.message, record.summary, record.description, record.action);
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    severity: normalizeFindingSeverity(record.severity ?? record.priority ?? record.level),
    title: firstString(record.title, record.name, message, "Untitled blocker") ?? "Untitled blocker",
    message: message ?? "No blocker details supplied.",
    evidence: normalizeStringArray(record.evidence),
  };
}

function normalizeRecommendation(value: unknown): {
  id?: string;
  title: string;
  action: string;
  priority: "high" | "medium" | "low";
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const action = firstString(record.action, record.message, record.suggestion, record.description);
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    title: firstString(record.title, record.name, action, "Untitled recommendation") ?? "Untitled recommendation",
    action: action ?? "No action provided.",
    priority: normalizePriority(record.priority ?? record.severity ?? record.level),
  };
}

function normalizeSurfaceDescriptors(values: unknown): Array<{
  id?: string;
  label: string;
  kind: "repo-app" | "api" | "docs" | "admin" | "public-site" | "authenticated-site" | "pricing" | "legal" | "live-url" | "other";
  location: string | null;
  companion: boolean;
  confidence: "high" | "medium" | "low";
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const label = firstString(record.label, record.name, record.title);
    if (!label) {
      return [];
    }
    const kind = firstString(record.kind, record.type) ?? "other";
    return [{
      ...(typeof record.id === "string" ? { id: record.id } : {}),
      label,
      kind: kind === "repo-app" || kind === "api" || kind === "docs" || kind === "admin" || kind === "public-site"
        || kind === "authenticated-site" || kind === "pricing" || kind === "legal" || kind === "live-url"
        ? kind
        : "other",
      location: firstString(record.location, record.url, record.path),
      companion: record.companion === true,
      confidence: normalizePriority(record.confidence),
    }];
  });
}

function normalizeExecutionAttempts(values: unknown): Array<{
  id: string;
  title: string;
  status: "attempted" | "succeeded" | "skipped" | "failed";
  detail: string | null;
  evidence: string[];
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const title = firstString(record.title, record.name, record.label);
    if (!title) {
      return [];
    }
    const status = firstString(record.status, record.outcome) ?? "attempted";
    return [{
      id: firstString(record.id, record.key, title, `attempt-${index + 1}`) ?? `attempt-${index + 1}`,
      title,
      status: status === "succeeded" || status === "skipped" || status === "failed" ? status : "attempted",
      detail: firstString(record.detail, record.message, record.summary, record.reason),
      evidence: normalizeStringArray(record.evidence),
    }];
  });
}

function normalizeArtifactExpectations(values: unknown): Array<{
  kind: "artifact" | "report" | "screenshot" | "trace" | "storage-state" | "runtime-log" | "playwright-report" | "test-results" | "route-map" | "component-inventory" | "remediation-pack" | "patch-bundle" | "git-bundle" | "validation-log" | "changeset-manifest" | "pr-summary";
  label: string;
  required: boolean;
  source: string | null;
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const label = firstString(record.label, record.title, record.name, record.detail, record.summary);
    const kind = firstString(record.kind, record.type);
    if (!label || !kind) {
      return [];
    }
    return [{
      kind: kind === "report" || kind === "screenshot" || kind === "trace" || kind === "storage-state" || kind === "runtime-log"
        || kind === "playwright-report" || kind === "test-results" || kind === "route-map"
        || kind === "component-inventory" || kind === "remediation-pack" || kind === "patch-bundle"
        || kind === "git-bundle" || kind === "validation-log" || kind === "changeset-manifest" || kind === "pr-summary"
        ? kind
        : "artifact",
      label,
      required: record.required !== false,
      source: firstString(record.source, record.sourcePath),
    }];
  });
}

function normalizeRemediationPacks(values: unknown): Array<{
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  category: z.infer<typeof findingCategorySchema>;
  ownerRoleId: string | null;
  findingIds: string[];
  actions: string[];
  testingNotes: string[];
}> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const title = firstString(record.title, record.name, record.label);
    if (!title) {
      return [];
    }
    return [{
      id: firstString(record.id, record.key, `pack-${index + 1}`) ?? `pack-${index + 1}`,
      title,
      summary: firstString(record.summary, record.description, record.message, title) ?? title,
      priority: normalizePriority(record.priority ?? record.severity),
      category: normalizeFindingCategory(record.category),
      ownerRoleId: firstString(record.ownerRoleId, record.roleId),
      findingIds: normalizeStringArray(record.findingIds),
      actions: normalizeStringArray(record.actions),
      testingNotes: normalizeStringArray(record.testingNotes),
    }];
  });
}

function normalizeReleaseGateDecision(value: unknown): {
  status: "pass" | "warn" | "fail";
  reason: string;
  confidence: "high" | "medium" | "low";
  blockingFindingIds: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const status = firstString(record.status, record.outcome);
  const reason = firstString(record.reason, record.message, record.summary);
  if (!status || !reason) {
    return null;
  }
  return {
    status: status === "pass" || status === "fail" ? status : "warn",
    reason,
    confidence: normalizePriority(record.confidence),
    blockingFindingIds: normalizeStringArray(record.blockingFindingIds),
  };
}

function normalizeFixHandoff(value: unknown): z.infer<typeof fixHandoffSchema> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return [];
        }
        const entry = item as Record<string, unknown>;
        const title = firstString(entry.title, entry.name, entry.label);
        if (!title) {
          return [];
        }
        return [{
          remediationPackId: firstString(entry.remediationPackId, entry.packId),
          title,
          summary: firstString(entry.summary, entry.description, entry.message, title) ?? title,
          targetFiles: combineUniqueStrings(entry.targetFiles, entry.files),
          validationCommands: combineUniqueStrings(entry.validationCommands, entry.testCommands),
          rollbackNotes: normalizeStringArray(entry.rollbackNotes),
          followUps: combineUniqueStrings(entry.followUps, entry.nextSteps),
        }];
      })
    : [];
  const fallbackEntries = entries.length === 0 && Array.isArray(record.packCandidates)
    ? normalizeFixHandoff({
        entries: (record.packCandidates as unknown[]).map(item => ({
          ...(typeof item === "object" && item ? item as Record<string, unknown> : {}),
          remediationPackId: typeof item === "object" && item && !Array.isArray(item)
            ? firstString((item as Record<string, unknown>).id, (item as Record<string, unknown>).packId)
            : null,
        })),
        validationCommands: record.validationCommands,
        rollbackNotes: record.rollbackNotes,
      })
    : null;
  if (fallbackEntries) {
    return fallbackEntries;
  }
  if (entries.length === 0 && combineUniqueStrings(record.validationCommands, record.testCommands).length === 0) {
    return null;
  }
  return fixHandoffSchema.parse({
    entries,
    validationCommands: combineUniqueStrings(record.validationCommands, record.testCommands),
    rollbackNotes: normalizeStringArray(record.rollbackNotes),
  });
}

function normalizeStandardizedHandoff(
  raw: unknown,
  fallback: {
    agentId: string;
    agentName: string;
    roleId: string;
    roleName: string;
  },
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const record = raw as Record<string, unknown>;
  const generatedBy = record.generatedBy && typeof record.generatedBy === "object" && !Array.isArray(record.generatedBy)
    ? record.generatedBy as Record<string, unknown>
    : {};
  const runtime = record.runtime && typeof record.runtime === "object" && !Array.isArray(record.runtime)
    ? record.runtime as Record<string, unknown>
    : {};
  const auth = record.auth && typeof record.auth === "object" && !Array.isArray(record.auth)
    ? record.auth as Record<string, unknown>
    : {};
  const frontendAuth = auth.frontend && typeof auth.frontend === "object" && !Array.isArray(auth.frontend)
    ? auth.frontend as Record<string, unknown>
    : {};
  const apiAuth = auth.api && typeof auth.api === "object" && !Array.isArray(auth.api)
    ? auth.api as Record<string, unknown>
    : {};
  const playwright = record.playwright && typeof record.playwright === "object" && !Array.isArray(record.playwright)
    ? record.playwright as Record<string, unknown>
    : {};
  const auditBundleId = auditBundleIdSchema.safeParse(record.auditBundleId).success
    ? record.auditBundleId
    : "standard";

  return {
    schemaVersion: record.schemaVersion === "speclens.agent-handoff.v1"
      ? "speclens.agent-handoff.v1"
      : "speclens.agent-handoff.v1",
    auditBundleId,
    generatedBy: {
      agentId: firstString(generatedBy.agentId, generatedBy.agent, generatedBy.id, fallback.agentId) ?? fallback.agentId,
      agentName: firstString(generatedBy.agentName, generatedBy.agent, generatedBy.name, fallback.agentName) ?? fallback.agentName,
      roleId: firstString(generatedBy.roleId, generatedBy.role, fallback.roleId) ?? fallback.roleId,
      roleName: firstString(generatedBy.roleName, generatedBy.role, generatedBy.name, fallback.roleName) ?? fallback.roleName,
    },
    runtime: {
      installCommands: normalizeExecutionCommandArray(runtime.installCommands),
      buildCommands: normalizeExecutionCommandArray(runtime.buildCommands),
      startCommands: normalizeExecutionCommandArray(runtime.startCommands),
      verificationCommands: normalizeExecutionCommandArray(runtime.verificationCommands),
      packageManagers: normalizeStringArray(runtime.packageManagers),
      targets: normalizeRuntimeTargets(runtime.targets),
      workingDirectories: normalizeStringArray(runtime.workingDirectories),
      serviceDependencies: normalizeStringArray(runtime.serviceDependencies),
      envFiles: normalizeStringArray(runtime.envFiles),
      ports: normalizePorts(runtime.ports),
      baseUrls: normalizeStringArray(runtime.baseUrls),
    },
    auth: {
      frontend: {
        strategy: firstString(frontendAuth.strategy, frontendAuth.authStrategy, frontendAuth.mode),
        loginRoutes: normalizeStringArray(frontendAuth.loginRoutes),
        callbackRoutes: normalizeStringArray(frontendAuth.callbackRoutes),
        protectedRoutes: normalizeStringArray(frontendAuth.protectedRoutes),
        secretRefs: normalizeStringArray(frontendAuth.secretRefs),
        bootstrapSteps: normalizeStringArray(frontendAuth.bootstrapSteps),
        userActions: normalizeStringArray(frontendAuth.userActions),
      },
      api: {
        strategy: firstString(apiAuth.strategy, apiAuth.authStrategy, apiAuth.mode),
        loginRoutes: normalizeStringArray(apiAuth.loginRoutes),
        callbackRoutes: normalizeStringArray(apiAuth.callbackRoutes),
        protectedRoutes: normalizeStringArray(apiAuth.protectedRoutes),
        secretRefs: normalizeStringArray(apiAuth.secretRefs),
        bootstrapSteps: normalizeStringArray(apiAuth.bootstrapSteps),
        userActions: normalizeStringArray(apiAuth.userActions),
      },
    },
    playwright: {
      detected: typeof playwright.detected === "boolean"
        ? playwright.detected
        : typeof playwright.present === "boolean"
          ? playwright.present
          : normalizeStringArray(playwright.configPaths).length > 0 || normalizeExecutionCommandArray(playwright.commands).length > 0,
      runnable: typeof playwright.runnable === "boolean"
        ? playwright.runnable
        : normalizeExecutionCommandArray(playwright.commands).length > 0,
      passed: typeof playwright.passed === "boolean"
        ? playwright.passed
        : firstString(playwright.suiteStatus, playwright.status) === "passed",
      readiness: typeof playwright.readiness === "string"
        ? (playwright.readiness === "ready" || playwright.readiness === "partial" || playwright.readiness === "blocked"
            ? playwright.readiness
            : "partial")
        : typeof playwright.readiness === "object" && playwright.readiness && !Array.isArray(playwright.readiness)
          ? (firstString(
              (playwright.readiness as Record<string, unknown>).status,
              (playwright.readiness as Record<string, unknown>).state,
              (playwright.readiness as Record<string, unknown>).readiness,
            ) === "ready"
              ? "ready"
              : firstString(
                  (playwright.readiness as Record<string, unknown>).status,
                  (playwright.readiness as Record<string, unknown>).state,
                  (playwright.readiness as Record<string, unknown>).readiness,
                ) === "blocked"
                ? "blocked"
                : "partial")
          : "partial",
      suiteStatus: (() => {
        const status = firstString(playwright.suiteStatus, playwright.status);
        if (status === "detected" || status === "runnable" || status === "passed" || status === "failed" || status === "blocked") {
          return status;
        }
        if (typeof playwright.passed === "boolean") {
          return playwright.passed ? "passed" : "failed";
        }
        if (typeof playwright.runnable === "boolean") {
          return playwright.runnable ? "runnable" : "detected";
        }
        if (typeof playwright.detected === "boolean" || typeof playwright.present === "boolean") {
          return (playwright.detected === true || playwright.present === true) ? "detected" : "not-detected";
        }
        return "not-detected";
      })(),
      present: typeof playwright.present === "boolean"
        ? playwright.present
        : typeof playwright.detected === "boolean"
          ? playwright.detected
          : normalizeStringArray(playwright.configPaths).length > 0 || normalizeExecutionCommandArray(playwright.commands).length > 0,
      packageManager: firstString(playwright.packageManager),
      configPaths: normalizeStringArray(playwright.configPaths),
      commands: normalizeExecutionCommandArray(playwright.commands),
      setupCommands: normalizeExecutionCommandArray(playwright.setupCommands),
      workingDirectories: normalizeStringArray(playwright.workingDirectories),
      baseUrlStrategy: firstString(playwright.baseUrlStrategy),
      authStrategy: firstString(playwright.authStrategy, normalizeEvidenceItem(playwright.authStrategy)),
      testTargets: normalizeStringArray(playwright.testTargets),
      navigationTargets: normalizeNavigationTargets(playwright.navigationTargets),
      journeys: normalizeQaJourneys(playwright.journeys),
      assertions: normalizeStringArray(playwright.assertions),
      reporters: normalizeStringArray(playwright.reporters),
      artifacts: normalizeStringArray(playwright.artifacts),
      prerequisites: normalizeStringArray(playwright.prerequisites),
      coverageGaps: normalizeStringArray(playwright.coverageGaps),
    },
    detectedSurfaces: normalizeSurfaceDescriptors(record.detectedSurfaces),
    executionCoverage: executionCoverageSchema.parse({
      attempted: normalizeExecutionAttempts(
        record.executionCoverage && typeof record.executionCoverage === "object" && !Array.isArray(record.executionCoverage)
          ? (record.executionCoverage as Record<string, unknown>).attempted
          : [],
      ),
      skipped: normalizeExecutionAttempts(
        record.executionCoverage && typeof record.executionCoverage === "object" && !Array.isArray(record.executionCoverage)
          ? (record.executionCoverage as Record<string, unknown>).skipped
          : [],
      ),
    }),
    artifactExpectations: normalizeArtifactExpectations(record.artifactExpectations),
    remediationPacks: normalizeRemediationPacks(record.remediationPacks),
    fixHandoff: normalizeFixHandoff(record.fixHandoff),
    releaseGateDecision: normalizeReleaseGateDecision(record.releaseGateDecision),
    blockers: Array.isArray(record.blockers)
      ? record.blockers.map(normalizeBlocker).filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
    recommendations: Array.isArray(record.recommendations)
      ? record.recommendations.map(normalizeRecommendation).filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
  };
}

function normalizeRoleOutput(raw: unknown): RoleOutput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return roleOutputSchema.parse(raw);
  }

  const record = raw as Record<string, unknown>;
  const normalizedSections = Array.isArray(record.sections)
    ? record.sections.map((section, index) => {
        if (!section || typeof section !== "object" || Array.isArray(section)) {
          return section;
        }
        const sectionRecord = section as Record<string, unknown>;
        const passthroughEntries = Object.entries(sectionRecord).filter(([key]) =>
          !["id", "title", "status", "summary", "data"].includes(key));
        const data = sectionRecord.data && typeof sectionRecord.data === "object" && !Array.isArray(sectionRecord.data)
          ? sectionRecord.data
          : Object.fromEntries(passthroughEntries);
        const sectionTitle = readNonEmptyString(sectionRecord.title)
          ?? readNonEmptyString(sectionRecord.heading)
          ?? readNonEmptyString(sectionRecord.name)
          ?? readNonEmptyString(sectionRecord.label)
          ?? readNonEmptyString(sectionRecord.summary)
          ?? readNonEmptyString(sectionRecord.description)
          ?? `Section ${index + 1}`;
        const sectionSummary = readNonEmptyString(sectionRecord.summary)
          ?? readNonEmptyString(sectionRecord.description)
          ?? readNonEmptyString(sectionRecord.title)
          ?? sectionTitle;

        return {
          ...sectionRecord,
          title: sectionTitle,
          status: normalizeSectionStatus(sectionRecord.status),
          summary: sectionSummary,
          data,
        };
      })
    : record.sections;
  const normalizedFindings = Array.isArray(record.findings)
    ? record.findings.map(finding => {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
          return finding;
        }
        const findingRecord = finding as Record<string, unknown>;
        const normalizedEvidence = Array.isArray(findingRecord.evidence)
          ? findingRecord.evidence
            .map(normalizeEvidenceItem)
            .filter((item): item is string => Boolean(item))
          : [];
        const fallbackTitle = readNonEmptyString(findingRecord.title)
          ?? readNonEmptyString(findingRecord.summary)
          ?? readNonEmptyString(findingRecord.description)
          ?? readNonEmptyString(findingRecord.message)
          ?? normalizedEvidence[0]
          ?? "Unclassified finding";
        const fallbackMessage = readNonEmptyString(findingRecord.message)
          ?? readNonEmptyString(findingRecord.summary)
          ?? readNonEmptyString(findingRecord.description)
          ?? readNonEmptyString(findingRecord.title)
          ?? normalizedEvidence[0]
          ?? "No additional detail was provided by the agent.";
        const fallbackSuggestion = readNonEmptyString(findingRecord.suggestion)
          ?? readNonEmptyString(findingRecord.recommendation)
          ?? readNonEmptyString(findingRecord.action)
          ?? readNonEmptyString(findingRecord.nextStep)
          ?? fallbackMessage
          ?? "Investigate the issue and document a concrete remediation plan.";
        return {
          ...findingRecord,
          category: normalizeFindingCategory(findingRecord.category),
          title: fallbackTitle,
          severity: normalizeFindingSeverity(
            findingRecord.severity
            ?? findingRecord.priority
            ?? findingRecord.level
            ?? findingRecord.risk
            ?? findingRecord.impact,
          ),
          message: readNonEmptyString(findingRecord.message) ?? fallbackMessage,
          suggestion: readNonEmptyString(findingRecord.suggestion) ?? fallbackSuggestion,
          evidence: normalizedEvidence,
        };
      })
    : record.findings;

  return roleOutputSchema.parse({
    ...record,
    sections: normalizedSections,
    findings: normalizedFindings,
  });
}

function readRoleOutput(outputPath: string): RoleOutput {
  if (!fs.existsSync(outputPath)) {
    throw new Error("Codex did not emit an output file.");
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  return normalizeRoleOutput(parseJsonFromOutput(raw));
}

function compactPromptValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map(item => compactPromptValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 4) {
      return "[truncated]";
    }
    const entries = Object.entries(value as Record<string, unknown>);
    const limitedEntries = entries.slice(0, 15).map(([key, item]) => [key, compactPromptValue(item, depth + 1)]);
    return {
      ...Object.fromEntries(limitedEntries),
      ...(entries.length > limitedEntries.length
        ? { __truncatedKeys: entries.length - limitedEntries.length }
        : {}),
    };
  }
  return String(value);
}

function formatPriorRoleOutputsForPrompt(priorOutputs: PriorRoleOutput[]): string {
  if (priorOutputs.length === 0) {
    return "[]";
  }

  return JSON.stringify(
    priorOutputs.slice(-6).map(item => ({
      roleId: item.roleId,
      roleName: item.roleName,
      summary: item.output.summary,
      sections: item.output.sections.map(section => ({
        title: section.title,
        status: section.status,
        summary: section.summary,
        data: compactPromptValue(section.data),
      })),
      findings: item.output.findings.map(finding => ({
        severity: finding.severity,
        title: finding.title,
        message: compactPromptValue(finding.message),
        suggestion: compactPromptValue(finding.suggestion),
        evidence: compactPromptValue(finding.evidence),
      })),
    })),
    null,
    2,
  );
}

function formatLearnablesForPrompt(learnables: Learnable[]): string {
  if (learnables.length === 0) {
    return "[]";
  }

  return JSON.stringify(
    learnables.slice(0, 20).map(learnable => ({
      statement: learnable.statement,
      category: learnable.category,
      evidence: compactPromptValue(learnable.evidence),
    })),
    null,
    2,
  );
}

function selectRoleContext(
  dependsOnRoleIds: string[],
  priorOutputs: PriorRoleOutput[],
): PriorRoleOutput[] {
  if (dependsOnRoleIds.length === 0) {
    return priorOutputs;
  }
  const dependencySet = new Set(dependsOnRoleIds);
  return priorOutputs.filter(item => dependencySet.has(item.roleId));
}

function validateStandardizedRoleOutput(
  output: RoleOutput,
  context: {
    agentId: string;
    agentName: string;
    roleId: string;
    roleName: string;
  },
): RoleOutput {
  const handoffSection = output.sections.find(section => section.title === "Standardized JSON handoff");
  if (!handoffSection) {
    throw new Error(`Role "Standardized JSON output" in ${context.agentName} must emit a "Standardized JSON handoff" section.`);
  }

  const normalizedHandoff = standardizedAgentHandoffSchema.parse(
    normalizeStandardizedHandoff(handoffSection.data.standardizedOutput, context),
  );
  return {
    ...output,
    sections: output.sections.map(section =>
      section.title === "Standardized JSON handoff"
        ? {
            ...section,
            data: {
              ...section.data,
              standardizedOutput: normalizedHandoff,
            },
          }
        : section),
  };
}

function collectToolCapabilities(
  skills: Array<{ toolCapabilities: AiToolCapability[] }>,
): AiToolCapability[] {
  return [...new Set(skills.flatMap(skill => skill.toolCapabilities))];
}

function resolveSandboxMode(toolCapabilities: AiToolCapability[]): CodexSandboxMode {
  return toolCapabilities.some(capability =>
    capability === "shell-exec"
    || capability === "browser-automation"
    || capability === "artifact-write"
    || capability === "package-install"
    || capability === "dev-server"
    || capability === "test-exec")
    ? "workspace-write"
    : "read-only";
}

function buildRolePrompt(options: {
  agentName: string;
  roleName: string;
  roleId: string;
  roleDescription: string | null;
  pairedSourceContext?: {
    primaryDisplayName: string;
    primaryType: string;
    companionDisplayName: string;
    companionType: string;
  } | null;
  rolePrompt: string;
  skills: Array<{ name: string; instructions: string; toolCapabilities: AiToolCapability[] }>;
  priorOutputs: PriorRoleOutput[];
  learnables: Learnable[];
  nativeExecutorOutput?: RoleOutput | null;
}): string {
  const skillBlock = options.skills.length === 0
    ? "- None"
    : options.skills.map(skill => {
      const toolLabel = skill.toolCapabilities.length > 0
        ? ` [tools: ${skill.toolCapabilities.join(", ")}]`
        : "";
      return `- ${skill.name}${toolLabel}: ${skill.instructions}`;
    }).join("\n");
  const grantedTools = collectToolCapabilities(options.skills);
  const priorOutputsBlock = formatPriorRoleOutputsForPrompt(options.priorOutputs);
  const learnablesBlock = formatLearnablesForPrompt(options.learnables);

  return [
    `You are the \"${options.roleName}\" role (id: ${options.roleId}) in the ${options.agentName} agent run.`,
    options.roleDescription ? `Role description: ${options.roleDescription}` : null,
    options.pairedSourceContext
      ? [
          "Paired source context:",
          `- The temp workspace contains \`primary/\` for the main source (${options.pairedSourceContext.primaryDisplayName}, ${options.pairedSourceContext.primaryType}).`,
          `- The temp workspace contains \`companion/\` for the linked source (${options.pairedSourceContext.companionDisplayName}, ${options.pairedSourceContext.companionType}).`,
          "- Compare both sources when it improves accuracy, especially for deployed-site-versus-code analysis.",
        ].join("\n")
      : null,
    "Skills:",
    skillBlock,
    "Granted tools:",
    grantedTools.length > 0 ? `- ${grantedTools.join("\n- ")}` : "- repo-read",
    "Completed role handoff context (JSON):",
    priorOutputsBlock,
    options.nativeExecutorOutput
      ? [
          "Deterministic native executor output for this same role (JSON):",
          JSON.stringify(options.nativeExecutorOutput, null, 2),
        ].join("\n")
      : null,
    "Active source learnables (JSON):",
    learnablesBlock,
    "Task:",
    options.rolePrompt,
    "Constraints:",
    "- Work only with files and generated artifacts in the current job workspace.",
    "- You may use granted tools to inspect or execute work inside the temporary job workspace.",
    "- Do not make lasting source changes or write deliverables outside the requested JSON output.",
    "- Use prior role outputs when they are relevant, but prefer current repository evidence if there is a conflict.",
    "- Treat learnables as prior repository knowledge, but verify them against current repo evidence whenever possible.",
    "- If learnables conflict with current evidence, trust the current evidence and note the mismatch.",
    "- Return ONLY valid JSON that matches the provided schema.",
    "- Do not wrap the JSON in Markdown fences.",
    "Output shape reminder:",
    "{\n  \"summary\": \"...\",\n  \"sections\": [...],\n  \"findings\": [...]\n}",
  ].filter(Boolean).join("\n\n");
}

function dedupeLearnables(learnables: LearnableSeed[]): LearnableSeed[] {
  const seen = new Set<string>();
  const deduped: LearnableSeed[] = [];
  for (const learnable of learnables) {
    const statement = learnable.statement.trim();
    if (!statement) {
      continue;
    }
    const key = `${learnable.category}:${statement.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...learnable,
      statement,
    });
  }
  return deduped.map((learnable, index) => ({
    ...learnable,
    order: learnable.order ?? index,
  }));
}

function buildCommandLearnable(prefix: string, command: {
  label: string;
  command: string;
  workingDirectory: string | null;
  purpose: string | null;
}, category: Learnable["category"], evidence: string[] = []): LearnableSeed {
  const details = [
    command.command,
    command.workingDirectory ? `from ${command.workingDirectory}` : null,
    command.purpose ? `for ${command.purpose}` : null,
  ].filter(Boolean).join(" ");
  return {
    statement: `${prefix} ${details}.`,
    category,
    evidence,
  };
}

function synthesizeLearnablesFromHandoff(output: ReturnType<typeof standardizedAgentHandoffSchema.parse>): LearnableSeed[] {
  const learnables: LearnableSeed[] = [];

  for (const command of output.runtime.installCommands.slice(0, 2)) {
    learnables.push(buildCommandLearnable("Install dependencies with", command, "runtime"));
  }
  for (const command of output.runtime.buildCommands.slice(0, 2)) {
    learnables.push(buildCommandLearnable("Build the repository with", command, "runtime"));
  }
  for (const command of output.runtime.startCommands.slice(0, 2)) {
    learnables.push(buildCommandLearnable("Start the repository with", command, "runtime"));
  }
  for (const command of output.runtime.verificationCommands.slice(0, 2)) {
    learnables.push(buildCommandLearnable("Verify the repository with", command, "runtime"));
  }
  for (const packageManager of output.runtime.packageManagers.slice(0, 3)) {
    learnables.push({
      statement: `The repository uses ${packageManager} as a package manager or task runner.`,
      category: "runtime",
      evidence: [packageManager],
    });
  }
  for (const target of output.runtime.targets.slice(0, 4)) {
    const parts = [
      target.kind ? `${target.kind} target` : "Application target",
      target.label,
      target.workingDirectory ? `from ${target.workingDirectory}` : null,
      target.baseUrl ? `at ${target.baseUrl}` : null,
    ].filter(Boolean).join(" ");
    learnables.push({
      statement: `${parts}.`,
      category: "runtime",
      evidence: [
        ...(target.startCommand ? [target.startCommand] : []),
        ...(target.healthUrls ?? []),
      ],
    });
  }

  for (const workingDirectory of output.runtime.workingDirectories.slice(0, 3)) {
    learnables.push({
      statement: `Important working directory: ${workingDirectory}.`,
      category: "runtime",
      evidence: [workingDirectory],
    });
  }
  for (const serviceDependency of output.runtime.serviceDependencies.slice(0, 3)) {
    learnables.push({
      statement: `The repository depends on the ${serviceDependency} service during setup or execution.`,
      category: "runtime",
      evidence: [serviceDependency],
    });
  }
  for (const envFile of output.runtime.envFiles.slice(0, 3)) {
    learnables.push({
      statement: `Configuration hints are available in ${envFile}.`,
      category: "runtime",
      evidence: [envFile],
    });
  }
  for (const baseUrl of output.runtime.baseUrls.slice(0, 3)) {
    learnables.push({
      statement: `A likely base URL for this repository is ${baseUrl}.`,
      category: "runtime",
      evidence: [baseUrl],
    });
  }

  if (output.auth.frontend.strategy) {
    learnables.push({
      statement: `Frontend authentication uses the ${output.auth.frontend.strategy} strategy.`,
      category: "auth",
      evidence: output.auth.frontend.loginRoutes,
    });
  }
  for (const route of output.auth.frontend.loginRoutes.slice(0, 3)) {
    learnables.push({
      statement: `Frontend login starts at ${route}.`,
      category: "auth",
      evidence: [route],
    });
  }
  for (const route of output.auth.frontend.callbackRoutes.slice(0, 3)) {
    learnables.push({
      statement: `Frontend auth callbacks return to ${route}.`,
      category: "auth",
      evidence: [route],
    });
  }
  for (const route of output.auth.api.protectedRoutes.slice(0, 3)) {
    learnables.push({
      statement: `API protection applies to ${route}.`,
      category: "auth",
      evidence: [route],
    });
  }
  for (const secretRef of [...output.auth.frontend.secretRefs, ...output.auth.api.secretRefs].slice(0, 5)) {
    learnables.push({
      statement: `A required auth secret reference is ${secretRef}.`,
      category: "auth",
      evidence: [secretRef],
    });
  }
  for (const step of [...output.auth.frontend.bootstrapSteps, ...output.auth.api.bootstrapSteps].slice(0, 5)) {
    learnables.push({
      statement: step.endsWith(".") ? step : `${step}.`,
      category: "auth",
    });
  }
  for (const action of [...output.auth.frontend.userActions, ...output.auth.api.userActions].slice(0, 5)) {
    learnables.push({
      statement: action.endsWith(".") ? action : `${action}.`,
      category: "auth",
    });
  }

  if (output.playwright.present) {
    learnables.push({
      statement: `Playwright coverage is present and currently marked ${output.playwright.readiness}.`,
      category: "playwright",
      evidence: output.playwright.configPaths,
    });
  }
  for (const configPath of output.playwright.configPaths.slice(0, 3)) {
    learnables.push({
      statement: `Playwright configuration is defined in ${configPath}.`,
      category: "playwright",
      evidence: [configPath],
    });
  }
  for (const command of output.playwright.commands.slice(0, 2)) {
    learnables.push(buildCommandLearnable("Run Playwright with", command, "playwright"));
  }
  for (const command of output.playwright.setupCommands.slice(0, 2)) {
    learnables.push(buildCommandLearnable("Prepare Playwright with", command, "playwright"));
  }
  for (const workingDirectory of output.playwright.workingDirectories.slice(0, 3)) {
    learnables.push({
      statement: `Playwright work is centered in ${workingDirectory}.`,
      category: "playwright",
      evidence: [workingDirectory],
    });
  }
  if (output.playwright.authStrategy) {
    learnables.push({
      statement: `Playwright authentication should follow this strategy: ${output.playwright.authStrategy}.`,
      category: "playwright",
      evidence: output.playwright.testTargets,
    });
  }
  for (const target of output.playwright.navigationTargets.slice(0, 4)) {
    learnables.push({
      statement: `Important browser navigation target: ${target.path}${target.requiresAuth ? " (auth required)" : ""}.`,
      category: "playwright",
      evidence: [target.path],
    });
  }
  for (const journey of output.playwright.journeys.slice(0, 3)) {
    learnables.push({
      statement: `Critical QA journey: ${journey.title}.`,
      category: "playwright",
      evidence: journey.steps,
    });
  }
  for (const prerequisite of output.playwright.prerequisites.slice(0, 5)) {
    learnables.push({
      statement: prerequisite.endsWith(".") ? prerequisite : `${prerequisite}.`,
      category: "playwright",
    });
  }
  for (const gap of output.playwright.coverageGaps.slice(0, 4)) {
    learnables.push({
      statement: `Playwright coverage gap: ${gap}.`,
      category: "ops",
      evidence: output.playwright.testTargets,
    });
  }
  for (const blocker of output.blockers.slice(0, 5)) {
    const normalizedBlocker = standardizedAgentBlockerSchema.parse(blocker);
    learnables.push({
      statement: `Caution: ${normalizedBlocker.title} - ${normalizedBlocker.message}`,
      category: "ops",
      evidence: normalizedBlocker.evidence,
    });
  }

  return dedupeLearnables(learnables).slice(0, 24);
}

function synthesizeLearnablesFromReport(report: AnalysisReport): LearnableSeed[] {
  const handoffSection = report.sections.find(section => section.title === "Standardized JSON handoff");
  if (handoffSection?.data?.standardizedOutput) {
    return synthesizeLearnablesFromHandoff(
      standardizedAgentHandoffSchema.parse(handoffSection.data.standardizedOutput),
    );
  }

  return dedupeLearnables(
    report.sections
      .filter(section => section.status === "ready" && section.summary.trim().length > 0)
      .slice(0, 12)
      .map((section, index) => ({
        statement: `${section.title}: ${section.summary}`,
        category: index === 0 ? "repo-shape" : "ops",
        evidence: [],
        order: index,
      })),
  );
}

function resolveAuditBundleId(agentId: string): z.infer<typeof auditBundleIdSchema> {
  if (
    agentId === "agent-universal-smoke"
    || agentId === "agent-e2e-smoke"
    || agentId === "agent-e2e-remediation"
  ) {
    return "smoke";
  }
  if (agentId === "agent-universal-exhaustive") {
    return "exhaustive";
  }
  return "standard";
}

function getStandardizedHandoffFromSections(sections: AnalysisReport["sections"]): StandardizedHandoff | null {
  const handoffSection = sections.find(section => section.title === "Standardized JSON handoff");
  if (!handoffSection?.data?.standardizedOutput) {
    return null;
  }
  try {
    return standardizedAgentHandoffSchema.parse(handoffSection.data.standardizedOutput);
  } catch {
    return null;
  }
}

function buildCategoryCounts(findings: AnalysisReport["findings"]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, finding) => {
    const category = normalizeFindingCategory(finding.category, finding.roleId);
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});
}

function buildRemediationPacks(findings: AnalysisReport["findings"]): z.infer<typeof remediationPackSchema>[] {
  const grouped = new Map<string, AnalysisReport["findings"]>();
  for (const finding of findings) {
    const category = normalizeFindingCategory(finding.category, finding.roleId);
    const existing = grouped.get(category) ?? [];
    existing.push(finding);
    grouped.set(category, existing);
  }

  const packs = [...grouped.entries()].map(([category, categoryFindings]) => {
    const hasHigh = categoryFindings.some(finding => finding.severity === "high");
    const hasMedium = categoryFindings.some(finding => finding.severity === "medium");
    const ownerRoleId = categoryFindings[0]?.roleId ?? null;
    const title = `${category.replace(/(^|-)([a-z])/g, (_, prefix, character) => `${prefix === "-" ? " " : ""}${String(character).toUpperCase()}`)} remediation`;
    const summary = `${categoryFindings.length} finding(s) in the ${category} category require follow-up.`;
    const actions = [...new Set(categoryFindings.map(finding => finding.suggestion.trim()).filter(Boolean))].slice(0, 6);
    const packId = `pack-${category}`;
    return remediationPackSchema.parse({
      id: packId,
      title,
      summary,
      priority: hasHigh ? "high" : hasMedium ? "medium" : "low",
      category,
      ownerRoleId,
      findingIds: categoryFindings.map(finding => finding.id),
      actions,
      testingNotes: [`Re-run the ${category} audit flow after fixes land.`],
    });
  });

  return packs.sort((left, right) => {
    const priorityScore = { high: 3, medium: 2, low: 1 } as const;
    return priorityScore[right.priority] - priorityScore[left.priority] || left.title.localeCompare(right.title);
  });
}

function attachRemediationPackIds(
  findings: AnalysisReport["findings"],
  remediationPacks: z.infer<typeof remediationPackSchema>[],
): AnalysisReport["findings"] {
  const packIdsByFindingId = new Map<string, string[]>();
  for (const pack of remediationPacks) {
    for (const findingId of pack.findingIds) {
      const next = packIdsByFindingId.get(findingId) ?? [];
      next.push(pack.id);
      packIdsByFindingId.set(findingId, next);
    }
  }
  return findings.map(finding => ({
    ...finding,
    category: normalizeFindingCategory(finding.category, finding.roleId),
    remediationPackIds: packIdsByFindingId.get(finding.id) ?? [],
  }));
}

function createExecutionAttempt(
  id: string,
  title: string,
  status: "attempted" | "succeeded" | "skipped" | "failed",
  detail: string | null,
  evidence: string[] = [],
) {
  return {
    id,
    title,
    status,
    detail,
    evidence,
  };
}

function buildExecutionCoverage(
  sections: AnalysisReport["sections"],
  handoff: StandardizedHandoff | null,
): z.infer<typeof executionCoverageSchema> {
  const attempted = [...(handoff?.executionCoverage.attempted ?? [])];
  const skipped = [...(handoff?.executionCoverage.skipped ?? [])];
  const hasAttempt = (collection: typeof attempted, id: string) => collection.some(item => item.id === id);

  for (const section of sections) {
    if (section.title === "Runtime execution" && !hasAttempt(attempted, "runtime-execution") && !hasAttempt(skipped, "runtime-execution")) {
      const targetLabel = typeof section.data.target === "object" && section.data.target && !Array.isArray(section.data.target)
        ? firstString((section.data.target as Record<string, unknown>).label)
        : null;
      const attempt = createExecutionAttempt(
        "runtime-execution",
        "Runtime execution",
        section.status === "ready" ? "succeeded" : "failed",
        section.summary,
        normalizeStringArray([targetLabel, typeof section.data.runtimeLog === "string" ? section.data.runtimeLog : null]),
      );
      attempted.push(attempt);
      continue;
    }
    if (section.title === "Playwright suite execution" && !hasAttempt(attempted, "repo-playwright") && !hasAttempt(skipped, "repo-playwright")) {
      const command = typeof section.data.command === "object" && section.data.command && !Array.isArray(section.data.command)
        ? firstString((section.data.command as Record<string, unknown>).command)
        : null;
      const entry = createExecutionAttempt(
        "repo-playwright",
        "Repository Playwright suite",
        section.status === "ready" ? "succeeded" : (command ? "failed" : "skipped"),
        section.summary,
        normalizeStringArray([command, typeof section.data.logPath === "string" ? section.data.logPath : null]),
      );
      if (entry.status === "skipped") {
        skipped.push(entry);
      } else {
        attempted.push(entry);
      }
      continue;
    }
    if (section.title === "Browser QA execution" && !hasAttempt(attempted, "browser-qa") && !hasAttempt(skipped, "browser-qa")) {
      const tracePath = typeof section.data.tracePath === "string" ? section.data.tracePath : null;
      const entry = createExecutionAttempt(
        "browser-qa",
        "Direct browser QA",
        section.status === "ready" ? "succeeded" : "failed",
        section.summary,
        normalizeStringArray([tracePath]),
      );
      attempted.push(entry);
    }
  }

  return executionCoverageSchema.parse({
    attempted,
    skipped,
  });
}

function buildArtifactAudit(
  handoff: StandardizedHandoff | null,
  artifacts: AnalysisReport["artifacts"],
) {
  const expectedKinds = [...new Set((handoff?.artifactExpectations ?? []).map(expectation => expectation.kind))];
  const presentKinds = [...new Set(artifacts.map(artifact => artifact.kind ?? "artifact"))];
  const missingKinds = expectedKinds.filter(kind => !presentKinds.includes(kind));
  const invalidArtifacts = artifacts
    .filter(artifact => !artifact.key || artifact.sizeBytes < 0)
    .map(artifact => artifact.key);
  return {
    expectedKinds,
    presentKinds,
    missingKinds,
    invalidArtifacts,
  };
}

function buildArtifactAnalysis(
  handoff: StandardizedHandoff | null,
  artifacts: AnalysisReport["artifacts"],
) {
  const audit = buildArtifactAudit(handoff, artifacts);
  const producedByKind = artifacts.reduce<Record<string, number>>((acc, artifact) => {
    const kind = artifact.kind ?? "artifact";
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  const notableArtifacts = artifacts
    .slice(0, 8)
    .map(artifact => ({
      kind: artifact.kind ?? "artifact",
      key: artifact.key,
      mimeType: artifact.mimeType ?? null,
    }));
  const summary = audit.missingKinds.length > 0
    ? `Produced ${artifacts.length} artifact(s), but required kinds are missing: ${audit.missingKinds.join(", ")}.`
    : `Produced ${artifacts.length} artifact(s) across ${audit.presentKinds.length || 1} kind(s) with no required gaps.`;
  return artifactAnalysisSchema.parse({
    ...audit,
    producedCount: artifacts.length,
    producedByKind,
    notableArtifacts,
    summary,
  });
}

function buildCapabilityGaps(
  handoff: StandardizedHandoff | null,
  report: AnalysisReport,
  artifactAnalysis: z.infer<typeof artifactAnalysisSchema>,
): z.infer<typeof capabilityGapSchema>[] {
  const gaps: z.infer<typeof capabilityGapSchema>[] = [];
  const pushGap = (gap: Omit<z.infer<typeof capabilityGapSchema>, "id">) => {
    if (gaps.some(existing => existing.title === gap.title && existing.scope === gap.scope)) {
      return;
    }
    gaps.push(capabilityGapSchema.parse({
      id: createId("capgap"),
      ...gap,
    }));
  };

  for (const blocker of handoff?.blockers ?? []) {
    pushGap({
      scope: blocker.title.toLowerCase().includes("auth") ? "auth" : "ops",
      severity: blocker.severity,
      title: blocker.title,
      summary: blocker.message,
      missingCapabilities: [],
      affectedSurfaces: [],
      suggestedActions: [],
      evidence: blocker.evidence,
    });
  }

  for (const gap of handoff?.playwright.coverageGaps ?? []) {
    pushGap({
      scope: "browser",
      severity: "medium",
      title: "Browser coverage gap",
      summary: gap,
      missingCapabilities: ["browser-automation"],
      affectedSurfaces: (handoff?.playwright.navigationTargets ?? []).map(target => target.path),
      suggestedActions: ["Expand documented browser journeys and assertions for the uncovered surface."],
      evidence: [gap],
    });
  }

  if ((handoff?.runtime.targets.length ?? 0) === 0) {
    pushGap({
      scope: "runtime",
      severity: "medium",
      title: "No confident runtime target",
      summary: "The audit could not resolve a high-confidence runtime boot target.",
      missingCapabilities: ["dev-server"],
      affectedSurfaces: handoff?.detectedSurfaces.map(surface => surface.label) ?? [],
      suggestedActions: ["Document a bootable application target with a health URL and working directory."],
      evidence: handoff?.runtime.workingDirectories ?? [],
    });
  }

  for (const attempt of report.summary.executionCoverage.skipped) {
    pushGap({
      scope: attempt.title.toLowerCase().includes("browser") ? "browser" : "ops",
      severity: "medium",
      title: `${attempt.title} skipped`,
      summary: attempt.detail ?? "Execution was skipped.",
      missingCapabilities: [],
      affectedSurfaces: [],
      suggestedActions: ["Close the skipped execution path or document why it is intentionally unsupported."],
      evidence: attempt.evidence,
    });
  }

  if (artifactAnalysis.missingKinds.length > 0) {
    pushGap({
      scope: "artifact",
      severity: "high",
      title: "Required artifacts missing",
      summary: `Missing artifact kinds: ${artifactAnalysis.missingKinds.join(", ")}.`,
      missingCapabilities: ["artifact-write"],
      affectedSurfaces: artifactAnalysis.missingKinds,
      suggestedActions: ["Persist the required artifacts so QA and audit review can inspect the full execution evidence."],
      evidence: artifactAnalysis.missingKinds,
    });
  }

  const playwright = handoff?.playwright;
  if (playwright && playwright.detected === false && report.jobId) {
    pushGap({
      scope: "skill",
      severity: "low",
      title: "No repository-native Playwright suite",
      summary: "The audit relied on direct browser QA because no repo-native Playwright suite was detected.",
      missingCapabilities: ["test-exec"],
      affectedSurfaces: handoff?.detectedSurfaces.map(surface => surface.label) ?? [],
      suggestedActions: ["Add a repo-native Playwright suite for stable, repeatable browser assertions."],
      evidence: handoff?.playwright.configPaths ?? [],
    });
  }

  if (playwright && playwright.detected && !playwright.runnable) {
    pushGap({
      scope: "skill",
      severity: "medium",
      title: "Repository-native Playwright suite is not runnable",
      summary: "The audit detected Playwright configuration, but it could not verify a runnable repository-native suite.",
      missingCapabilities: ["test-exec"],
      affectedSurfaces: handoff?.detectedSurfaces.map(surface => surface.label) ?? [],
      suggestedActions: ["Fix the Playwright command, dependencies, or startup prerequisites until the suite is runnable."],
      evidence: [...playwright.configPaths, ...playwright.commands.map(command => command.command)],
    });
  }

  if (playwright && playwright.runnable && !playwright.passed) {
    pushGap({
      scope: "browser",
      severity: playwright.suiteStatus === "blocked" ? "high" : "medium",
      title: "Repository-native Playwright validation did not pass",
      summary: "The audit found a runnable Playwright suite, but it did not pass cleanly during verification.",
      missingCapabilities: [],
      affectedSurfaces: handoff?.detectedSurfaces.map(surface => surface.label) ?? [],
      suggestedActions: ["Fix the failing Playwright assertions or unblock the suite prerequisites before relying on it for QA coverage."],
      evidence: [...playwright.configPaths, ...playwright.commands.map(command => command.command), ...playwright.coverageGaps],
    });
  }

  return gaps;
}

function buildQualityScorecard(
  report: AnalysisReport,
  artifactAnalysis: z.infer<typeof artifactAnalysisSchema>,
  capabilityGaps: z.infer<typeof capabilityGapSchema>[],
): z.infer<typeof qualityScorecardSchema> {
  const findings = report.findings;
  const sections = report.sections;
  const evidenceBackedFindings = findings.filter(finding => finding.evidence.length > 0 || finding.evidenceRefs.length > 0).length;
  const evidenceScore = findings.length === 0
    ? 100
    : clampPercent((evidenceBackedFindings / findings.length) * 100);
  const attempted = report.summary.executionCoverage.attempted;
  const succeededAttempts = attempted.filter(item => item.status === "succeeded").length;
  const executionScore = attempted.length === 0
    ? 50
    : clampPercent((succeededAttempts / attempted.length) * 100);
  const artifactsPenalty = (artifactAnalysis.missingKinds.length * 25) + (artifactAnalysis.invalidArtifacts.length * 20);
  const artifactsScore = clampPercent(100 - artifactsPenalty);
  const transparencySignals = [
    report.sections.some(section => section.title === "Standardized JSON handoff"),
    report.sections.some(section => section.title === "Artifact audit"),
    report.sections.some(section => section.title === "Release gate"),
    report.summary.releaseGateDecision !== null,
  ].filter(Boolean).length;
  const transparencyScore = clampPercent((transparencySignals / 4) * 100);
  const capabilityPenalty = capabilityGaps.reduce((total, gap) => total + (gap.severity === "high" ? 35 : gap.severity === "medium" ? 18 : 8), 0);
  const capabilityScore = clampPercent(100 - capabilityPenalty);

  const dimensions = [
    {
      id: "evidence" as const,
      label: "Evidence quality",
      score: evidenceScore,
      rationale: findings.length === 0
        ? "No findings required evidence calibration for this run."
        : `${evidenceBackedFindings} of ${findings.length} finding(s) carried direct evidence.`,
      evidence: findings.slice(0, 5).flatMap(finding => finding.evidence.slice(0, 1)),
    },
    {
      id: "execution" as const,
      label: "Execution coverage",
      score: executionScore,
      rationale: `${succeededAttempts} of ${attempted.length} attempted execution path(s) succeeded.`,
      evidence: attempted.slice(0, 5).map(item => item.title),
    },
    {
      id: "artifacts" as const,
      label: "Artifact completeness",
      score: artifactsScore,
      rationale: artifactAnalysis.summary,
      evidence: artifactAnalysis.presentKinds,
    },
    {
      id: "transparency" as const,
      label: "Transparency",
      score: transparencyScore,
      rationale: `${transparencySignals} of 4 transparency signals were present in the report.`,
      evidence: sections.slice(0, 6).map(section => section.title),
    },
    {
      id: "capability" as const,
      label: "Capability fit",
      score: capabilityScore,
      rationale: capabilityGaps.length > 0
        ? `${capabilityGaps.length} capability gap(s) reduced confidence in the audit coverage.`
        : "No explicit capability gaps were detected from the execution evidence.",
      evidence: capabilityGaps.slice(0, 5).map(gap => gap.title),
    },
  ];

  const roleScores = report.roles.map(role => {
    const roleSections = sections.filter(section => section.roleId === role.id);
    const findingCount = findings.filter(finding => finding.roleId === role.id).length;
    const hasReady = roleSections.some(section => section.status === "ready");
    const hasPlanned = roleSections.some(section => section.status === "planned");
    const hasSkipped = roleSections.some(section => section.status === "skipped");
    const status = hasReady ? "ready" : hasPlanned ? "planned" : hasSkipped ? "skipped" : "missing";
    const score = clampPercent(
      status === "ready"
        ? 100 - (findings.filter(finding => finding.roleId === role.id && finding.severity === "high").length * 25)
        : status === "planned"
          ? 55
          : status === "skipped"
            ? 35
            : 0,
    );
    return {
      roleId: role.id,
      title: role.title,
      status,
      score,
      findingCount,
      rationale: roleSections.length > 0
        ? `${roleSections.length} section(s) and ${findingCount} finding(s) were produced.`
        : "No role-backed report section was produced.",
    };
  });

  const skills = new Map<string, { name: string; roleIds: string[]; scores: number[] }>();
  for (const role of report.roles) {
    const roleScore = roleScores.find(item => item.roleId === role.id)?.score ?? 0;
    for (const skill of role.skills) {
      const existing = skills.get(skill.id) ?? { name: skill.name, roleIds: [], scores: [] };
      existing.roleIds.push(role.id);
      existing.scores.push(roleScore);
      skills.set(skill.id, existing);
    }
  }

  const skillScores = [...skills.entries()].map(([skillId, skill]) => ({
    skillId,
    name: skill.name,
    score: clampPercent(skill.scores.reduce((total, value) => total + value, 0) / Math.max(1, skill.scores.length)),
    coveredByRoleIds: skill.roleIds,
    rationale: `${skill.roleIds.length} role(s) exercised this skill during the audit plan.`,
  }));

  const overallScore = clampPercent(dimensions.reduce((total, item) => total + item.score, 0) / dimensions.length);
  const warnings = [
    ...(artifactAnalysis.missingKinds.length > 0 ? [`Missing artifact kinds: ${artifactAnalysis.missingKinds.join(", ")}.`] : []),
    ...capabilityGaps.slice(0, 5).map(gap => gap.title),
  ];

  return qualityScorecardSchema.parse({
    overallScore,
    dimensions,
    roleScores,
    skillScores,
    warnings,
  });
}

function buildReleaseGateDecision(
  bundleId: z.infer<typeof auditBundleIdSchema>,
  findings: AnalysisReport["findings"],
  artifactAudit: ReturnType<typeof buildArtifactAudit>,
): NonNullable<AnalysisReport["summary"]["releaseGateDecision"]> {
  const highFindings = findings.filter(finding => finding.severity === "high");
  const mediumFindings = findings.filter(finding => finding.severity === "medium");
  const blockingFindingIds = highFindings.map(finding => finding.id);
  if (highFindings.length > 0 || artifactAudit.missingKinds.length > 0) {
    return releaseGateDecisionSchema.parse({
      status: "fail",
      reason: highFindings.length > 0
        ? `${highFindings.length} high-severity finding(s) block release readiness.`
        : `Required artifact kinds are missing: ${artifactAudit.missingKinds.join(", ")}.`,
      confidence: bundleId === "exhaustive" ? "high" : "medium",
      blockingFindingIds,
    });
  }
  if (mediumFindings.length > 0 || (bundleId === "exhaustive" && findings.length > 0)) {
    return releaseGateDecisionSchema.parse({
      status: "warn",
      reason: mediumFindings.length > 0
        ? `${mediumFindings.length} medium-severity finding(s) remain open.`
        : "The exhaustive bundle found low-severity gaps that should be closed before broad release.",
      confidence: bundleId === "smoke" ? "medium" : "high",
      blockingFindingIds: [],
    });
  }
  return releaseGateDecisionSchema.parse({
    status: "pass",
    reason: "No blocking findings remain for the selected audit bundle.",
    confidence: bundleId === "smoke" ? "medium" : "high",
    blockingFindingIds: [],
  });
}

function upsertSummarySection(
  sections: AnalysisReport["sections"],
  roleId: string,
  title: string,
  summary: string,
  data: Record<string, unknown>,
): AnalysisReport["sections"] {
  const nextSection = {
    id: createId("section"),
    roleId,
    title,
    status: "ready" as const,
    summary,
    data,
  };
  const index = sections.findIndex(section => section.title === title);
  if (index === -1) {
    return [...sections, nextSection];
  }
  return sections.map((section, sectionIndex) => sectionIndex === index ? { ...nextSection, id: section.id, roleId: section.roleId || roleId } : section);
}

function enrichReportForUniversalAudit(report: AnalysisReport, agentId: string): AnalysisReport {
  const handoff = getStandardizedHandoffFromSections(report.sections);
  const auditBundleId = handoff?.auditBundleId ?? resolveAuditBundleId(agentId);
  const remediationPacks = handoff?.remediationPacks?.length
    ? handoff.remediationPacks
    : buildRemediationPacks(report.findings);
  const fixHandoff = handoff?.fixHandoff ?? null;
  const findings = attachRemediationPackIds(report.findings, remediationPacks);
  const executionCoverage = buildExecutionCoverage(report.sections, handoff);
  const reportWithCoverage = {
    ...report,
    findings,
    summary: {
      ...report.summary,
      executionCoverage,
    },
  };
  const artifactAnalysis = buildArtifactAnalysis(handoff, report.artifacts);
  const artifactAudit = {
    expectedKinds: artifactAnalysis.expectedKinds,
    presentKinds: artifactAnalysis.presentKinds,
    missingKinds: artifactAnalysis.missingKinds,
    invalidArtifacts: artifactAnalysis.invalidArtifacts,
  };
  const capabilityGaps = buildCapabilityGaps(handoff, reportWithCoverage, artifactAnalysis);
  const releaseGateDecision = handoff?.releaseGateDecision ?? buildReleaseGateDecision(auditBundleId, findings, artifactAudit);
  const categoryCounts = buildCategoryCounts(findings);
  const baseSections = upsertSummarySection(
    upsertSummarySection(
      upsertSummarySection(
        upsertSummarySection(
          report.sections,
          "capability-review",
          "Capability gaps",
          capabilityGaps.length > 0
            ? `${capabilityGaps.length} capability gap(s) were identified from the execution evidence.`
            : "No explicit capability gaps were identified for this audit run.",
          { capabilityGaps },
        ),
        "artifact-auditor",
        "Artifact audit",
        artifactAnalysis.summary,
        artifactAnalysis,
      ),
      "remediation-planner",
      "Remediation packs",
      `${remediationPacks.length} remediation pack(s) were generated from the collected findings.`,
      { remediationPacks },
    ),
    "release-gate-scorer",
    "Release gate",
    releaseGateDecision.reason,
    { releaseGateDecision, auditBundleId },
  );
  const sectionsWithFixHandoff = fixHandoff
    ? upsertSummarySection(
        baseSections,
        "fix-readiness-emitter",
        "Fix readiness handoff",
        fixHandoff.entries.length > 0
          ? `${fixHandoff.entries.length} fix handoff entr${fixHandoff.entries.length === 1 ? "y" : "ies"} were prepared for downstream remediation.`
          : "Fix readiness data captured validation and rollback guidance for downstream remediation.",
        { fixHandoff },
      )
    : baseSections;
  const reportWithSections = {
    ...reportWithCoverage,
    sections: sectionsWithFixHandoff,
    summary: {
      ...reportWithCoverage.summary,
      auditBundleId,
      categoryCounts,
      releaseGateDecision,
      remediationPacks,
      fixHandoff,
      artifactAnalysis,
      capabilityGaps,
    },
  };
  const qualityScorecard = buildQualityScorecard(reportWithSections, artifactAnalysis, capabilityGaps);
  const sections = upsertSummarySection(
    sectionsWithFixHandoff,
    "quality-review",
    "Quality scorecard",
    `Overall audit quality score: ${qualityScorecard.overallScore}/100.`,
    { qualityScorecard },
  );

  return analysisReportSchema.parse({
    ...report,
    findings,
    sections,
    summary: {
      totalFindings: findings.length,
      high: findings.filter(item => item.severity === "high").length,
      medium: findings.filter(item => item.severity === "medium").length,
      low: findings.filter(item => item.severity === "low").length,
      auditBundleId,
      categoryCounts,
      releaseGateDecision,
      remediationPacks,
      fixHandoff,
      changeset: report.summary.changeset ?? null,
      executionCoverage,
      qualityScorecard,
      capabilityGaps,
      artifactAnalysis,
      executionSteps: report.summary.executionSteps,
    },
  });
}

async function runCodexExec(options: {
  codexBin: string;
  codexModel: string | null;
  repoPath: string;
  prompt: string;
  outputPath: string;
  outputSchemaPath?: string;
  timeoutMs: number;
  sandboxMode: CodexSandboxMode;
  bypassSandbox: boolean;
  authPath?: string | null;
  onStdoutLine?: (line: string) => Promise<void> | void;
  onStderrLine?: (line: string) => Promise<void> | void;
}): Promise<CodexRunResult> {
  const args = ["exec", "--skip-git-repo-check"];
  if (options.codexModel) {
    args.push("--model", options.codexModel);
  }
  if (options.bypassSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", options.sandboxMode);
  }
  if (options.outputSchemaPath) {
    args.push("--output-schema", options.outputSchemaPath);
  }
  args.push("--output-last-message", options.outputPath, options.prompt);

  const child = spawn(options.codexBin, args, {
    cwd: options.repoPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.authPath
        ? {
            CODEX_HOME: path.dirname(options.authPath),
            CODEX_AUTH_PATH: options.authPath,
          }
        : {}),
    },
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const pendingLineWrites: Array<Promise<void>> = [];
  let stdoutRemainder = "";
  let stderrRemainder = "";

  const queueLine = (handler: ((line: string) => Promise<void> | void) | undefined, line: string) => {
    if (!handler) {
      return;
    }
    pendingLineWrites.push(Promise.resolve(handler(line)).catch(() => undefined));
  };

  child.stdout?.on("data", chunk => {
    const value = String(chunk);
    stdoutChunks.push(value);
    stdoutRemainder = flushChunkLines(value, stdoutRemainder, line => {
      if (!shouldSuppressCodexLogLine(line)) {
        queueLine(options.onStdoutLine, line);
      }
    });
  });
  child.stderr?.on("data", chunk => {
    const value = String(chunk);
    stderrChunks.push(value);
    stderrRemainder = flushChunkLines(value, stderrRemainder, line => {
      if (!shouldSuppressCodexLogLine(line)) {
        queueLine(options.onStderrLine, line);
      }
    });
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs);

  const result = await new Promise<CodexRunResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      void (async () => {
        clearTimeout(timer);
        if (stdoutRemainder.trim().length > 0 && !shouldSuppressCodexLogLine(stdoutRemainder.trim())) {
          queueLine(options.onStdoutLine, truncateLogMessage(stdoutRemainder.trim()));
        }
        if (stderrRemainder.trim().length > 0 && !shouldSuppressCodexLogLine(stderrRemainder.trim())) {
          queueLine(options.onStderrLine, truncateLogMessage(stderrRemainder.trim()));
        }
        await Promise.allSettled(pendingLineWrites);
        resolve({
          exitCode,
          signal,
          timedOut,
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
        });
      })().catch(reject);
    });
  });

  return result;
}

function isRetryableCodexFailure(result: CodexRunResult): boolean {
  if (result.timedOut) {
    return true;
  }
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return [
    "selected model is at capacity",
    "please try a different model",
    "rate limit",
    "too many requests",
    "temporarily unavailable",
    "service unavailable",
    "server error",
    "overloaded",
    "timed out",
    "timeout",
    "connection reset",
    "connection refused",
    "econnreset",
    "econnrefused",
  ].some(fragment => combined.includes(fragment));
}

async function stageCodexAuth(tempDir: string): Promise<string | null> {
  const tokens = await getCodexTokens();
  if (!tokens) {
    return null;
  }

  const authDir = path.join(tempDir, "codex");
  const authPath = path.join(authDir, "auth.json");
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(authPath, renderCodexAuthFile(tokens), { mode: 0o600 });
  return authPath;
}

async function syncCodexAuth(authPath: string | null): Promise<void> {
  if (!authPath || !fs.existsSync(authPath)) {
    return;
  }

  const tokens = parseCodexAuthFile(fs.readFileSync(authPath, "utf8"));
  if (!tokens) {
    return;
  }

  await storeCodexTokens(tokens);
}

function isIgnoredRepoDir(name: string): boolean {
  return name === ".git"
    || name === "node_modules"
    || name === ".next"
    || name === "dist"
    || name === "coverage"
    || name === "test-results"
    || name === "playwright-report"
    || name === ".speclens-workspace";
}

function cleanupTransientRuntimeArtifacts(repoPath: string): string[] {
  const removableNames = [
    "node_modules",
    ".cache",
    ".parcel-cache",
    ".turbo",
    "build",
    "dist",
    ".next",
  ];
  const removed: string[] = [];
  for (const entryName of removableNames) {
    const entryPath = path.join(repoPath, entryName);
    if (!fs.existsSync(entryPath)) {
      continue;
    }
    fs.rmSync(entryPath, { recursive: true, force: true });
    removed.push(entryName);
  }
  return removed;
}

function walkRepoForFileNames(rootDir: string, fileNames: Set<string>, maxDepth = 4): string[] {
  const matches: string[] = [];
  const visit = (currentDir: string, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredRepoDir(entry.name)) {
          continue;
        }
        visit(path.join(currentDir, entry.name), depth + 1);
        continue;
      }
      if (entry.isFile() && fileNames.has(entry.name)) {
        matches.push(path.join(currentDir, entry.name));
      }
    }
  };
  visit(rootDir, 0);
  return matches;
}

function detectPackageManager(directory: string, repoPath: string): PackageManager {
  let currentDir = directory;
  for (;;) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
          packageManager?: string;
        };
        const packageManager = manifest.packageManager?.toLowerCase() ?? "";
        if (packageManager.startsWith("pnpm")) return "pnpm";
        if (packageManager.startsWith("yarn")) return "yarn";
        if (packageManager.startsWith("bun")) return "bun";
        if (packageManager.startsWith("npm")) return "npm";
      } catch {
        // Fall through to lockfile detection.
      }
    }
    if (fs.existsSync(path.join(currentDir, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(currentDir, "yarn.lock"))) return "yarn";
    if (fs.existsSync(path.join(currentDir, "bun.lockb")) || fs.existsSync(path.join(currentDir, "bun.lock"))) return "bun";
    if (fs.existsSync(path.join(currentDir, "package-lock.json"))) return "npm";
    if (currentDir === repoPath) {
      break;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir.startsWith(repoPath)) {
      break;
    }
    currentDir = parentDir;
  }
  return "npm";
}

function buildScriptRunCommand(packageManager: PackageManager, scriptName: string): string {
  if (packageManager === "pnpm") {
    return `pnpm ${scriptName} -- --list`;
  }
  if (packageManager === "yarn") {
    return `yarn ${scriptName} --list`;
  }
  if (packageManager === "bun") {
    return `bun run ${scriptName} -- --list`;
  }
  return `npm run ${scriptName} -- --list`;
}

function buildPlaywrightExecCommand(packageManager: PackageManager): string {
  if (packageManager === "pnpm") {
    return "pnpm exec playwright test --list";
  }
  if (packageManager === "yarn") {
    return "yarn playwright test --list";
  }
  if (packageManager === "bun") {
    return "bunx playwright test --list";
  }
  return "npx playwright test --list";
}

function scriptPreferenceScore(scriptName: string): number {
  const preferredScripts = ["e2e:hosted:local", "e2e:local", "e2e", "test:e2e", "playwright:test"];
  const preferredIndex = preferredScripts.indexOf(scriptName);
  if (preferredIndex !== -1) {
    return 100 - preferredIndex;
  }
  if (scriptName.includes("playwright")) return 80;
  if (scriptName.includes("e2e")) return 70;
  if (scriptName.includes("test")) return 60;
  return 10;
}

function detectPlaywrightPreflight(repoPath: string): PlaywrightPreflightPlan | null {
  const playwrightConfigCandidates = new Set([
    "playwright.config.ts",
    "playwright.config.mts",
    "playwright.config.js",
    "playwright.config.mjs",
    "playwright.config.cjs",
  ]);
  const packageJsonPaths = walkRepoForFileNames(repoPath, new Set(["package.json"]), 4);
  const configPaths = walkRepoForFileNames(repoPath, playwrightConfigCandidates, 4);
  const plans: Array<PlaywrightPreflightPlan & { score: number }> = [];

  for (const packageJsonPath of packageJsonPaths) {
    try {
      const workingDirectory = path.dirname(packageJsonPath);
      const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = manifest.scripts ?? {};
      const packageManager = detectPackageManager(workingDirectory, repoPath);
      for (const [scriptName, script] of Object.entries(scripts)) {
        if (typeof script !== "string" || !script.includes("playwright test")) {
          continue;
        }
        plans.push({
          label: scriptName,
          command: buildScriptRunCommand(packageManager, scriptName),
          workingDirectory,
          source: "package-script",
          packageManager,
          configPath: null,
          score: scriptPreferenceScore(scriptName) - path.relative(repoPath, workingDirectory).split(path.sep).filter(Boolean).length,
        });
      }
    } catch {
      // Ignore malformed package.json here and fall back to config detection.
    }
  }

  for (const configPath of configPaths) {
    const workingDirectory = path.dirname(configPath);
    const packageManager = detectPackageManager(workingDirectory, repoPath);
    plans.push({
      label: "playwright-config",
      command: buildPlaywrightExecCommand(packageManager),
      workingDirectory,
      source: "config",
      packageManager,
      configPath: path.relative(workingDirectory, configPath) || path.basename(configPath),
      score: 40 - path.relative(repoPath, workingDirectory).split(path.sep).filter(Boolean).length,
    });
  }

  if (plans.length === 0) {
    return null;
  }

  plans.sort((left, right) => right.score - left.score || left.workingDirectory.localeCompare(right.workingDirectory));
  const bestPlan = plans[0]!;
  return {
    label: bestPlan.label,
    command: bestPlan.command,
    workingDirectory: bestPlan.workingDirectory,
    source: bestPlan.source,
    packageManager: bestPlan.packageManager,
    configPath: bestPlan.configPath,
  };
}

async function runShellCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<ShellRunResult> {
  const child = spawn("bash", ["-lc", options.command], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      CI: process.env.CI ?? "1",
      PLAYWRIGHT_SKIP_COMPOSE: process.env.PLAYWRIGHT_SKIP_COMPOSE ?? "1",
    },
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let timedOut = false;

  child.stdout?.on("data", chunk => stdoutChunks.push(String(chunk)));
  child.stderr?.on("data", chunk => stderrChunks.push(String(chunk)));

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs);

  return await new Promise<ShellRunResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      });
    });
  });
}

function resolveWorkingDirectory(repoPath: string, workingDirectory: string | null | undefined): string {
  if (!workingDirectory || workingDirectory.trim().length === 0 || workingDirectory === ".") {
    return repoPath;
  }
  const absolute = path.resolve(repoPath, workingDirectory);
  return absolute.startsWith(repoPath) ? absolute : repoPath;
}

function normalizeAbsoluteUrl(value: string | null | undefined, fallbackBaseUrl: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }
  try {
    return new URL(candidate).toString();
  } catch {
    if (!fallbackBaseUrl) {
      return null;
    }
    try {
      return new URL(candidate, fallbackBaseUrl).toString();
    } catch {
      return null;
    }
  }
}

function normalizeBrowserUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.hash = "";
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  }
  return parsed.toString();
}

function chooseCredentialSecret(secrets: JobExecutionRecord["secrets"]): { username: string; password: string } | null {
  const record = secrets.find(secret => secret.kind === "credential-pair");
  if (!record) {
    return null;
  }
  try {
    const value = JSON.parse(record.value) as { username?: string; password?: string };
    if (!value.username || !value.password) {
      return null;
    }
    return {
      username: value.username,
      password: value.password,
    };
  } catch {
    return null;
  }
}

function chooseSessionStateSecret(secrets: JobExecutionRecord["secrets"]): string | null {
  return secrets.find(secret => secret.kind === "session-state")?.value ?? null;
}

function buildExecutionEnv(baseUrl: string | null): Record<string, string> {
  if (!baseUrl) {
    return {};
  }
  try {
    const parsed = new URL(baseUrl);
    const env: Record<string, string> = {
      SPECLENS_BASE_URL: parsed.toString(),
      PLAYWRIGHT_BASE_URL: parsed.toString(),
    };
    if (parsed.hostname) {
      env.HOST = parsed.hostname;
    }
    if (parsed.port) {
      env.PORT = parsed.port;
    }
    return env;
  } catch {
    return {};
  }
}

function createRoleFinding(
  severity: "high" | "medium" | "low",
  title: string,
  message: string,
  suggestion: string,
  evidence: string[] = [],
  options: {
    sourceIds?: string[];
    paths?: string[];
    primarySourceId?: string;
    companionSourceId?: string | null;
  } = {},
): RoleOutput["findings"][number] {
  const derivedPaths = extractFindingPaths(evidence, options.paths);
  const derivedSourceIds = options.primarySourceId
    ? inferFindingSourceIds({
        explicitSourceIds: options.sourceIds ?? [],
        evidence,
        paths: derivedPaths,
        primarySourceId: options.primarySourceId,
        companionSourceId: options.companionSourceId ?? null,
      })
    : (options.sourceIds ?? []);
  return {
    severity,
    title,
    message,
    suggestion,
    evidence,
    sourceIds: derivedSourceIds,
    paths: derivedPaths,
    remediationPackIds: [],
  };
}

function normalizeFindingPath(value: string): string {
  return value
    .trim()
    .replace(/^['"`(\[]+|['"`)\].,:;!?]+$/g, "")
    .replace(/^\.\/+/, "")
    .replace(/\\/g, "/")
    .replace(/^(primary|companion)\//, "")
    .replace(/^\/+|\/+$/g, "");
}

function extractFindingPaths(evidence: string[], explicitPaths: string[] = []): string[] {
  const values = new Set<string>();
  for (const candidate of explicitPaths) {
    const normalized = normalizeFindingPath(candidate);
    if (normalized) {
      values.add(normalized);
    }
  }
  const pathPattern = new RegExp(
    String.raw`(?:^|\s|["'(<{\[])((?:primary|companion)\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+`,
    "g",
  );
  for (const item of evidence) {
    for (const match of item.matchAll(pathPattern)) {
      const normalized = normalizeFindingPath(match[1] ?? "");
      if (normalized) {
        values.add(normalized);
      }
    }
  }
  return [...values];
}

function inferFindingSourceIds(options: {
  explicitSourceIds: string[];
  evidence: string[];
  paths: string[];
  primarySourceId: string;
  companionSourceId: string | null;
}): string[] {
  if (options.explicitSourceIds.length > 0) {
    return [...new Set(options.explicitSourceIds)];
  }
  if (!options.companionSourceId) {
    return [options.primarySourceId];
  }
  const sawPrimary = [...options.evidence, ...options.paths].some(item => /(^|[\s"'`([{<])primary\//.test(item));
  const sawCompanion = [...options.evidence, ...options.paths].some(item => /(^|[\s"'`([{<])companion\//.test(item));
  if (sawPrimary && !sawCompanion) {
    return [options.primarySourceId];
  }
  if (sawCompanion && !sawPrimary) {
    return [options.companionSourceId];
  }
  return [];
}

function resolveRuntimeTarget(handoff: StandardizedHandoff, repoPath: string): RuntimeExecutionTarget | null {
  for (const target of handoff.runtime.targets) {
    if (!target.startCommand) {
      continue;
    }
    const workingDirectory = resolveWorkingDirectory(repoPath, target.workingDirectory);
    const baseUrl = normalizeAbsoluteUrl(target.baseUrl, handoff.runtime.baseUrls[0] ?? null)
      ?? normalizeAbsoluteUrl(handoff.runtime.baseUrls[0] ?? null, null);
    const healthUrls = target.healthUrls
      .map(item => normalizeAbsoluteUrl(item, baseUrl))
      .filter((item): item is string => Boolean(item));
    return {
      label: target.label,
      workingDirectory,
      startCommand: target.startCommand,
      baseUrl,
      healthUrls: healthUrls.length > 0 ? healthUrls : (baseUrl ? [baseUrl] : []),
      kind: target.kind,
      framework: target.framework,
    };
  }

  const startCommand = handoff.runtime.startCommands[0];
  if (!startCommand) {
    return null;
  }
  const baseUrl = normalizeAbsoluteUrl(handoff.runtime.baseUrls[0] ?? null, null);
  return {
    label: startCommand.label,
    workingDirectory: resolveWorkingDirectory(repoPath, startCommand.workingDirectory),
    startCommand: startCommand.command,
    baseUrl,
    healthUrls: baseUrl ? [baseUrl] : [],
    kind: null,
    framework: null,
  };
}

async function runDocumentedCommands(options: {
  jobId: string;
  logs: AnalysisLogEvent[];
  repoPath: string;
  commands: StandardizedHandoff["runtime"]["installCommands"];
  scope: string;
  artifactsDir: string;
  timeoutMs: number;
  env: Record<string, string>;
  primarySourceId: string;
  companionSourceId: string | null;
}): Promise<{
  ok: boolean;
  executed: Array<{ label: string; command: string; workingDirectory: string; logPath: string; exitCode: number | null }>;
  failureFinding?: RoleOutput["findings"][number];
}> {
  const executed: Array<{ label: string; command: string; workingDirectory: string; logPath: string; exitCode: number | null }> = [];
  for (let index = 0; index < options.commands.length; index += 1) {
    const command = options.commands[index]!;
    const workingDirectory = resolveWorkingDirectory(options.repoPath, command.workingDirectory);
    const logPath = path.join(options.artifactsDir, `${safeSegment(options.scope)}-${index + 1}-${safeSegment(command.label)}.log`);
    await appendLog(options.jobId, options.logs, options.scope, `Running ${command.label}: ${command.command}`, "info");
    const run = await runShellCommand({
      command: command.command,
      cwd: workingDirectory,
      timeoutMs: options.timeoutMs,
      env: options.env,
    });
    const combinedOutput = [run.stdout.trim(), run.stderr.trim()].filter(Boolean).join("\n\n");
    fs.writeFileSync(logPath, combinedOutput, "utf8");
    executed.push({
      label: command.label,
      command: command.command,
      workingDirectory,
      logPath,
      exitCode: run.exitCode,
    });
    if (run.timedOut || run.exitCode !== 0) {
      return {
        ok: false,
        executed,
        failureFinding: createRoleFinding(
          "high",
          `${command.label} failed during runtime execution`,
          combinedOutput || `The command "${command.command}" exited unsuccessfully.`,
          "Fix the documented runtime setup command so the worker can boot and verify the application automatically.",
          [path.relative(options.repoPath, logPath)],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ),
      };
    }
  }
  return { ok: true, executed };
}

type RunningRuntime = {
  child: import("node:child_process").ChildProcess;
  outputPath: string;
};

function startLongRunningCommand(options: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  outputPath: string;
}): RunningRuntime {
  const child = spawn("bash", ["-lc", options.command], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // Non-Windows runs stop the runtime via process.kill(-pid, signal), which requires a dedicated process group.
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...options.env,
      CI: process.env.CI ?? "1",
      PLAYWRIGHT_SKIP_COMPOSE: process.env.PLAYWRIGHT_SKIP_COMPOSE ?? "1",
    },
  });
  const appendChunk = (chunk: unknown) => {
    fs.appendFileSync(options.outputPath, String(chunk), "utf8");
  };
  child.stdout?.on("data", appendChunk);
  child.stderr?.on("data", appendChunk);
  return {
    child,
    outputPath: options.outputPath,
  };
}

async function stopLongRunningCommand(runtime: RunningRuntime | null): Promise<void> {
  if (!runtime?.child.pid) {
    return;
  }
  const waitForExit = new Promise<void>(resolve => {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      resolve();
      return;
    }
    runtime.child.once("exit", () => resolve());
  });
  const terminate = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") {
        runtime.child.kill(signal);
        return;
      }
      process.kill(-runtime.child.pid!, signal);
    } catch {
      // Process already exited.
    }
  };

  terminate("SIGTERM");
  const terminated = await Promise.race([
    waitForExit.then(() => true),
    sleep(3000).then(() => false),
  ]);
  if (!terminated) {
    terminate("SIGKILL");
    await Promise.race([waitForExit, sleep(1000)]);
  }
}

async function waitForHealthUrls(urls: string[], timeoutMs: number): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const url of urls) {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status >= 200 && response.status < 500) {
          return url;
        }
      } catch {
        // Keep polling.
      }
    }
    await sleep(500);
  }
  return null;
}

function relativeArtifactPath(rootDir: string, filePath: string | null): string | null {
  return filePath ? path.relative(rootDir, filePath).split(path.sep).join("/") : null;
}

async function safeScreenshot(page: any, filePath: string): Promise<string | null> {
  try {
    await page.screenshot({ path: filePath, fullPage: true, timeout: 30000 });
    return filePath;
  } catch {
    await sleep(1200);
    try {
      await page.screenshot({ path: filePath, fullPage: true, timeout: 30000 });
      return filePath;
    } catch {
      return null;
    }
  }
}

function selectInteractionTargets(page: any): any[] {
  return [
    page.locator('button:not([disabled])').first(),
    page.locator('[role="button"]:not([disabled])').first(),
    page.locator('input:not([type="hidden"]):not([disabled]):not([readonly])').first(),
    page.locator('select:not([disabled])').first(),
    page.locator('a[href]').first(),
  ];
}

async function runBrowserInteractions(options: {
  page: any;
  pageUrl: string;
  artifactsDir: string;
  rootDir: string;
}): Promise<BrowserQaInteractionRecord[]> {
  const interactions: BrowserQaInteractionRecord[] = [];
  const targets = selectInteractionTargets(options.page).slice(0, MAX_BROWSER_QA_INTERACTIONS);

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const label = `interaction-${index + 1}`;
    try {
      if (!await target.isVisible().catch(() => false)) {
        continue;
      }
      const tagName = await target.evaluate((node: Element) => node.tagName.toLowerCase()).catch(() => "button");
      const beforeShotPath = path.join(options.artifactsDir, `${randomUUID().slice(0, 10)}-before.png`);
      const afterShotPath = path.join(options.artifactsDir, `${randomUUID().slice(0, 10)}-after.png`);
      const beforeScreenshot = relativeArtifactPath(options.rootDir, await safeScreenshot(options.page, beforeShotPath));
      let action: BrowserQaInteractionRecord["action"] = "click";

      if (tagName === "input") {
        action = "fill";
        await target.fill("SpecLens QA input", { timeout: 3000 });
      } else if (tagName === "select") {
        action = "select";
        const optionsCount = await target.locator("option").count().catch(() => 0);
        if (optionsCount > 1) {
          await target.selectOption({ index: 1 }, { timeout: 3000 });
        }
      } else if (tagName === "a") {
        action = "link";
        await target.click({ timeout: 3000 });
        await options.page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
      } else {
        await target.click({ timeout: 3000 });
      }

      await options.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => options.page.waitForTimeout(500));
      const afterScreenshot = relativeArtifactPath(options.rootDir, await safeScreenshot(options.page, afterShotPath));
      interactions.push({
        pageUrl: options.pageUrl,
        label,
        action,
        beforeScreenshot,
        afterScreenshot,
        success: true,
        error: null,
      });

      if (action === "link" && normalizeBrowserUrl(options.page.url()) !== normalizeBrowserUrl(options.pageUrl)) {
        await options.page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() =>
          options.page.goto(options.pageUrl, { waitUntil: "domcontentloaded", timeout: 8000 }));
      }
    } catch (error) {
      interactions.push({
        pageUrl: options.pageUrl,
        label,
        action: "click",
        beforeScreenshot: null,
        afterScreenshot: null,
        success: false,
        error: error instanceof Error ? error.message : "Unknown browser interaction failure.",
      });
      await options.page.goto(options.pageUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => undefined);
    }
  }

  return interactions;
}

function buildNavigationQueue(handoff: StandardizedHandoff, baseUrl: string): string[] {
  const queued: string[] = [];
  const push = (candidate: string | null) => {
    if (!candidate) {
      return;
    }
    const normalized = normalizeAbsoluteUrl(candidate, baseUrl);
    if (!normalized) {
      return;
    }
    const pageUrl = normalizeBrowserUrl(normalized);
    if (!queued.includes(pageUrl)) {
      queued.push(pageUrl);
    }
  };

  push(baseUrl);
  for (const target of handoff.playwright.navigationTargets) {
    push(target.path);
  }
  for (const route of handoff.auth.frontend.protectedRoutes) {
    push(route);
  }
  if (queued.length === 0) {
    push(baseUrl);
  }
  return queued.slice(0, MAX_BROWSER_QA_PAGES);
}

async function attemptCredentialLogin(options: {
  page: any;
  baseUrl: string;
  loginRoutes: string[];
  credentials: { username: string; password: string } | null;
}): Promise<boolean> {
  if (!options.credentials) {
    return false;
  }
  const candidates = [
    ...options.loginRoutes,
    "/login",
    "/login/",
    "/signin",
    "/signin/",
    "/auth/login",
    "/auth/signin",
  ].filter((value, index, array) => array.indexOf(value) === index);

  for (const candidate of candidates) {
    const loginUrl = normalizeAbsoluteUrl(candidate, options.baseUrl);
    if (!loginUrl) {
      continue;
    }
    try {
      await options.page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      const passwordInput = options.page.locator('input[type="password"]').first();
      if (!await passwordInput.isVisible().catch(() => false)) {
        continue;
      }
      const userInput = options.page.locator('input[name="username"], input[name="email"], input[type="email"], input[type="text"]').first();
      if (!await userInput.isVisible().catch(() => false)) {
        continue;
      }

      await userInput.fill(options.credentials.username, { timeout: 3000 });
      await passwordInput.fill(options.credentials.password, { timeout: 3000 });

      const submit = options.page.locator('button[type="submit"], input[type="submit"]').first();
      if (await submit.isVisible().catch(() => false)) {
        await submit.click({ timeout: 3000 });
      } else {
        await options.page.keyboard.press("Enter");
      }
      await options.page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
      await options.page.waitForTimeout(500);
      if (!String(options.page.url()).includes("/login") && !String(options.page.url()).includes("/signin")) {
        return true;
      }
    } catch {
      // Try the next login route candidate.
    }
  }

  return false;
}

function copyKnownPlaywrightArtifacts(cwd: string, artifactsDir: string): string[] {
  const copied: string[] = [];
  for (const candidate of ["playwright-report", "test-results"]) {
    const sourcePath = path.join(cwd, candidate);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    const destinationPath = path.join(artifactsDir, candidate);
    fs.rmSync(destinationPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
    copied.push(destinationPath);
  }
  return copied;
}

async function executeStandardizedHandoff(options: {
  jobId: string;
  logs: AnalysisLogEvent[];
  repoPath: string;
  tempDir: string;
  handoff: StandardizedHandoff;
  secrets: JobExecutionRecord["secrets"];
  primarySourceId: string;
  companionSourceId: string | null;
}): Promise<Pick<RoleOutput, "sections" | "findings">> {
  const config = loadAiWorkerConfig();
  const workspace = createCoreWorkspace({
    rootDir: options.tempDir,
    name: safeSegment(options.jobId),
  });
  const artifactsDir = path.join(workspace.generatedDir, "browser", options.jobId);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const findings: RoleOutput["findings"] = [];
  const sections: RoleOutput["sections"] = [];
  const runtimeTarget = resolveRuntimeTarget(options.handoff, options.repoPath);

  if (!runtimeTarget) {
    findings.push(createRoleFinding(
      "high",
      "Runtime execution target is missing",
      "The canonical handoff did not identify a runnable target with a start command.",
      "Ensure runtime discovery emits at least one start command or concrete target so hosted execution can boot the application.",
      [],
      {
        primarySourceId: options.primarySourceId,
        companionSourceId: options.companionSourceId,
      },
    ));
    sections.push({
      title: "Runtime execution",
      status: "planned",
      summary: "Runtime execution could not start because the handoff did not provide a runnable target.",
      data: {
        targets: options.handoff.runtime.targets,
        startCommands: options.handoff.runtime.startCommands,
      },
    });
    return { sections, findings };
  }

  const runtimeEnv = buildExecutionEnv(runtimeTarget.baseUrl);
  const installCommands = options.handoff.runtime.installCommands.slice(0, 4);
  if (installCommands.length > 0) {
    const installResult = await runDocumentedCommands({
      jobId: options.jobId,
      logs: options.logs,
      repoPath: options.repoPath,
      commands: installCommands,
      scope: "runtime-install",
      artifactsDir,
      timeoutMs: config.executionCommandTimeoutMs,
      env: runtimeEnv,
      primarySourceId: options.primarySourceId,
      companionSourceId: options.companionSourceId,
    });
    if (!installResult.ok) {
      if (installResult.failureFinding) {
        findings.push(installResult.failureFinding);
      }
      sections.push({
        title: "Runtime execution",
        status: "planned",
        summary: "Runtime execution stopped because a documented install command failed.",
        data: {
          target: runtimeTarget,
          executedCommands: installResult.executed.map(item => ({
            ...item,
            logPath: relativeArtifactPath(options.tempDir, item.logPath),
          })),
        },
      });
      return { sections, findings };
    }
  }

  const runtimeLogPath = path.join(artifactsDir, "runtime.log");
  fs.writeFileSync(runtimeLogPath, "", "utf8");
  const runtime = startLongRunningCommand({
    command: runtimeTarget.startCommand,
    cwd: runtimeTarget.workingDirectory,
    env: runtimeEnv,
    outputPath: runtimeLogPath,
  });
  let browser: any = null;
  let browserContext: any = null;

  try {
    await appendLog(options.jobId, options.logs, "runtime-boot", `Starting ${runtimeTarget.label} via "${runtimeTarget.startCommand}".`, "info");
    const readyUrl = await waitForHealthUrls(
      runtimeTarget.healthUrls.length > 0 ? runtimeTarget.healthUrls : (runtimeTarget.baseUrl ? [runtimeTarget.baseUrl] : []),
      config.runtimeBootTimeoutMs,
    );
    if (!readyUrl) {
      findings.push(createRoleFinding(
        "high",
        "Runtime execution did not become ready",
        `The target "${runtimeTarget.label}" did not respond before the boot timeout elapsed.`,
        "Ensure the start command launches an HTTP server and that the handoff includes a correct base URL or health URL.",
        [relativeArtifactPath(options.tempDir, runtimeLogPath) ?? "runtime.log"],
        {
          primarySourceId: options.primarySourceId,
          companionSourceId: options.companionSourceId,
        },
      ));
      sections.push({
        title: "Runtime execution",
        status: "planned",
        summary: "The application start command ran, but the worker could not verify a healthy HTTP target.",
        data: {
          target: runtimeTarget,
          runtimeLog: relativeArtifactPath(options.tempDir, runtimeLogPath),
        },
      });
      return { sections, findings };
    }

    await appendLog(options.jobId, options.logs, "runtime-boot", `Runtime target responded at ${readyUrl}.`, "info");
    sections.push({
      title: "Runtime execution",
      status: "ready",
      summary: `The worker installed and booted ${runtimeTarget.label} successfully.`,
      data: {
        target: runtimeTarget,
        readyUrl,
        runtimeLog: relativeArtifactPath(options.tempDir, runtimeLogPath),
      },
    });

    const playwrightCommand = options.handoff.playwright.commands[0] ?? null;
    if (playwrightCommand) {
      const playwrightLogPath = path.join(artifactsDir, "playwright-command.log");
      const playwrightCwd = resolveWorkingDirectory(options.repoPath, playwrightCommand.workingDirectory);
      await appendLog(options.jobId, options.logs, "playwright", `Running documented Playwright command "${playwrightCommand.command}".`, "info");
      const run = await runShellCommand({
        command: playwrightCommand.command,
        cwd: playwrightCwd,
        timeoutMs: config.playwrightCommandTimeoutMs,
        env: runtimeEnv,
      });
      fs.writeFileSync(playwrightLogPath, [run.stdout.trim(), run.stderr.trim()].filter(Boolean).join("\n\n"), "utf8");
      const copiedArtifacts = copyKnownPlaywrightArtifacts(playwrightCwd, artifactsDir).map(item => relativeArtifactPath(options.tempDir, item));
      if (run.timedOut || run.exitCode !== 0) {
        findings.push(createRoleFinding(
          "medium",
          "Documented Playwright suite failed",
          fs.readFileSync(playwrightLogPath, "utf8").trim() || `The command "${playwrightCommand.command}" exited unsuccessfully.`,
          "Fix the documented Playwright suite until it passes in the same environment the worker uses for hosted execution.",
          [relativeArtifactPath(options.tempDir, playwrightLogPath) ?? "playwright-command.log"],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
        sections.push({
          title: "Playwright suite execution",
          status: "planned",
          summary: "A documented Playwright command was executed, but it did not complete successfully.",
          data: {
            command: playwrightCommand,
            logPath: relativeArtifactPath(options.tempDir, playwrightLogPath),
            copiedArtifacts,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
          },
        });
      } else {
        sections.push({
          title: "Playwright suite execution",
          status: "ready",
          summary: "The documented Playwright suite completed successfully.",
          data: {
            command: playwrightCommand,
            logPath: relativeArtifactPath(options.tempDir, playwrightLogPath),
            copiedArtifacts,
          },
        });
      }
    } else {
      sections.push({
        title: "Playwright suite execution",
        status: "planned",
        summary: "No repository Playwright command was documented in the canonical handoff, so only direct browser QA was executed.",
        data: {
          commands: options.handoff.playwright.commands,
        },
      });
    }

    const baseUrl = readyUrl ?? runtimeTarget.baseUrl;
    if (!baseUrl) {
      return { sections, findings };
    }

    const playwrightModule = await import("@playwright/test");
    const { chromium } = playwrightModule;
    browser = await chromium.launch({ headless: true });
    const sessionStateValue = chooseSessionStateSecret(options.secrets);
    const inputStorageStatePath = sessionStateValue ? path.join(artifactsDir, "input-storage-state.json") : null;
    if (inputStorageStatePath && sessionStateValue) {
      fs.writeFileSync(inputStorageStatePath, sessionStateValue, "utf8");
    }
    browserContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      ignoreHTTPSErrors: true,
      ...(inputStorageStatePath ? { storageState: inputStorageStatePath } : {}),
    });
    const tracePath = path.join(artifactsDir, "browser-trace.zip");
    await browserContext.tracing.start({ screenshots: true, snapshots: true });
    const page = await browserContext.newPage();
    const credentials = chooseCredentialSecret(options.secrets);
    const authenticated = await attemptCredentialLogin({
      page,
      baseUrl,
      loginRoutes: options.handoff.auth.frontend.loginRoutes,
      credentials,
    });
    const capturedStorageStatePath = path.join(artifactsDir, "captured-storage-state.json");
    await browserContext.storageState({ path: capturedStorageStatePath }).catch(() => undefined);

    const pages: BrowserQaPageRecord[] = [];
    const interactions: BrowserQaInteractionRecord[] = [];
    const queued = buildNavigationQueue(options.handoff, baseUrl);
    const visited = new Set<string>();

    while (queued.length > 0 && pages.length < MAX_BROWSER_QA_PAGES) {
      const nextUrl = queued.shift();
      if (!nextUrl) {
        continue;
      }
      const normalizedUrl = normalizeBrowserUrl(nextUrl);
      if (visited.has(normalizedUrl)) {
        continue;
      }
      visited.add(normalizedUrl);

      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const requestFailures: string[] = [];
      page.removeAllListeners("pageerror");
      page.removeAllListeners("console");
      page.removeAllListeners("requestfailed");
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      page.on("console", (msg: { type(): string; text(): string }) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });
      page.on("requestfailed", (request: { method(): string; url(): string }) => {
        requestFailures.push(`${request.method()} ${request.url()}`);
      });

      let status: number | null = null;
      try {
        const response = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        status = response?.status() ?? null;
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => page.waitForTimeout(750));
      } catch (error) {
        findings.push(createRoleFinding(
          "high",
          "Browser navigation failed during hosted QA",
          error instanceof Error ? error.message : `Failed to open ${normalizedUrl}.`,
          "Fix the route runtime path and startup prerequisites until the worker can navigate the page reliably.",
          [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
        continue;
      }

      const screenshotPath = path.join(artifactsDir, `${randomUUID().slice(0, 12)}.png`);
      const screenshot = relativeArtifactPath(options.tempDir, await safeScreenshot(page, screenshotPath));
      const title = await page.title().catch(() => "");
      const h1 = await page.locator("h1").first().textContent().catch(() => null);
      const hasMain = await page.locator("main").count().then((count: number) => count > 0).catch(() => false);
      const links = await page.locator("a[href]").evaluateAll((nodes: Element[]) => nodes
        .map(node => (node as HTMLAnchorElement).href)
        .filter(Boolean))
        .catch(() => []) as string[];
      const discoveredLinks = links
        .map(link => normalizeBrowserUrl(link))
        .filter(link => link.startsWith(baseUrl))
        .filter(link => !visited.has(link));
      for (const link of discoveredLinks) {
        if (!queued.includes(link)) {
          queued.push(link);
        }
      }

      pages.push({
        url: normalizedUrl,
        finalUrl: normalizeBrowserUrl(page.url()),
        status,
        title,
        h1,
        hasMain,
        screenshot,
        discoveredLinks,
      });

      if ((status ?? 200) >= 400) {
        findings.push(createRoleFinding(
          "high",
          "HTTP failure detected during browser QA",
          `${normalizedUrl} responded with status ${status}.`,
          "Fix the failing route before relying on hosted browser QA for this application.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
      if (!title.trim()) {
        findings.push(createRoleFinding(
          "low",
          "Visited page is missing a title",
          `${normalizedUrl} rendered without a document title.`,
          "Add a stable title so users and QA automation can identify the page context reliably.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
      if (!hasMain) {
        findings.push(createRoleFinding(
          "low",
          "Visited page is missing a main landmark",
          `${normalizedUrl} rendered without a <main> landmark.`,
          "Expose a primary main landmark to stabilize structure-aware QA and accessibility checks.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
      if (!h1?.trim()) {
        findings.push(createRoleFinding(
          "low",
          "Visited page is missing a primary heading",
          `${normalizedUrl} rendered without an h1 heading.`,
          "Add a primary heading so the page has an observable top-level label during browser QA.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
      for (const errorMessage of pageErrors) {
        findings.push(createRoleFinding(
          "high",
          "Uncaught page error detected",
          errorMessage,
          "Fix the runtime exception so the page can render deterministically during hosted QA.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
      for (const errorMessage of consoleErrors) {
        findings.push(createRoleFinding(
          "medium",
          "Console error detected",
          errorMessage,
          "Resolve console errors so browser runs stay clean and predictable.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
      for (const failure of requestFailures) {
        findings.push(createRoleFinding(
          "medium",
          "Request failure detected",
          failure,
          "Inspect broken assets, API calls, and application routing for this page.",
          screenshot ? [screenshot] : [normalizedUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }

      const pageInteractions = await runBrowserInteractions({
        page,
        pageUrl: normalizedUrl,
        artifactsDir,
        rootDir: options.tempDir,
      });
      interactions.push(...pageInteractions);
      for (const interaction of pageInteractions.filter(item => !item.success)) {
        findings.push(createRoleFinding(
          "medium",
          "Interaction failed during hosted browser QA",
          interaction.error ?? "An interaction attempt failed unexpectedly.",
          "Inspect the target control and ensure it can be exercised in a clean browser session.",
          [interaction.pageUrl],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
      }
    }

    await browserContext.tracing.stop({ path: tracePath }).catch(() => undefined);
    await browser.close();
    browser = null;
    sections.push({
      title: "Browser QA execution",
      status: "ready",
      summary: `${pages.length} page(s) were navigated with ${interactions.length} interaction attempt(s) and ${findings.length} surfaced execution issue(s).`,
      data: {
        baseUrl,
        authenticated,
        tracePath: relativeArtifactPath(options.tempDir, tracePath),
        inputStorageStatePath: relativeArtifactPath(options.tempDir, inputStorageStatePath),
        capturedStorageStatePath: relativeArtifactPath(options.tempDir, capturedStorageStatePath),
        pages,
        interactions,
        navigationTargets: buildNavigationQueue(options.handoff, baseUrl),
      },
    });
    return { sections, findings };
  } catch (error) {
    findings.push(createRoleFinding(
      "high",
      "Hosted execution failed unexpectedly",
      error instanceof Error ? error.message : "Unknown hosted execution failure.",
      "Inspect the runtime log, startup commands, and Playwright availability used by the worker.",
      [relativeArtifactPath(options.tempDir, runtimeLogPath) ?? "runtime.log"],
      {
        primarySourceId: options.primarySourceId,
        companionSourceId: options.companionSourceId,
      },
    ));
    sections.push({
      title: "Browser QA execution",
      status: "planned",
      summary: "Hosted execution terminated before browser QA could complete.",
      data: {
        target: runtimeTarget,
        runtimeLog: relativeArtifactPath(options.tempDir, runtimeLogPath),
      },
    });
    return { sections, findings };
  } finally {
    await browserContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stopLongRunningCommand(runtime);
  }
}

async function augmentWithPlaywrightPreflight(options: {
  jobId: string;
  logs: AnalysisLogEvent[];
  repoPath: string;
  output: RoleOutput;
  primarySourceId: string;
  companionSourceId: string | null;
}): Promise<RoleOutput> {
  const preflightPlan = detectPlaywrightPreflight(options.repoPath);
  if (!preflightPlan) {
    return {
      ...options.output,
      sections: [
        ...options.output.sections,
        {
          title: "Playwright preflight",
          status: "planned",
          summary: "No runnable Playwright command or config was detected for safe preflight execution.",
          data: {
            detected: false,
            packageManager: null,
            configPath: null,
          },
        },
      ],
    };
  }

  await appendLog(
    options.jobId,
    options.logs,
    "playwright",
    `Running Playwright preflight via "${preflightPlan.command}".`,
    "info",
  );

  const run = await runShellCommand({
    command: preflightPlan.command,
    cwd: preflightPlan.workingDirectory,
    timeoutMs: 300_000,
  });

  const combinedOutput = truncateText(
    [run.stdout.trim(), run.stderr.trim()].filter(Boolean).join("\n\n"),
  );
  const relativeWorkingDirectory = path.relative(options.repoPath, preflightPlan.workingDirectory) || ".";
  const preflightPaths = extractFindingPaths(
    [
      relativeWorkingDirectory,
      preflightPlan.configPath ? path.join(relativeWorkingDirectory, preflightPlan.configPath) : "",
    ].filter(Boolean),
  );
  const preflightSourceIds = inferFindingSourceIds({
    explicitSourceIds: [],
    evidence: [preflightPlan.command, relativeWorkingDirectory],
    paths: preflightPaths,
    primarySourceId: options.primarySourceId,
    companionSourceId: options.companionSourceId,
  });

  if (run.timedOut) {
    await appendLog(options.jobId, options.logs, "playwright", "Playwright preflight timed out.", "warn");
    return {
      ...options.output,
      sections: [
        ...options.output.sections,
        {
          title: "Playwright preflight",
          status: "planned",
          summary: "Playwright preflight timed out before the worker could verify the execution path.",
          data: {
            detected: true,
            label: preflightPlan.label,
            command: preflightPlan.command,
            workingDirectory: preflightPlan.workingDirectory,
            source: preflightPlan.source,
            packageManager: preflightPlan.packageManager,
            configPath: preflightPlan.configPath,
            timedOut: true,
            output: combinedOutput,
          },
        },
      ],
      findings: [
        ...options.output.findings,
        {
          severity: "medium",
          title: "Playwright preflight timed out",
          message: "The worker found a runnable Playwright command, but the preflight did not finish in time.",
          suggestion: "Run the detected Playwright command manually and inspect long-startup dependencies or blocked services.",
          evidence: [preflightPlan.command],
          sourceIds: preflightSourceIds,
          paths: preflightPaths,
          remediationPackIds: [],
        },
      ],
    };
  }

  if (run.exitCode === 0) {
    await appendLog(options.jobId, options.logs, "playwright", "Playwright preflight completed successfully.", "info");
    return {
      ...options.output,
      sections: [
        ...options.output.sections,
        {
          title: "Playwright preflight",
          status: "ready",
          summary: "The worker verified a runnable Playwright command with a safe preflight execution.",
          data: {
            detected: true,
            label: preflightPlan.label,
            command: preflightPlan.command,
            workingDirectory: preflightPlan.workingDirectory,
            source: preflightPlan.source,
            packageManager: preflightPlan.packageManager,
            configPath: preflightPlan.configPath,
            output: combinedOutput,
          },
        },
      ],
    };
  }

  await appendLog(
    options.jobId,
    options.logs,
    "playwright",
    `Playwright preflight failed: ${truncateLogMessage(combinedOutput || "unknown error")}`,
    "warn",
  );
  return {
    ...options.output,
    sections: [
      ...options.output.sections,
      {
        title: "Playwright preflight",
        status: "planned",
        summary: "A Playwright command was detected, but the worker could not verify it successfully.",
        data: {
          detected: true,
          label: preflightPlan.label,
          command: preflightPlan.command,
          workingDirectory: preflightPlan.workingDirectory,
          source: preflightPlan.source,
          packageManager: preflightPlan.packageManager,
          configPath: preflightPlan.configPath,
          exitCode: run.exitCode,
          output: combinedOutput,
        },
      },
    ],
    findings: [
      ...options.output.findings,
        {
          severity: "medium",
          title: "Playwright preflight failed",
          message: combinedOutput || "The detected Playwright command exited unsuccessfully.",
          suggestion: "Fix the Playwright environment or startup prerequisites until the detected command completes cleanly.",
          evidence: [preflightPlan.command],
          sourceIds: preflightSourceIds,
          paths: preflightPaths,
          remediationPackIds: [],
        },
    ],
  };
}

function mapRoleDefinitions(plan: {
  roles: Array<{
    id: string;
    name: string;
    description: string | null;
    order: number;
    dependsOnRoleIds: string[];
    skills: Array<{ id: string; name: string }>;
  }>;
}): RoleDefinition[] {
  return plan.roles.map((role, index) => ({
    id: role.id,
    title: role.name,
    description: role.description ?? "",
    order: role.order ?? index,
    dependsOnRoleIds: role.dependsOnRoleIds,
    skills: role.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
    })),
  }));
}

function estimateRoleDurationMs(roleId: string, runtimeMode: JobExecutionRecord["job"]["runtimeMode"]): number {
  switch (roleId) {
    case "source-topology-scout":
    case "runtime-scout":
    case "auth-cartographer":
    case "live-surface-resolver":
      return 2_000;
    case "license-governor":
    case "dependency-risk-reviewer":
    case "architecture-reviewer":
    case "code-health-reviewer":
      return 2_500;
    case "component-cartographer":
    case "design-system-auditor":
    case "copy-consistency-auditor":
    case "accessibility-auditor":
    case "navigation-qa-planner":
    case "visual-qa-critic":
    case "ux-friction-reviewer":
    case "cross-surface-consistency-reviewer":
      return 2_250;
    case "browser-executor":
    case "playwright-operator":
      return runtimeMode === "browser" ? 7_500 : 3_000;
    case "artifact-auditor":
    case "remediation-planner":
    case "release-gate-scorer":
      return 1_500;
    case "standardized-json-output":
      return runtimeMode === "browser" ? 2_500 : 1_500;
    default:
      return 2_000;
  }
}

function estimatePlanDurationMs(
  roles: Array<{ id: string }>,
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"],
): number {
  return roles.reduce((total, role) => total + estimateRoleDurationMs(role.id, runtimeMode), 0);
}

function mergeRoleOutputs(primary: RoleOutput, secondary: RoleOutput): RoleOutput {
  return roleOutputSchema.parse({
    summary: [primary.summary, secondary.summary].filter(Boolean).join("\n\n").trim(),
    sections: [...primary.sections, ...secondary.sections],
    findings: [...primary.findings, ...secondary.findings],
  });
}

function buildPackageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  if (packageManager === "pnpm") {
    return `pnpm ${scriptName}`;
  }
  if (packageManager === "yarn") {
    return `yarn ${scriptName}`;
  }
  if (packageManager === "bun") {
    return `bun run ${scriptName}`;
  }
  return `npm run ${scriptName}`;
}

function buildInstallCommand(packageManager: PackageManager): string {
  if (packageManager === "pnpm") {
    return "pnpm install";
  }
  if (packageManager === "yarn") {
    return "yarn install";
  }
  if (packageManager === "bun") {
    return "bun install";
  }
  return "npm install";
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function pickRoleOutput(priorOutputs: PriorRoleOutput[], roleId: string): PriorRoleOutput | null {
  for (let index = priorOutputs.length - 1; index >= 0; index -= 1) {
    const candidate = priorOutputs[index];
    if (candidate?.roleId === roleId) {
      return candidate;
    }
  }
  return null;
}

function pickSectionData(
  priorOutputs: PriorRoleOutput[],
  roleId: string,
  preferredTitles: string[] = [],
): Record<string, unknown> {
  const roleOutput = pickRoleOutput(priorOutputs, roleId);
  if (!roleOutput) {
    return {};
  }
  for (const title of preferredTitles) {
    const matchingSection = roleOutput.output.sections.find(section => section.title === title);
    if (matchingSection?.data) {
      return matchingSection.data;
    }
  }
  return roleOutput.output.sections[0]?.data ?? {};
}

function combineUniqueStrings(...valueSets: unknown[]): string[] {
  const seen = new Set<string>();
  for (const values of valueSets) {
    for (const value of normalizeStringArray(values)) {
      seen.add(value);
    }
  }
  return [...seen];
}

function inferPortFromCommandOrEntry(repoPath: string, workingDirectory: string, command: string | null): number | null {
  const normalizedCommand = command?.trim() ?? "";
  if (!normalizedCommand) {
    return null;
  }
  const explicitPort = normalizedCommand.match(/(?:--port|-p|PORT=)\s*=?\s*(\d{2,5})/i);
  if (explicitPort?.[1]) {
    return Number.parseInt(explicitPort[1], 10);
  }

  const nodeEntry = normalizedCommand.match(/node\s+([^\s]+(?:\.mjs|\.cjs|\.js|\.ts))/i)?.[1];
  if (!nodeEntry) {
    return null;
  }

  const entryPath = path.resolve(workingDirectory, nodeEntry);
  if (!entryPath.startsWith(repoPath) || !fs.existsSync(entryPath)) {
    return null;
  }
  try {
    const contents = fs.readFileSync(entryPath, "utf8");
    const envPort = contents.match(/PORT\s*\?\?\s*"(\d{2,5})"/);
    if (envPort?.[1]) {
      return Number.parseInt(envPort[1], 10);
    }
    const literalPort = contents.match(/localhost:(\d{2,5})/i) ?? contents.match(/127\.0\.0\.1:(\d{2,5})/i);
    if (literalPort?.[1]) {
      return Number.parseInt(literalPort[1], 10);
    }
  } catch {
    return null;
  }
  return null;
}

function inferRuntimeFallback(repoPath: string): Record<string, unknown> {
  const packageJsonPaths = walkRepoForFileNames(repoPath, new Set(["package.json"]), 3);
  const candidates = packageJsonPaths
    .map(packageJsonPath => {
      const manifest = readJsonRecord(packageJsonPath);
      const scripts = manifest?.scripts && typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts)
        ? manifest.scripts as Record<string, unknown>
        : {};
      const workingDirectory = path.dirname(packageJsonPath);
      const preferredScriptName = ["start", "dev", "preview", "serve"].find(name => typeof scripts[name] === "string") ?? null;
      if (!preferredScriptName) {
        return null;
      }
      const packageManager = detectPackageManager(workingDirectory, repoPath);
      const buildScriptName = typeof scripts.build === "string" ? "build" : null;
      const verifyScriptName = typeof scripts.typecheck === "string"
        ? "typecheck"
        : typeof scripts.test === "string"
          ? "test"
          : null;
      const relativeWorkingDirectory = path.relative(repoPath, workingDirectory) || ".";
      const startCommand = buildPackageScriptCommand(packageManager, preferredScriptName);
      const port = inferPortFromCommandOrEntry(repoPath, workingDirectory, typeof scripts[preferredScriptName] === "string" ? scripts[preferredScriptName] : startCommand);
      const baseUrl = port ? `http://127.0.0.1:${port}` : null;
      return {
        score: preferredScriptName === "start" ? 100 : preferredScriptName === "dev" ? 90 : 70,
        packageManager,
        relativeWorkingDirectory,
        startCommand,
        buildCommand: buildScriptName ? buildPackageScriptCommand(packageManager, buildScriptName) : null,
        verifyCommand: verifyScriptName ? buildPackageScriptCommand(packageManager, verifyScriptName) : null,
        baseUrl,
        port,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.score - left.score || left.relativeWorkingDirectory.localeCompare(right.relativeWorkingDirectory));

  const best = candidates[0];
  if (!best) {
    return {};
  }

  return {
    installCommands: [{
      label: "install",
      command: buildInstallCommand(best.packageManager),
      workingDirectory: best.relativeWorkingDirectory,
      purpose: "Install repository dependencies.",
    }],
    buildCommands: best.buildCommand ? [{
      label: "build",
      command: best.buildCommand,
      workingDirectory: best.relativeWorkingDirectory,
      purpose: "Build the primary application target.",
    }] : [],
    startCommands: [{
      label: "start",
      command: best.startCommand,
      workingDirectory: best.relativeWorkingDirectory,
      purpose: "Boot the primary application target.",
    }],
    verificationCommands: best.verifyCommand ? [{
      label: "verify",
      command: best.verifyCommand,
      workingDirectory: best.relativeWorkingDirectory,
      purpose: "Run the repository verification step.",
    }] : [],
    packageManagers: [best.packageManager],
    targets: [{
      label: "primary-app",
      kind: "web",
      workingDirectory: best.relativeWorkingDirectory,
      startCommand: best.startCommand,
      baseUrl: best.baseUrl,
      healthUrls: best.baseUrl ? [best.baseUrl] : [],
      framework: "node",
    }],
    workingDirectories: [best.relativeWorkingDirectory],
    serviceDependencies: [],
    envFiles: [],
    ports: best.port ? [best.port] : [],
    baseUrls: best.baseUrl ? [best.baseUrl] : [],
  };
}

function buildDeterministicStandardizedHandoff(options: {
  agentId: string;
  agentName: string;
  roleId: string;
  roleName: string;
  repoPath: string;
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"];
  priorOutputs: PriorRoleOutput[];
  primarySource: JobExecutionRecord["source"];
  companionSource?: JobExecutionRecord["source"] | null | undefined;
}): RoleOutput {
  const runtimeData = pickSectionData(options.priorOutputs, "runtime-scout", ["Runtime scout"]);
  const authData = pickSectionData(options.priorOutputs, "auth-cartographer", ["Auth map"]);
  const navigationData = pickSectionData(options.priorOutputs, "navigation-qa-planner", ["Navigation QA plan"]);
  const browserData = pickSectionData(options.priorOutputs, "browser-executor", ["Browser execution plan"]);
  const playwrightData = pickSectionData(options.priorOutputs, "playwright-operator", ["Playwright operator plan", "Playwright preflight"]);
  const artifactData = pickSectionData(options.priorOutputs, "artifact-auditor", ["Artifact expectations"]);
  const remediationData = pickSectionData(options.priorOutputs, "remediation-planner", ["Remediation planning"]);
  const fixReadinessData = pickSectionData(options.priorOutputs, "fix-readiness-emitter", ["Fix readiness handoff"]);
  const releaseData = pickSectionData(options.priorOutputs, "release-gate-scorer", ["Release gate recommendation"]);
  const liveSurfaceData = pickSectionData(options.priorOutputs, "live-surface-resolver", ["Live surface resolution"]);
  const topologyData = pickSectionData(options.priorOutputs, "source-topology-scout", ["Source topology", "Repository inventory"]);
  const preflightPlan = detectPlaywrightPreflight(options.repoPath);
  const runtimeFallback = inferRuntimeFallback(options.repoPath);
  const syntheticFindings = options.priorOutputs.flatMap(output => output.output.findings.map(finding => ({
    id: finding.id ?? createId("finding"),
    roleId: output.roleId,
    category: normalizeFindingCategory(finding.category, output.roleId),
    severity: finding.severity,
    title: finding.title,
    message: finding.message,
    suggestion: finding.suggestion,
    evidence: finding.evidence,
    evidenceRefs: [],
    sourceIds: finding.sourceIds ?? [],
    paths: finding.paths ?? [],
    remediationPackIds: [],
  })));
  const remediationPacks = normalizeRemediationPacks(
    remediationData.remediationPacks
    ?? remediationData.packCandidates
    ?? remediationData,
  );
  const normalizedRemediationPacks = remediationPacks.length > 0 ? remediationPacks : buildRemediationPacks(syntheticFindings);
  const fixHandoff = normalizeFixHandoff(fixReadinessData.fixHandoff ?? fixReadinessData);

  const navigationTargets = (() => {
    const explicitTargets = normalizeNavigationTargets(
      navigationData.navigationTargets
      ?? browserData.navigationTargets
      ?? playwrightData.navigationTargets,
    );
    if (explicitTargets.length > 0) {
      return explicitTargets;
    }
    const fallbackPaths = combineUniqueStrings(
      ["/"],
      authData.loginRoutes,
      authData.protectedRoutes,
      authData.frontend && typeof authData.frontend === "object" ? (authData.frontend as Record<string, unknown>).loginRoutes : [],
      authData.frontend && typeof authData.frontend === "object" ? (authData.frontend as Record<string, unknown>).protectedRoutes : [],
    );
    return fallbackPaths.map(route => ({
      path: route,
      purpose: route === "/" ? "default entry route" : null,
      requiresAuth: normalizeStringArray(
        authData.protectedRoutes
        ?? (authData.frontend && typeof authData.frontend === "object" ? (authData.frontend as Record<string, unknown>).protectedRoutes : []),
      ).includes(route),
      source: "inferred" as const,
    }));
  })();

  const detectedSurfaces = normalizeSurfaceDescriptors(
    navigationData.detectedSurfaces
    ?? liveSurfaceData.detectedSurfaces
    ?? topologyData.detectedSurfaces
    ?? [
      {
        label: options.primarySource.displayName,
        kind: "repo-app",
        location: options.primarySource.location,
        companion: false,
        confidence: "medium",
      },
      ...(options.companionSource ? [{
        label: options.companionSource.displayName,
        kind: "repo-app",
        location: options.companionSource.location,
        companion: true,
        confidence: "medium",
      }] : []),
    ],
  );

  const artifactExpectations = normalizeArtifactExpectations(
    artifactData.artifactExpectations
    ?? navigationData.artifactExpectations
    ?? [
      { kind: "runtime-log", required: true, label: "Runtime boot log for the primary app target." },
      ...(options.runtimeMode === "browser"
        ? [
            { kind: "screenshot", required: true, label: "Representative browser screenshots for navigated pages." },
            { kind: "trace", required: true, label: "Playwright trace for direct browser QA." },
            { kind: "storage-state", required: true, label: "Captured browser storage state after QA login attempts." },
          ]
        : []),
      ...(preflightPlan
        ? [{ kind: "playwright-report", required: false, label: "Repository-native Playwright report artifacts when present." }]
        : []),
    ],
  );
  const playwrightDetected = firstBoolean(
    playwrightData.detected,
    playwrightData.present,
    typeof playwrightData.configPath === "string" || preflightPlan !== null,
  );
  const playwrightRunnable = firstBoolean(
    playwrightData.runnable,
    typeof playwrightData.command === "string" || normalizeExecutionCommandArray(playwrightData.commands).length > 0,
    false,
  );
  const playwrightPassed = firstBoolean(
    playwrightData.passed,
    typeof playwrightData.exitCode === "number" ? playwrightData.exitCode === 0 : undefined,
    playwrightData.timedOut === true ? false : undefined,
    false,
  );
  const playwrightSuiteStatus = (() => {
    const explicitStatus = firstString(playwrightData.suiteStatus, playwrightData.status);
    if (explicitStatus === "detected" || explicitStatus === "runnable" || explicitStatus === "passed" || explicitStatus === "failed" || explicitStatus === "blocked") {
      return explicitStatus;
    }
    if (!playwrightDetected) {
      return "not-detected" as const;
    }
    if (playwrightData.timedOut === true) {
      return "blocked" as const;
    }
    if (playwrightPassed) {
      return "passed" as const;
    }
    if (playwrightRunnable && typeof playwrightData.exitCode === "number") {
      return playwrightData.exitCode === 0 ? "passed" : "failed";
    }
    if (playwrightRunnable) {
      return "runnable" as const;
    }
    return "detected" as const;
  })();

  const rawHandoff = {
    schemaVersion: "speclens.agent-handoff.v1",
    auditBundleId: resolveAuditBundleId(options.agentId),
    generatedBy: {
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.roleId,
      roleName: options.roleName,
    },
    runtime: {
      ...runtimeFallback,
      ...runtimeData,
    },
    auth: {
      frontend: {
        ...(authData.frontend && typeof authData.frontend === "object" ? authData.frontend as Record<string, unknown> : {}),
      },
      api: {
        ...(authData.api && typeof authData.api === "object" ? authData.api as Record<string, unknown> : {}),
      },
      ...authData,
    },
    playwright: {
      ...navigationData,
      ...browserData,
      ...playwrightData,
      present: playwrightDetected,
      detected: playwrightDetected,
      runnable: playwrightRunnable,
      passed: playwrightPassed,
      suiteStatus: playwrightSuiteStatus,
      readiness: firstString(
        playwrightData.readiness,
        browserData.readiness,
        playwrightPassed ? "ready" : playwrightDetected ? "partial" : "blocked",
      ),
      packageManager: firstString(playwrightData.packageManager, preflightPlan?.packageManager),
      configPaths: combineUniqueStrings(
        playwrightData.configPaths,
        preflightPlan?.configPath ? [preflightPlan.configPath] : [],
      ),
      commands: normalizeExecutionCommandArray(
        Array.isArray(playwrightData.commands) && playwrightData.commands.length > 0
          ? playwrightData.commands
          : preflightPlan
            ? [{
                label: preflightPlan.label,
                command: preflightPlan.command,
                workingDirectory: path.relative(options.repoPath, preflightPlan.workingDirectory) || ".",
                purpose: "List or execute the repository-native Playwright suite.",
              }]
            : [],
      ),
      setupCommands: normalizeExecutionCommandArray(playwrightData.setupCommands),
      workingDirectories: combineUniqueStrings(
        playwrightData.workingDirectories,
        navigationData.workingDirectories,
        preflightPlan ? [path.relative(options.repoPath, preflightPlan.workingDirectory) || "."] : [],
      ),
      baseUrlStrategy: firstString(playwrightData.baseUrlStrategy, navigationData.baseUrlStrategy, "PLAYWRIGHT_BASE_URL"),
      authStrategy: firstString(playwrightData.authStrategy, navigationData.authStrategy),
      testTargets: combineUniqueStrings(playwrightData.testTargets, browserData.testTargets),
      navigationTargets,
      journeys: normalizeQaJourneys(navigationData.journeys ?? browserData.journeys ?? playwrightData.journeys),
      assertions: combineUniqueStrings(navigationData.assertions, browserData.assertions, playwrightData.assertions),
      reporters: combineUniqueStrings(playwrightData.reporters),
      artifacts: combineUniqueStrings(
        playwrightData.artifacts,
        artifactExpectations.map(expectation => expectation.kind),
      ),
      prerequisites: combineUniqueStrings(playwrightData.prerequisites),
      coverageGaps: combineUniqueStrings(playwrightData.coverageGaps),
    },
    detectedSurfaces,
    executionCoverage: {
      attempted: [],
      skipped: [],
    },
    artifactExpectations,
    remediationPacks: normalizedRemediationPacks,
    fixHandoff,
    releaseGateDecision: normalizeReleaseGateDecision(releaseData.releaseGateDecision ?? releaseData.decision ?? releaseData),
    blockers: syntheticFindings
      .filter(finding => finding.severity === "high")
      .slice(0, 8)
      .map(finding => ({
      title: finding.title,
      severity: finding.severity,
      message: finding.message,
      evidence: finding.evidence,
    })),
    recommendations: [...new Set(syntheticFindings.map(finding => finding.suggestion).filter(Boolean))].slice(0, 8).map(suggestion => ({
      title: "Recommended follow-up",
      action: suggestion,
      priority: "medium" as const,
    })),
  };

  const standardizedOutput = standardizedAgentHandoffSchema.parse(
    normalizeStandardizedHandoff(rawHandoff, {
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.roleId,
      roleName: options.roleName,
    }),
  );

  return roleOutputSchema.parse({
    summary: "Canonical handoff synthesized deterministically from prior role outputs and repository evidence.",
    sections: [{
      title: "Standardized JSON handoff",
      status: "ready",
      summary: "Structured runtime, auth, browser, artifact, and remediation handoff was synthesized deterministically.",
      data: {
        standardizedOutput,
      },
    }],
    findings: [],
  });
}

function toRoleOutputFromLegacyResult(result: {
  sections: AnalysisReport["sections"];
  findings: AnalysisReport["findings"];
}): RoleOutput {
  return roleOutputSchema.parse({
    summary: result.sections.map(section => section.summary).filter(Boolean).join("\n\n"),
    sections: result.sections.map(section => ({
      id: section.id,
      title: section.title,
      status: section.status,
      summary: section.summary,
      data: section.data,
    })),
    findings: result.findings.map(finding => ({
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      message: finding.message,
      suggestion: finding.suggestion,
      evidence: finding.evidence,
      sourceIds: finding.sourceIds,
      paths: finding.paths,
      remediationPackIds: finding.remediationPackIds,
    })),
  });
}

function shouldExecuteStandardizedHandoff(options: {
  agentId: string;
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"];
}): boolean {
  if (
    options.agentId === "agent-universal-smoke"
    || options.agentId === "agent-e2e-smoke"
    || options.agentId === "agent-e2e-remediation"
  ) {
    return false;
  }
  return options.runtimeMode === "browser" || options.runtimeMode === "static";
}

async function executeNativeRole(options: {
  jobId: string;
  agentId: string;
  agentName: string;
  role: {
    id: string;
    name: string;
    executorKind: AiRoleExecutorKind;
    nativeExecutorId: string | null;
  };
  repoPath: string;
  tempDir: string;
  logs: AnalysisLogEvent[];
  priorOutputs: PriorRoleOutput[];
  primarySource: JobExecutionRecord["source"];
  companionSource?: JobExecutionRecord["source"] | null | undefined;
  secrets: JobExecutionRecord["secrets"];
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"];
}): Promise<NativeExecutionResult> {
  const nativeExecutorId = options.role.nativeExecutorId as NativeExecutorId | null;
  if (!nativeExecutorId) {
    return { output: roleOutputSchema.parse({ summary: "", sections: [], findings: [] }), logs: [] };
  }

  const workspace = createCoreWorkspace({
    rootDir: path.join(options.tempDir, "native-executors"),
    name: safeSegment(`${options.jobId}-${nativeExecutorId}`),
  });
  const inventory = buildRepoInventory(options.repoPath);
  const baseContext = {
    jobId: options.jobId,
    repoPath: options.repoPath,
    inventory,
    workspace,
  };

  switch (nativeExecutorId) {
    case "native-repo-inventory":
      {
        const result = await analyzeRoles({
          ...baseContext,
          roles: ["repo-inventory"],
          runtimeMode: "static",
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "native-license-policy":
      {
        const result = await analyzeRoles({
          ...baseContext,
          roles: ["license-policy"],
          runtimeMode: "static",
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "native-component-inventory":
      {
        const result = await analyzeRoles({
          ...baseContext,
          roles: ["component-inventory"],
          runtimeMode: "static",
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "native-ui-label-scan":
      {
        const result = await analyzeRoles({
          ...baseContext,
          roles: ["ui-label-scan"],
          runtimeMode: "static",
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "native-browser-suite":
      {
        const result = await analyzeBrowserRoles({
          ...baseContext,
          roles: ["browser-self-check", "interaction-test"],
          secrets: options.secrets,
          allowHostExecution: true,
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "native-visual-inspection":
      {
        const result = await analyzeBrowserRoles({
          ...baseContext,
          roles: ["visual-inspection"],
          secrets: options.secrets,
          allowHostExecution: true,
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "deterministic-standardized-handoff":
      return {
        output: buildDeterministicStandardizedHandoff({
          agentId: options.agentId,
          agentName: options.agentName,
          roleId: options.role.id,
          roleName: options.role.name,
          repoPath: options.repoPath,
          runtimeMode: options.runtimeMode,
          priorOutputs: options.priorOutputs,
          primarySource: options.primarySource,
          companionSource: options.companionSource,
        }),
        logs: [],
      };
  }
}

async function executeRole(options: {
  jobId: string;
  role: {
    id: string;
    name: string;
    description: string | null;
    prompt: string;
    order: number;
    consoleVisibility: "normal" | "quiet";
    executorKind: AiRoleExecutorKind;
    nativeExecutorId: string | null;
    dependsOnRoleIds: string[];
    skills: Array<{ name: string; instructions: string; toolCapabilities: AiToolCapability[] }>;
  };
  agentId: string;
  agentName: string;
  repoPath: string;
  tempDir: string;
  authPath: string | null;
  logs: AnalysisLogEvent[];
  priorOutputs: PriorRoleOutput[];
  learnables: Learnable[];
  primarySource: JobExecutionRecord["source"];
  companionSource?: JobExecutionRecord["source"] | null;
  secrets: JobExecutionRecord["secrets"];
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"];
}): Promise<RoleOutput> {
  const config = loadAiWorkerConfig();
  const outputPath = path.join(options.tempDir, `role-${safeSegment(options.role.id)}.json`);
  const grantedTools = collectToolCapabilities(options.role.skills);
  const sandboxMode = resolveSandboxMode(grantedTools);
  const sandboxLabel = config.codexBypassSandbox ? "container-guarded" : sandboxMode;
  const defaultVisibility: AnalysisLogEvent["visibility"] = options.role.consoleVisibility === "quiet" ? "verbose" : "default";
  const roleStepId = `role:${options.role.id}`;
  const roleOrder = 100 + options.role.order;
  const roleStartedAt = new Date().toISOString();
  await appendExecutionStepLog(options.jobId, options.logs, {
    id: roleStepId,
    order: roleOrder,
    title: options.role.name,
    stepType: "role",
    agentId: options.agentId,
    agentName: options.agentName,
    roleId: options.role.id,
    roleName: options.role.name,
    executorKind: options.role.executorKind,
    nativeExecutorId: options.role.nativeExecutorId,
    status: "running",
    detail: options.role.executorKind === "native"
      ? "Running deterministic native executor."
      : options.role.executorKind === "hybrid"
        ? "Running native executor before Codex synthesis."
        : "Running Codex role execution.",
    startedAt: roleStartedAt,
    finishedAt: null,
    durationMs: null,
  }, defaultVisibility);

  let nativeOutput: RoleOutput | null = null;
  if (options.role.executorKind === "native" || options.role.executorKind === "hybrid") {
    const nativeStartedAt = new Date().toISOString();
    const nativeStepId = `${roleStepId}:native`;
    await appendExecutionStepLog(options.jobId, options.logs, {
      id: nativeStepId,
      order: 1000 + options.role.skills.length,
      title: `${options.role.name} native executor`,
      stepType: "executor",
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.role.id,
      roleName: options.role.name,
      executorKind: "native",
      nativeExecutorId: options.role.nativeExecutorId,
      status: "running",
      detail: options.role.nativeExecutorId,
      startedAt: nativeStartedAt,
      finishedAt: null,
      durationMs: null,
    }, defaultVisibility);
    try {
      const nativeResult = await executeNativeRole({
        jobId: options.jobId,
        agentId: options.agentId,
        agentName: options.agentName,
        role: options.role,
        repoPath: options.repoPath,
        tempDir: options.tempDir,
        logs: options.logs,
        priorOutputs: options.priorOutputs,
        primarySource: options.primarySource,
        companionSource: options.companionSource,
        secrets: options.secrets,
        runtimeMode: options.runtimeMode,
      });
      nativeOutput = nativeResult.output;
      for (const nativeLog of nativeResult.logs) {
        await appendLog(
          options.jobId,
          options.logs,
          nativeLog.scope,
          nativeLog.message,
          nativeLog.level,
          undefined,
          defaultVisibility,
        );
      }
      await appendExecutionStepLog(options.jobId, options.logs, {
        id: nativeStepId,
        order: roleOrder + 1,
        title: `${options.role.name} native executor`,
        stepType: "executor",
        agentId: options.agentId,
        agentName: options.agentName,
        roleId: options.role.id,
        roleName: options.role.name,
        executorKind: "native",
        nativeExecutorId: options.role.nativeExecutorId,
        status: "succeeded",
        detail: `${nativeOutput.sections.length} section(s), ${nativeOutput.findings.length} finding(s)`,
        startedAt: nativeStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, new Date().getTime() - new Date(nativeStartedAt).getTime()),
      }, defaultVisibility);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Native executor failed.";
      await appendExecutionStepLog(options.jobId, options.logs, {
        id: nativeStepId,
        order: roleOrder + 1,
        title: `${options.role.name} native executor`,
        stepType: "executor",
        agentId: options.agentId,
        agentName: options.agentName,
        roleId: options.role.id,
        roleName: options.role.name,
        executorKind: "native",
        nativeExecutorId: options.role.nativeExecutorId,
        status: "failed",
        detail,
        startedAt: nativeStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, new Date().getTime() - new Date(nativeStartedAt).getTime()),
      }, defaultVisibility);
      if (options.role.executorKind === "native") {
        await appendExecutionStepLog(options.jobId, options.logs, {
          id: roleStepId,
          order: roleOrder,
          title: options.role.name,
          stepType: "role",
          agentId: options.agentId,
          agentName: options.agentName,
          roleId: options.role.id,
          roleName: options.role.name,
          executorKind: options.role.executorKind,
          nativeExecutorId: options.role.nativeExecutorId,
          status: "failed",
          detail,
          startedAt: roleStartedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
        }, defaultVisibility);
        throw error;
      }
      await appendLog(options.jobId, options.logs, "agent", `${options.role.name} native executor failed but hybrid Codex synthesis will continue: ${detail}`, "warn", undefined, defaultVisibility);
    }
  }

  if (options.role.executorKind === "native") {
    const nativeOnlyBaseOutput = nativeOutput ?? roleOutputSchema.parse({ summary: "", sections: [], findings: [] });
    const nativeOnlyOutput = options.role.id === "standardized-json-output"
      ? validateStandardizedRoleOutput(nativeOnlyBaseOutput, {
          agentId: options.agentId,
          agentName: options.agentName,
          roleId: options.role.id,
          roleName: options.role.name,
        })
      : nativeOnlyBaseOutput;
    const finalizedNativeOutput = options.role.id === "standardized-json-output"
      ? await (async () => {
          const handoffSection = nativeOnlyOutput.sections.find(section => section.title === "Standardized JSON handoff");
          if (!handoffSection?.data.standardizedOutput) {
            return nativeOnlyOutput;
          }
          if (!shouldExecuteStandardizedHandoff({
            agentId: options.agentId,
            runtimeMode: options.runtimeMode,
          })) {
            return nativeOnlyOutput;
          }
          const executionResult = await executeStandardizedHandoff({
            jobId: options.jobId,
            logs: options.logs,
            repoPath: options.repoPath,
            tempDir: options.tempDir,
            handoff: standardizedAgentHandoffSchema.parse(handoffSection.data.standardizedOutput),
            secrets: options.secrets,
            primarySourceId: options.primarySource.id,
            companionSourceId: options.companionSource?.id ?? null,
          });
          return {
            ...nativeOnlyOutput,
            sections: [...nativeOnlyOutput.sections, ...executionResult.sections],
            findings: [...nativeOnlyOutput.findings, ...executionResult.findings],
          };
        })()
      : nativeOnlyOutput;
    await appendExecutionStepLog(options.jobId, options.logs, {
      id: roleStepId,
      order: roleOrder,
      title: options.role.name,
      stepType: "role",
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.role.id,
      roleName: options.role.name,
      executorKind: options.role.executorKind,
      nativeExecutorId: options.role.nativeExecutorId,
      status: "succeeded",
      detail: `${finalizedNativeOutput.sections.length} section(s), ${finalizedNativeOutput.findings.length} finding(s)`,
      startedAt: roleStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
    }, defaultVisibility);
    return finalizedNativeOutput;
  }

  const prompt = buildRolePrompt({
    agentName: options.agentName,
    roleName: options.role.name,
    roleId: options.role.id,
    roleDescription: options.role.description,
    pairedSourceContext: options.companionSource
      ? {
          primaryDisplayName: options.primarySource.displayName,
          primaryType: options.primarySource.type,
          companionDisplayName: options.companionSource.displayName,
          companionType: options.companionSource.type,
        }
      : null,
    rolePrompt: options.role.prompt,
    skills: options.role.skills,
    priorOutputs: selectRoleContext(options.role.dependsOnRoleIds, options.priorOutputs),
    learnables: options.learnables,
    nativeExecutorOutput: nativeOutput,
  });
  capturePrompt(config.promptCapturePath, {
    roleId: options.role.id,
    roleName: options.role.name,
    prompt,
  });

  await appendLog(options.jobId, options.logs, "agent", `Running role ${options.role.name}.`, "info", undefined, defaultVisibility);
  await appendLog(
    options.jobId,
    options.logs,
    "agent",
    `Role ${options.role.name} granted tools: ${grantedTools.length > 0 ? grantedTools.join(", ") : "repo-read"}; sandbox ${sandboxLabel}.`,
    "info",
    undefined,
    defaultVisibility,
  );
  let run: CodexRunResult | null = null;
  for (let attempt = 1; attempt <= Math.max(1, config.codexMaxAttempts); attempt += 1) {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { force: true });
    }
    const outputSchemaPath = config.codexUseOutputSchema
      ? path.join(options.tempDir, `role-${safeSegment(options.role.id)}-schema.json`)
      : undefined;
    run = await runCodexExec({
      codexBin: config.codexBin,
      codexModel: config.codexModel,
      repoPath: options.repoPath,
      prompt,
      outputPath,
      timeoutMs: config.codexTimeoutMs,
      sandboxMode,
      bypassSandbox: config.codexBypassSandbox,
      authPath: options.authPath,
      onStdoutLine: line => appendLog(options.jobId, options.logs, "codex", `${options.role.name}: ${line}`, "info", undefined, "verbose"),
      onStderrLine: line => appendLog(options.jobId, options.logs, "codex", `${options.role.name}: ${line}`, "warn", undefined, "verbose"),
      ...(outputSchemaPath ? { outputSchemaPath } : {}),
    });
    await syncCodexAuth(options.authPath);

    if (!run.timedOut && run.exitCode === 0) {
      break;
    }

    if (attempt >= Math.max(1, config.codexMaxAttempts) || !isRetryableCodexFailure(run)) {
      break;
    }

    const detail = sanitizeCodexDiagnosticText(run.stderr) || sanitizeCodexDiagnosticText(run.stdout) || "transient Codex failure";
    await appendLog(
      options.jobId,
      options.logs,
      "agent",
      `Role ${options.role.name} hit a retryable Codex error on attempt ${attempt}/${config.codexMaxAttempts}: ${truncateLogMessage(detail, 240)}. Retrying in ${Math.round(config.codexRetryDelayMs / 1000)}s.`,
      "warn",
      undefined,
      defaultVisibility,
    );
    await sleep(config.codexRetryDelayMs);
  }

  if (!run) {
    await appendExecutionStepLog(options.jobId, options.logs, {
      id: roleStepId,
      order: roleOrder,
      title: options.role.name,
      stepType: "role",
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.role.id,
      roleName: options.role.name,
      executorKind: options.role.executorKind,
      nativeExecutorId: options.role.nativeExecutorId,
      status: "failed",
      detail: "Codex execution did not start.",
      startedAt: roleStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
    }, defaultVisibility);
    throw new Error(`${options.role.name} did not start.`);
  }
  if (run.timedOut) {
    await appendExecutionStepLog(options.jobId, options.logs, {
      id: roleStepId,
      order: roleOrder,
      title: options.role.name,
      stepType: "role",
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.role.id,
      roleName: options.role.name,
      executorKind: options.role.executorKind,
      nativeExecutorId: options.role.nativeExecutorId,
      status: "failed",
      detail: `Codex timed out after ${config.codexTimeoutMs}ms.`,
      startedAt: roleStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
    }, defaultVisibility);
    throw new Error(`${options.role.name} timed out after ${config.codexTimeoutMs}ms.`);
  }
  if (run.exitCode !== 0) {
    const detail = sanitizeCodexDiagnosticText(run.stderr) || sanitizeCodexDiagnosticText(run.stdout);
    await appendExecutionStepLog(options.jobId, options.logs, {
      id: roleStepId,
      order: 100 + options.role.skills.length,
      title: options.role.name,
      stepType: "role",
      agentId: options.agentId,
      agentName: options.agentName,
      roleId: options.role.id,
      roleName: options.role.name,
      executorKind: options.role.executorKind,
      nativeExecutorId: options.role.nativeExecutorId,
      status: "failed",
      detail: detail || `Codex exited with code ${run.exitCode}.`,
      startedAt: roleStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
    }, defaultVisibility);
    throw new Error(`${options.role.name} failed${detail ? `: ${detail}` : "."}`);
  }

  const baseOutput = readRoleOutput(outputPath);
  const withExecutionEvidence = options.role.id === "playwright-operator"
    ? await augmentWithPlaywrightPreflight({
        jobId: options.jobId,
        logs: options.logs,
        repoPath: options.repoPath,
        output: baseOutput,
        primarySourceId: options.primarySource.id,
        companionSourceId: options.companionSource?.id ?? null,
      })
    : baseOutput;
  const output = options.role.id === "standardized-json-output"
    ? validateStandardizedRoleOutput(withExecutionEvidence, {
        agentId: options.agentId,
        agentName: options.agentName,
        roleId: options.role.id,
        roleName: options.role.name,
      })
    : withExecutionEvidence;
  const finalizedOutput = options.role.id === "standardized-json-output"
    ? await (async () => {
        const handoffSection = output.sections.find(section => section.title === "Standardized JSON handoff");
        if (!handoffSection?.data.standardizedOutput) {
          return output;
        }
        if (!shouldExecuteStandardizedHandoff({
          agentId: options.agentId,
          runtimeMode: options.runtimeMode,
        })) {
          return output;
        }
        const executionResult = await executeStandardizedHandoff({
          jobId: options.jobId,
          logs: options.logs,
          repoPath: options.repoPath,
          tempDir: options.tempDir,
          handoff: standardizedAgentHandoffSchema.parse(handoffSection.data.standardizedOutput),
          secrets: options.secrets,
          primarySourceId: options.primarySource.id,
          companionSourceId: options.companionSource?.id ?? null,
        });
        return {
          ...output,
          sections: [...output.sections, ...executionResult.sections],
          findings: [...output.findings, ...executionResult.findings],
        };
      })()
    : output;
  const mergedOutput = nativeOutput ? mergeRoleOutputs(nativeOutput, finalizedOutput) : finalizedOutput;
  await appendExecutionStepLog(options.jobId, options.logs, {
    id: roleStepId,
    order: roleOrder,
    title: options.role.name,
    stepType: "role",
    agentId: options.agentId,
    agentName: options.agentName,
    roleId: options.role.id,
    roleName: options.role.name,
    executorKind: options.role.executorKind,
    nativeExecutorId: options.role.nativeExecutorId,
    status: "succeeded",
    detail: `${(nativeOutput ? mergedOutput : finalizedOutput).sections.length} section(s), ${(nativeOutput ? mergedOutput : finalizedOutput).findings.length} finding(s)`,
    startedAt: roleStartedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
  }, defaultVisibility);
  await appendLog(
    options.jobId,
    options.logs,
    "agent",
    `Role ${options.role.name} completed with ${mergedOutput.sections.length} section(s) and ${mergedOutput.findings.length} finding(s).`,
    "info",
    undefined,
    defaultVisibility,
  );
  if (mergedOutput.summary.trim().length > 0) {
    await appendLog(
      options.jobId,
      options.logs,
      "agent-output",
      `${options.role.name} summary: ${truncateLogMessage(mergedOutput.summary.trim(), 280)}`,
      "info",
      undefined,
      defaultVisibility,
    );
  }
  if (mergedOutput.sections.length > 0) {
    await appendLog(
      options.jobId,
      options.logs,
      "agent-output",
      `${options.role.name} sections: ${truncateLogMessage(mergedOutput.sections.map(section => section.title).join(", "), 280)}`,
      "info",
      undefined,
      defaultVisibility,
    );
    for (const section of mergedOutput.sections.slice(0, 6)) {
      await appendLog(
        options.jobId,
        options.logs,
        "agent-output",
        `${options.role.name} -> ${section.title} [${section.status}]: ${truncateLogMessage(section.summary, 260)}`,
        section.status === "ready" ? "info" : "warn",
        undefined,
        defaultVisibility,
      );
    }
  }
  if (mergedOutput.findings.length > 0) {
    await appendLog(
      options.jobId,
      options.logs,
      "agent-output",
      `${options.role.name} findings: ${truncateLogMessage(mergedOutput.findings.map(finding => `[${finding.severity}] ${finding.title}`).join(" | "), 280)}`,
      "warn",
      undefined,
      defaultVisibility,
    );
    for (const finding of mergedOutput.findings.slice(0, 6)) {
      await appendLog(
        options.jobId,
        options.logs,
        "agent-output",
        `${options.role.name} -> [${finding.severity}] ${finding.title}: ${truncateLogMessage(finding.message, 260)}`,
        finding.severity === "high" ? "error" : "warn",
        undefined,
        defaultVisibility,
      );
    }
  }

  return mergedOutput;
}

function resolveRepoTitle(execution: JobExecutionRecord, repoPath: string): string {
  const base = execution.source.displayName || path.basename(repoPath) || "repository";
  return `${base} agent analysis report`;
}

async function runAgentJob(
  execution: JobExecutionRecord,
  queueMessageId: string,
): Promise<JobEnvelope> {
  const config = loadAiWorkerConfig();
  const jobId = execution.job.id;
  const logs: AnalysisLogEvent[] = [];
  const tempDir = path.join(config.tempRoot, `${safeSegment(jobId)}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

  const agentId = execution.job.agentId;
  if (!agentId) {
    throw new Error("Agent job is missing agentId.");
  }

  await appendLog(jobId, logs, "agent", `Agent ${config.workerId} claimed job ${jobId}.`);

  try {
    const plan = await getAiAgentExecutionPlan(agentId);
    const roleDefinitions = mapRoleDefinitions(plan);
    const estimatedTotalDurationMs = estimatePlanDurationMs(plan.roles, execution.job.runtimeMode);
    const jobStartedAt = Date.now();

    await appendLog(
      jobId,
      logs,
      "agent",
      `Planned ${plan.roles.length} role(s); estimated total runtime ${formatDurationMs(estimatedTotalDurationMs)} for ${execution.job.runtimeMode} mode.`,
    );

    const materializeStartedAt = new Date().toISOString();
    await appendExecutionStepLog(jobId, logs, {
      id: "stage:materialize-source",
      order: 0,
      title: "Materialize source",
      stepType: "stage",
      agentId: plan.agent.id,
      agentName: plan.agent.name,
      roleId: null,
      roleName: null,
      executorKind: null,
      nativeExecutorId: null,
      status: "running",
      detail: execution.companionSource
        ? `${execution.source.displayName} + ${execution.companionSource.displayName}`
        : execution.source.displayName,
      startedAt: materializeStartedAt,
      finishedAt: null,
      durationMs: null,
    });
    await appendLog(
      jobId,
      logs,
      "source",
      execution.companionSource
        ? `Materializing paired sources: ${execution.source.displayName} + ${execution.companionSource.displayName}.`
        : "Materializing repository source.",
    );
    let repoPath: string;
    try {
      ({ repoPath } = await materializeSource(execution, tempDir));
      await appendExecutionStepLog(jobId, logs, {
        id: "stage:materialize-source",
        order: 0,
        title: "Materialize source",
        stepType: "stage",
        agentId: plan.agent.id,
        agentName: plan.agent.name,
        roleId: null,
        roleName: null,
        executorKind: null,
        nativeExecutorId: null,
        status: "succeeded",
        detail: repoPath,
        startedAt: materializeStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, new Date().getTime() - new Date(materializeStartedAt).getTime()),
      });
    } catch (error) {
      await appendExecutionStepLog(jobId, logs, {
        id: "stage:materialize-source",
        order: 0,
        title: "Materialize source",
        stepType: "stage",
        agentId: plan.agent.id,
        agentName: plan.agent.name,
        roleId: null,
        roleName: null,
        executorKind: null,
        nativeExecutorId: null,
        status: "failed",
        detail: error instanceof Error ? error.message : "Source materialization failed.",
        startedAt: materializeStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, new Date().getTime() - new Date(materializeStartedAt).getTime()),
      });
      throw error;
    }
    const authPath = await stageCodexAuth(tempDir);
    const primaryLearnables = await listActiveSourceLearnables(execution.source.id);
    const companionLearnables = execution.companionSource
      ? (await listActiveSourceLearnables(execution.companionSource.id)).map(learnable => ({
          ...learnable,
          statement: `[Companion: ${execution.companionSource?.displayName}] ${learnable.statement}`,
          evidence: learnable.evidence.map(item => `[Companion] ${item}`),
        }))
      : [];
    const learnables = [...primaryLearnables, ...companionLearnables];
    if (learnables.length > 0) {
      await appendLog(
        jobId,
        logs,
        "learnables",
        execution.companionSource
          ? `Loaded ${primaryLearnables.length} primary learnable(s) and ${companionLearnables.length} companion learnable(s).`
          : `Loaded ${learnables.length} learnable(s) for this source.`,
      );
    }

    const sections: AnalysisReport["sections"] = [];
    const findings: AnalysisReport["findings"] = [];
    const priorOutputs: PriorRoleOutput[] = [];

    for (const [roleIndex, role] of plan.roles.entries()) {
      if (await isCancellationRequested(jobId)) {
        await appendLog(jobId, logs, "agent", "Job cancelled during agent execution.", "warn");
        return await finalizeAnalysisJobFailure(jobId, {
          status: "cancelled",
          failureReason: "Job cancelled during agent execution.",
        });
      }
      const roleStartedAt = Date.now();
      const output = await executeRole({
        jobId,
        role,
        agentId: plan.agent.id,
        agentName: plan.agent.name,
        repoPath,
        tempDir,
        authPath,
        logs,
        priorOutputs,
        learnables,
        primarySource: execution.source,
        companionSource: execution.companionSource,
        secrets: execution.secrets,
        runtimeMode: execution.job.runtimeMode,
      });
      if (
        (plan.agent.id === "agent-universal-smoke"
          || plan.agent.id === "agent-e2e-smoke"
          || plan.agent.id === "agent-e2e-remediation")
        && role.id === "runtime-scout"
      ) {
        const removedPaths = cleanupTransientRuntimeArtifacts(repoPath);
        if (removedPaths.length > 0) {
          await appendLog(
            jobId,
            logs,
            "agent",
            `Cleaned transient runtime artifacts after ${role.name}: ${removedPaths.join(", ")}.`,
            "info",
            undefined,
            "verbose",
          );
        }
      }
      const roleDurationMs = Date.now() - roleStartedAt;
      const remainingEstimateMs = plan.roles
        .slice(roleIndex + 1)
        .reduce((total, nextRole) => total + estimateRoleDurationMs(nextRole.id, execution.job.runtimeMode), 0);
      await appendLog(
        jobId,
        logs,
        "agent",
        `Role ${role.name} finished in ${formatDurationMs(roleDurationMs)}. Estimated remaining runtime ${formatDurationMs(remainingEstimateMs)}.`,
        "info",
        undefined,
        role.consoleVisibility === "quiet" ? "verbose" : "default",
      );
      priorOutputs.push({
        roleId: role.id,
        roleName: role.name,
        output,
      });

      if (output.summary.trim().length > 0) {
        sections.push({
          id: createId("section"),
          roleId: role.id,
          title: `${role.name} summary`,
          status: "ready",
          summary: output.summary.trim(),
          data: {},
        });
      }

      for (const section of output.sections) {
        sections.push({
          id: section.id ?? createId("section"),
          roleId: role.id,
          title: section.title,
          status: section.status,
          summary: section.summary,
          data: section.data,
        });
      }

      for (const finding of output.findings) {
        const normalizedSourceIds = inferFindingSourceIds({
          explicitSourceIds: finding.sourceIds ?? [],
          evidence: finding.evidence ?? [],
          paths: finding.paths ?? [],
          primarySourceId: execution.job.sourceId,
          companionSourceId: execution.job.companionSourceId,
        });
        const normalizedPaths = extractFindingPaths(finding.evidence ?? [], finding.paths ?? []);
        findings.push({
          id: finding.id ?? createId("finding"),
          roleId: role.id,
          category: normalizeFindingCategory(finding.category, role.id),
          severity: finding.severity,
          title: finding.title,
          message: finding.message,
          suggestion: finding.suggestion,
          evidence: finding.evidence ?? [],
          evidenceRefs: [],
          sourceIds: normalizedSourceIds,
          paths: normalizedPaths,
          remediationPackIds: finding.remediationPackIds ?? [],
        });
      }
    }

    const report = enrichReportForUniversalAudit(analysisReportSchema.parse({
      id: `report-${jobId}`,
      workspaceId: execution.workspace.id,
      jobId,
      status: "ready",
      roles: roleDefinitions,
      runtimeMode: execution.job.runtimeMode,
      title: resolveRepoTitle(execution, repoPath),
      summary: {
        totalFindings: findings.length,
        high: findings.filter(item => item.severity === "high").length,
        medium: findings.filter(item => item.severity === "medium").length,
        low: findings.filter(item => item.severity === "low").length,
        executionSteps: collectAnalysisExecutionSteps(logs),
      },
      findings,
      sections,
      artifacts: [],
      createdAt: new Date().toISOString(),
    }), plan.agent.id);

    const envelope = jobEnvelopeSchema.parse({
      job: {
        ...execution.job,
        status: "succeeded",
        reportId: report.id,
        finishedAt: new Date().toISOString(),
        queueMessageId,
      },
      logs: [],
      report,
      artifacts: report.artifacts,
      timing: {
        queueDurationMs: execution.job.startedAt && execution.job.createdAt
          ? Math.max(0, new Date(execution.job.startedAt).getTime() - new Date(execution.job.createdAt).getTime())
          : null,
        runDurationMs: Date.now() - jobStartedAt,
        totalDurationMs: Date.now() - new Date(execution.job.createdAt).getTime(),
        elapsedMs: Date.now() - new Date(execution.job.createdAt).getTime(),
        estimatedTotalMs: estimatedTotalDurationMs,
        estimatedRemainingMs: 0,
        confidence: "high",
        basis: "Derived from live worker execution timing and the persisted job timestamps.",
      },
      qualityScorecard: report.summary.qualityScorecard,
      capabilityGaps: report.summary.capabilityGaps,
      artifactAnalysis: report.summary.artifactAnalysis,
      executionSteps: report.summary.executionSteps,
    });

    await appendLog(
      jobId,
      logs,
      "agent",
      `Agent completed ${plan.roles.length} roles in ${formatDurationMs(Date.now() - jobStartedAt)}.`,
    );
    const activeLearnables = await replaceSourceLearnables(
      execution.workspace.id,
      execution.source.id,
      jobId,
      synthesizeLearnablesFromReport(report),
    );
    await appendLog(jobId, logs, "learnables", `Stored ${activeLearnables.length} learnable(s) for future runs.`);
    await appendLog(
      jobId,
      logs,
      "quality",
      `Quality score ${report.summary.qualityScorecard?.overallScore ?? 0}/100; ${report.summary.capabilityGaps.length} capability gap(s); release gate ${report.summary.releaseGateDecision?.status ?? "unknown"}.`,
    );
    const artifactEnvelope = writeHostedJobArtifacts({
      rootDir: tempDir,
      workspaceName: safeSegment(jobId),
      repoPath,
      envelope: {
        ...envelope,
        logs,
      },
    });
    const finalizedEnvelope = artifactEnvelope.report
      ? writeHostedJobArtifacts({
          rootDir: tempDir,
          workspaceName: safeSegment(jobId),
          repoPath,
          envelope: {
            ...artifactEnvelope,
            report: enrichReportForUniversalAudit(artifactEnvelope.report, plan.agent.id),
            logs,
          },
        })
      : artifactEnvelope;
    const mirroredEnvelope = await mirrorArtifactsToObjectStorage(storageConfig(), finalizedEnvelope, tempDir);
    await appendLog(
      jobId,
      logs,
      "artifact",
      `Persisted ${mirroredEnvelope.report?.artifacts.length ?? 0} artifact reference(s) for audit review.`,
    );
    return await finalizeAnalysisJobSuccess(jobId, {
      ...mirroredEnvelope,
      logs: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent worker failed.";
    await appendLog(jobId, logs, "agent", message, "error");
    return await finalizeAnalysisJobFailure(jobId, {
      failureReason: message,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runRemediationJob(
  execution: JobExecutionRecord,
  queueMessageId: string,
): Promise<JobEnvelope> {
  const jobId = execution.job.id;
  const logs: AnalysisLogEvent[] = [];
  const jobStartedAt = Date.now();
  const remediation = execution.metadata.remediation;
  const report = execution.parentReport;
  if (!remediation || !report) {
    return finalizeAnalysisJobFailure(jobId, {
      failureReason: "Remediation metadata or parent report is missing.",
    });
  }

  const tempDir = createRemediationTempDir();
  const exportDir = path.join(tempDir, "exports");
  const repoDir = path.join(tempDir, "repo");
  const authPath = await stageCodexAuth(tempDir);
  const requestId = execution.job.queueMessageId ?? undefined;
  const stepBase = `${jobId}-remediation`;

  try {
    fs.mkdirSync(exportDir, { recursive: true });
    await appendLog(jobId, logs, "remediation", `Preparing remediation for report ${report.id}.`, "info", requestId);
    await appendExecutionStepLog(jobId, logs, buildExecutionStep({
      id: `${stepBase}-materialize`,
      order: 0,
      title: "Materialize remediation repository",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Remediation worker",
      status: "running",
      startedAt: new Date().toISOString(),
    }));

    const repoPath = await materializeRemediationRepo({
      source: execution.source,
      repoDir,
      tempDir,
      storageConfig: storageConfig(),
      downloadObjectToFile,
    });
    const baseRef = remediation.baseRef || "HEAD";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const branchName = `speclens/${jobId.slice(0, 12)}-${timestamp}`;
    await runGit(["checkout", "-B", branchName, baseRef], repoPath);
    await appendExecutionStepLog(jobId, logs, buildExecutionStep({
      id: `${stepBase}-materialize`,
      order: 0,
      title: "Materialize remediation repository",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Remediation worker",
      status: "succeeded",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }));

    const selectedFindings = selectRemediationFindings(report, remediation);
    const validationCommands = resolveValidationCommands(repoPath, report);
    const validationLogPath = path.join(exportDir, "validation.log");
    let lastValidationOutput = "";
    let validationPassed = false;
    let commandsRun: string[] = [];
    let iterationCount = 0;
    let stopReason: ChangesetSummary["stopReason"] = "audit-only-complete";

    if (selectedFindings.length > 0) {
      for (let iteration = 1; iteration <= remediation.maxIterations; iteration += 1) {
        iterationCount = iteration;
        const outputPath = path.join(exportDir, `remediation-iteration-${iteration}.json`);
        const implementationStepId = `${stepBase}-implement-${iteration}`;
        const validationStepId = `${stepBase}-validate-${iteration}`;
        await appendExecutionStepLog(jobId, logs, buildExecutionStep({
          id: implementationStepId,
          order: iteration * 2 - 1,
          title: `Implementation pass ${iteration}`,
          stepType: "role",
          agentId: execution.job.agentId,
          agentName: "Remediation worker",
          roleId: "fix-readiness-emitter",
          roleName: "Fix readiness emitter",
          executorKind: "codex",
          status: "running",
          startedAt: new Date().toISOString(),
        }));
        const prompt = [
          "You are preparing a reviewable remediation changeset in an isolated Git worktree.",
          "Edit the repository to address the selected findings conservatively.",
          "Do not invent infrastructure or secrets. Keep changes bounded and reviewable.",
          "After editing, output JSON with keys: summary, changedFiles, commandsRun, notes.",
          "",
          `Base ref: ${baseRef}`,
          `Iteration: ${iteration}/${remediation.maxIterations}`,
          "",
          "Selected findings:",
          JSON.stringify(selectedFindings.map(finding => ({
            id: finding.id,
            severity: finding.severity,
            title: finding.title,
            message: finding.message,
            suggestion: finding.suggestion,
            evidence: finding.evidence,
            remediationPackIds: finding.remediationPackIds,
          })), null, 2),
          "",
          "Fix handoff:",
          JSON.stringify(report.summary.fixHandoff, null, 2),
          "",
          lastValidationOutput ? `Previous validation output:\n${lastValidationOutput}` : "",
        ].filter(Boolean).join("\n");
        await runCodexRemediation({ repoPath, prompt, outputPath, authPath });
        const changedFilesAfterEdit = (await runGit(["status", "--short"], repoPath))
          .split("\n")
          .map(line => line.trim())
          .filter(Boolean)
          .map(line => line.replace(/^[A-Z?]+\s+/, ""));
        await appendExecutionStepLog(jobId, logs, buildExecutionStep({
          id: implementationStepId,
          order: iteration * 2 - 1,
          title: `Implementation pass ${iteration}`,
          stepType: "role",
          agentId: execution.job.agentId,
          agentName: "Remediation worker",
          roleId: "fix-readiness-emitter",
          roleName: "Fix readiness emitter",
          executorKind: "codex",
          status: "succeeded",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          detail: `${changedFilesAfterEdit.length} changed file(s).`,
        }));
        if (changedFilesAfterEdit.length === 0) {
          stopReason = "no-further-safe-fixes";
          break;
        }
        const outputRecord = fs.existsSync(outputPath)
          ? JSON.parse(fs.readFileSync(outputPath, "utf8")) as Record<string, unknown>
          : {};
        commandsRun = [
          ...commandsRun,
          ...(Array.isArray(outputRecord.commandsRun)
            ? outputRecord.commandsRun.filter(item => typeof item === "string") as string[]
            : []),
        ];

        await appendExecutionStepLog(jobId, logs, buildExecutionStep({
          id: validationStepId,
          order: iteration * 2,
          title: `Validation pass ${iteration}`,
          stepType: "stage",
          agentId: execution.job.agentId,
          agentName: "Remediation worker",
          status: "running",
          startedAt: new Date().toISOString(),
        }));
        const validation = await runValidationCommands(repoPath, validationCommands);
        lastValidationOutput = validation.entries.map(entry =>
          [`$ ${entry.command}`, entry.output || `(exit ${entry.exitCode})`].join("\n"),
        ).join("\n\n");
        fs.writeFileSync(validationLogPath, `${lastValidationOutput}\n`, "utf8");
        validationPassed = validation.passed;
        await appendExecutionStepLog(jobId, logs, buildExecutionStep({
          id: validationStepId,
          order: iteration * 2,
          title: `Validation pass ${iteration}`,
          stepType: "stage",
          agentId: execution.job.agentId,
          agentName: "Remediation worker",
          status: validationPassed ? "succeeded" : "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          detail: validationPassed ? "Validation passed." : "Validation reported failures.",
        }));
        if (validationPassed) {
          stopReason = "no-further-safe-fixes";
          break;
        }
        stopReason = iteration >= remediation.maxIterations ? "iteration-budget-exhausted" : "validation-failed";
      }
    }

    const changedFiles = (await runGit(["status", "--short"], repoPath))
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[A-Z?]+\s+/, ""));
    const patchBundlePath = path.join(exportDir, "patch-bundle.diff");
    const gitBundlePath = path.join(exportDir, "changeset.bundle");
    const manifestPath = path.join(exportDir, "changeset-manifest.json");
    const prSummaryPath = path.join(exportDir, "PR_SUMMARY.md");
    const diffText = await runGit(["diff", "--binary"], repoPath);
    fs.writeFileSync(patchBundlePath, diffText, "utf8");
    if (changedFiles.length > 0) {
      await runGit(["bundle", "create", gitBundlePath, "HEAD"], repoPath);
    }

    const publishResult = await maybePublishGithubPullRequest({
      repoPath,
      branchName,
      baseRef,
      publishRemote: remediation.publishRemote,
      outputMode: remediation.outputMode,
      summaryBody: `SpecLens remediation changeset for report ${report.id}.`,
    });
    if (publishResult.stopReason) {
      stopReason = publishResult.stopReason;
    }

    const fixedFindingIds = validationPassed && changedFiles.length > 0 ? selectedFindings.map(finding => finding.id) : [];
    const residualFindingIds = fixedFindingIds.length === selectedFindings.length ? [] : selectedFindings.map(finding => finding.id);
    const pullInstructions = [
      `git fetch <remote> ${branchName}`,
      `git checkout ${branchName}`,
      `git am patch-bundle.diff`,
    ];
    const changeset = createChangesetSummary({
      branchName: changedFiles.length > 0 ? branchName : null,
      baseRef,
      changedFiles,
      commandsRun,
      validationCommands,
      validationPassed,
      iterationCount,
      stopReason,
      fixedFindingIds,
      residualFindingIds,
      pullInstructions,
      prUrl: publishResult.prUrl,
    });
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      jobId,
      reportId: report.id,
      sourceId: execution.source.id,
      createdAt: new Date().toISOString(),
      changeset,
    }, null, 2)}\n`, "utf8");
    fs.writeFileSync(prSummaryPath, [
      `# SpecLens Changeset ${jobId}`,
      "",
      `Report: \`${report.id}\``,
      `Base ref: \`${baseRef}\``,
      changedFiles.length > 0 ? `Branch: \`${branchName}\`` : "Branch: none created",
      "",
      "## Selected findings",
      ...selectedFindings.map(finding => `- \`${finding.id}\` (${finding.severity}): ${finding.title}`),
      "",
      "## Changed files",
      ...(changedFiles.length > 0 ? changedFiles.map(file => `- \`${file}\``) : ["- No file changes were produced."]),
      "",
      "## Validation",
      validationCommands.length > 0 ? validationCommands.map(command => `- \`${command}\``) : ["- No validation commands were detected."],
      "",
      `Stop reason: \`${stopReason}\``,
      ...(publishResult.prUrl ? ["", `PR: ${publishResult.prUrl}`] : []),
    ].join("\n"), "utf8");

    const artifactStepId = `${stepBase}-artifacts`;
    await appendExecutionStepLog(jobId, logs, buildExecutionStep({
      id: artifactStepId,
      order: 99,
      title: "Persist remediation artifacts",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Remediation worker",
      status: "running",
      startedAt: new Date().toISOString(),
    }));
    const artifactInputs = [
      { kind: "patch-bundle" as const, filePath: patchBundlePath, mimeType: "text/x-diff" },
      { kind: "git-bundle" as const, filePath: gitBundlePath, mimeType: "application/octet-stream" },
      { kind: "validation-log" as const, filePath: validationLogPath, mimeType: "text/plain" },
      { kind: "changeset-manifest" as const, filePath: manifestPath, mimeType: "application/json" },
      { kind: "pr-summary" as const, filePath: prSummaryPath, mimeType: "text/markdown" },
    ].filter(item => fs.existsSync(item.filePath));
    const artifacts = await Promise.all(artifactInputs.map(item =>
      putObjectFromFile(
        storageConfig(),
        `jobs/${jobId}/remediation/${path.basename(item.filePath)}`,
        item.filePath,
        item.mimeType,
        {
          kind: item.kind,
          jobId,
          reportId: report.id,
        },
      ),
    ));
    await appendExecutionStepLog(jobId, logs, buildExecutionStep({
      id: artifactStepId,
      order: 99,
      title: "Persist remediation artifacts",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Remediation worker",
      status: "succeeded",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      detail: `${artifacts.length} artifact(s) uploaded.`,
    }));

    await storeRemediationJobChangeset(jobId, changeset);
    if (execution.job.parentReportId) {
      await storeReportChangeset(execution.job.parentReportId, changeset, jobId);
    }

    const timing = {
      queueDurationMs: execution.job.startedAt && execution.job.createdAt
        ? Math.max(0, new Date(execution.job.startedAt).getTime() - new Date(execution.job.createdAt).getTime())
        : null,
      runDurationMs: Date.now() - jobStartedAt,
      totalDurationMs: Date.now() - new Date(execution.job.createdAt).getTime(),
      elapsedMs: Date.now() - new Date(execution.job.createdAt).getTime(),
      estimatedTotalMs: Date.now() - new Date(execution.job.createdAt).getTime(),
      estimatedRemainingMs: 0,
      confidence: "high" as const,
      basis: "Derived from queued remediation execution timing.",
    };

    return await finalizeAnalysisJobSuccess(jobId, {
      job: {
        ...execution.job,
        status: "succeeded",
        queueMessageId,
        changeset,
        finishedAt: new Date().toISOString(),
      },
      logs: [],
      report: null,
      artifacts,
      timing,
      qualityScorecard: null,
      capabilityGaps: [],
      artifactAnalysis: null,
      executionSteps: collectAnalysisExecutionSteps(logs),
    }, artifacts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remediation worker failed.";
    await appendLog(jobId, logs, "remediation", message, "error", requestId);
    return await finalizeAnalysisJobFailure(jobId, {
      failureReason: message,
      logs,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function handleAgentJob(payload: { jobId: string }, queueMessageId: string): Promise<void> {
  const config = loadAiWorkerConfig();
  const execution = await claimAgentJob(payload.jobId, config.workerId, queueMessageId);
  if (!execution) {
    return;
  }
  const jobKind = execution.job.jobKind;
  const finishMetrics = beginAiWorkerJob(jobKind);
  try {
    const result = execution.job.jobKind === "remediation"
      ? await runRemediationJob(execution, queueMessageId)
      : await runAgentJob(execution, queueMessageId);
    const status = result.job.status === "succeeded" || result.job.status === "failed" || result.job.status === "cancelled"
      ? result.job.status
      : "unknown";
    finishMetrics(status);
  } catch (error) {
    finishMetrics("unknown");
    throw error;
  }
}

export async function runAgentJobForTest(jobId: string): Promise<JobEnvelope> {
  const execution = await claimAgentJob(jobId, "test-ai-worker", "test-message");
  if (!execution) {
    throw new Error(`Agent job ${jobId} could not be claimed for testing.`);
  }
  return execution.job.jobKind === "remediation"
    ? runRemediationJob(execution, "test-message")
    : runAgentJob(execution, "test-message");
}

export function detectPlaywrightPreflightForTest(repoPath: string): PlaywrightPreflightPlan | null {
  return detectPlaywrightPreflight(repoPath);
}

export async function startAgentLoop(): Promise<void> {
  const config = loadAiWorkerConfig();
  console.log(JSON.stringify({
    event: "ai-worker.start",
    workerId: config.workerId,
    maxConcurrency: config.maxConcurrency,
  }));

  fs.mkdirSync(config.tempRoot, { recursive: true });
  await initializeDatabase();

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "/";
      if (url.startsWith("/metrics")) {
        response.writeHead(200, { "content-type": getMetricsContentType() });
        response.end(await getMetricsSnapshot());
        return;
      }
      if (url.startsWith("/ready")) {
        try {
          await checkDatabaseHealth();
          await checkQueueHealth();
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        } catch (error) {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Readiness check failed.",
          }));
        }
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, role: "ai-worker", workerId: config.workerId }));
    })();
  });

  server.listen(config.healthPort, "0.0.0.0", () => {
    console.log(`[ai-worker] health endpoint listening on http://0.0.0.0:${config.healthPort}`);
  });

  await workAgentJobs(handleAgentJob);
}

export async function startEmbeddedAgentWorker(): Promise<void> {
  if (embeddedWorkerStarted) {
    return;
  }
  embeddedWorkerStarted = true;
  await initializeDatabase();
  await workAgentJobs(handleAgentJob);
}

export function stopEmbeddedAgentWorker(): void {
  embeddedWorkerStarted = false;
}

export default {
  detectPlaywrightPreflightForTest,
  runAgentJobForTest,
  startAgentLoop,
  startEmbeddedAgentWorker,
  stopEmbeddedAgentWorker,
};
