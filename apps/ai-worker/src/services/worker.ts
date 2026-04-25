import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
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
  checkObjectStorageHealth,
  checkQueueHealth,
  claimAgentJob,
  downloadObjectToFile,
  finalizeAnalysisJobFailure,
  finalizeAnalysisJobSuccess,
  getAiAgentExecutionPlan,
  getCodexTokensForBinding,
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
  storeCodexTokensForBinding,
  workAgentJobs,
  type JobExecutionRecord,
  type ObjectStorageConfig,
} from "@speclens/db";
import {
  analysisLogEventSchema,
  analysisExecutionStepSchema,
  analysisReportSchema,
  agentSandboxRequestSchema,
  agentSandboxResultSchema,
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
  type AgentSandboxExecutionSnapshot,
  type AgentSandboxResult,
  type AiAgentExecutionPlan,
  standardizedAgentBlockerSchema,
  standardizedAgentHandoffSchema,
  type AnalysisExecutionStep,
  type ArtifactReference,
  type Learnable,
  type AiToolCapability,
  type AnalysisLogEvent,
  type AnalysisReport,
  type ChangesetSummary,
  type EvidenceReference,
  type JobExecutionMetadata,
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

type ExecutionRuntimeContext = {
  appendLogs?: (jobId: string, logs: AnalysisLogEvent[]) => Promise<void>;
  emitLog?: (log: AnalysisLogEvent) => void;
  isCancellationRequested?: (jobId: string) => Promise<boolean>;
  syncCodexAuth?: (authPath: string | null, execution: JobExecutionRecord) => Promise<void>;
};

type AgentExecutionContext = {
  execution: JobExecutionRecord;
  snapshot: AgentSandboxExecutionSnapshot;
};

type HostedAuditCoreResult = {
  envelope: JobEnvelope;
  learnables: LearnableSeed[];
};

type HostedRemediationCoreResult = {
  envelope: JobEnvelope;
};

class AgentExecutionCancelledError extends Error {
  constructor(message = "Job cancelled during agent execution.") {
    super(message);
    this.name = "AgentExecutionCancelledError";
  }
}

const executionRuntimeStorage = new AsyncLocalStorage<ExecutionRuntimeContext>();

type PlaywrightPreflightPlan = {
  label: string;
  command: string;
  workingDirectory: string;
  source: "package-script" | "config";
  packageManager: PackageManager;
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
  | "deterministic-artifact-expectations"
  | "deterministic-remediation-planning"
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

type RoleOutputContract = {
  expectedSectionTitle: string;
  acceptedSectionTitles?: string[];
  purpose: string;
  requiredDataKeys: string[];
  recommendedDataKeys: string[];
};

type RoleContractEvaluation = {
  roleId: string;
  title: string;
  expectedSectionTitle: string;
  status: "ready" | "planned" | "skipped" | "missing";
  sectionTitles: string[];
  missingSection: boolean;
  missingDataKeys: string[];
  recommendedDataKeys: string[];
  summary: string;
};

const MAX_BROWSER_QA_PAGES = 8;
const MAX_BROWSER_QA_INTERACTIONS = 4;
const PLAYWRIGHT_CONFIG_FILE_NAMES = [
  "playwright.config.ts",
  "playwright.config.mts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
];
const KNOWN_PLAYWRIGHT_ARTIFACT_NAMES = ["playwright-report", "test-results"];
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
  "e2e-remediation-planner": "ops",
  "fix-readiness-emitter": "ops",
  "release-gate-scorer": "ops",
  "standardized-json-output": "ops",
  "smoke-summary": "ops",
};

const roleOutputContracts: Record<string, RoleOutputContract> = {
  "source-topology-scout": {
    expectedSectionTitle: "Source topology",
    acceptedSectionTitles: ["Repository inventory"],
    purpose: "Classify repository shape, product surfaces, package boundaries, and evidence-backed ownership hints.",
    requiredDataKeys: [],
    recommendedDataKeys: ["apps", "packages", "languages", "manifests", "surfaces", "services"],
  },
  "runtime-scout": {
    expectedSectionTitle: "Runtime scout",
    purpose: "Derive the exact install, build, start, verification, target, port, and environment contract.",
    requiredDataKeys: ["packageManagers", "workingDirectories", "targets"],
    recommendedDataKeys: ["installCommands", "buildCommands", "startCommands", "verificationCommands", "envFiles", "ports", "baseUrls", "serviceDependencies"],
  },
  "auth-cartographer": {
    expectedSectionTitle: "Auth map",
    purpose: "Map frontend and API auth strategies, routes, protected surfaces, bootstrap steps, and required secret references.",
    requiredDataKeys: ["frontend", "api"],
    recommendedDataKeys: ["frontend.loginRoutes", "frontend.protectedRoutes", "frontend.secretRefs", "api.protectedRoutes", "api.secretRefs", "bootstrapSteps"],
  },
  "live-surface-resolver": {
    expectedSectionTitle: "Live surface resolution",
    purpose: "Resolve only trusted live or companion URLs and explain blockers when no live surface is evidence-backed.",
    requiredDataKeys: [],
    recommendedDataKeys: ["trustedUrls", "liveSurfaces", "blockedUrls", "blockers", "evidence"],
  },
  "license-governor": {
    expectedSectionTitle: "License review",
    acceptedSectionTitles: ["License policy"],
    purpose: "Review license files, package notices, legal copy, and dual-license consistency.",
    requiredDataKeys: [],
    recommendedDataKeys: ["licenses", "notices", "policyFindings", "legalCopyPaths"],
  },
  "dependency-risk-reviewer": {
    expectedSectionTitle: "Dependency risk review",
    purpose: "Assess dependency posture, lockfiles, install drift, risky packages, and supply-chain gaps.",
    requiredDataKeys: [],
    recommendedDataKeys: ["packageManagers", "lockfiles", "riskSignals", "verificationCommands"],
  },
  "architecture-reviewer": {
    expectedSectionTitle: "Architecture review",
    purpose: "Assess boundaries, ownership, layering, coupling, dead modules, and rule/spec alignment.",
    requiredDataKeys: [],
    recommendedDataKeys: ["subsystems", "boundaries", "couplingRisks", "adrRefs"],
  },
  "code-health-reviewer": {
    expectedSectionTitle: "Code health review",
    purpose: "Assess correctness, validation, typing, observability, error handling, and meaningful test gaps.",
    requiredDataKeys: [],
    recommendedDataKeys: ["correctnessRisks", "validationGaps", "testGaps", "observabilityGaps"],
  },
  "component-cartographer": {
    expectedSectionTitle: "Component inventory",
    purpose: "Inventory significant UI components, shared primitives, duplication, and ownership drift.",
    requiredDataKeys: [],
    recommendedDataKeys: ["components", "duplicateNames", "sharedPrimitiveGaps", "ownershipNotes"],
  },
  "design-system-auditor": {
    expectedSectionTitle: "Design system review",
    purpose: "Assess tokens, spacing, typography, visual patterns, and reusable state coverage.",
    requiredDataKeys: [],
    recommendedDataKeys: ["tokens", "spacing", "typography", "stateCoverage", "consistencyIssues"],
  },
  "copy-consistency-auditor": {
    expectedSectionTitle: "Copy consistency review",
    acceptedSectionTitles: ["UI label scan"],
    purpose: "Assess terminology, CTAs, labels, legal/pricing wording, and missing user-facing text.",
    requiredDataKeys: [],
    recommendedDataKeys: ["inconsistentTerms", "missingTextSurfaces", "unclearCtas", "legalPricingDrift"],
  },
  "accessibility-auditor": {
    expectedSectionTitle: "Accessibility review",
    purpose: "Assess landmarks, headings, forms, names, semantics, and structural accessibility evidence.",
    requiredDataKeys: [],
    recommendedDataKeys: ["landmarks", "headingIssues", "formIssues", "semanticIssues"],
  },
  "navigation-qa-planner": {
    expectedSectionTitle: "Navigation QA plan",
    purpose: "Map route inventory, auth boundaries, high-risk journeys, browser assertions, and detected surfaces.",
    requiredDataKeys: ["navigationTargets", "journeys", "assertions"],
    recommendedDataKeys: ["detectedSurfaces", "artifactExpectations", "coverageGaps"],
  },
  "browser-executor": {
    expectedSectionTitle: "Browser QA execution",
    acceptedSectionTitles: ["Browser self-check", "Interaction testing"],
    purpose: "Prepare and execute direct browser QA targets, interaction heuristics, and required visible artifacts.",
    requiredDataKeys: [],
    recommendedDataKeys: ["targets", "journeys", "assertions", "artifacts", "failureHeuristics"],
  },
  "playwright-operator": {
    expectedSectionTitle: "Playwright operator plan",
    acceptedSectionTitles: ["Playwright preflight", "Playwright suite execution"],
    purpose: "Resolve repository-native Playwright readiness, commands, auth strategy, targets, and artifacts.",
    requiredDataKeys: [],
    recommendedDataKeys: ["packageManager", "configPaths", "commands", "setupCommands", "baseUrlStrategy", "authStrategy", "testTargets", "artifacts", "coverageGaps"],
  },
  "visual-qa-critic": {
    expectedSectionTitle: "Visual QA review",
    acceptedSectionTitles: ["Visual inspection"],
    purpose: "Assess concrete layout, overlap, clipping, hierarchy, density, and readability issues.",
    requiredDataKeys: [],
    recommendedDataKeys: ["reviewedSurfaces", "overlapRisks", "hierarchyIssues", "readabilityIssues"],
  },
  "ux-friction-reviewer": {
    expectedSectionTitle: "UX friction review",
    purpose: "Assess empty states, loading states, error states, action clarity, and IA friction.",
    requiredDataKeys: [],
    recommendedDataKeys: ["journeys", "emptyStateIssues", "loadingStateIssues", "errorStateIssues", "informationArchitectureIssues"],
  },
  "cross-surface-consistency-reviewer": {
    expectedSectionTitle: "Cross-surface consistency",
    purpose: "Compare repository, docs, legal, pricing, auth, admin, and browser surfaces for drift.",
    requiredDataKeys: [],
    recommendedDataKeys: ["surfacesCompared", "mismatches", "documentationGaps", "evidence"],
  },
  "artifact-auditor": {
    expectedSectionTitle: "Artifact expectations",
    purpose: "Define expected report, screenshot, trace, storage, route-map, and remediation artifacts.",
    requiredDataKeys: ["artifactExpectations"],
    recommendedDataKeys: ["expectedKinds", "requiredArtifacts", "sourcePaths"],
  },
  "remediation-planner": {
    expectedSectionTitle: "Remediation planning",
    purpose: "Group findings into ordered, implementation-ready packs with actions and validation expectations.",
    requiredDataKeys: [],
    recommendedDataKeys: ["remediationPacks", "actions", "validationCommands", "dependencies"],
  },
  "e2e-remediation-planner": {
    expectedSectionTitle: "Remediation planning",
    purpose: "Synthesize stable remediation packs for local E2E coverage.",
    requiredDataKeys: [],
    recommendedDataKeys: ["remediationPacks", "actions", "validationCommands", "dependencies"],
  },
  "fix-readiness-emitter": {
    expectedSectionTitle: "Fix readiness handoff",
    purpose: "Prepare downstream implementation handoff entries, target files, tests, and rollback notes.",
    requiredDataKeys: [],
    recommendedDataKeys: ["fixHandoff", "targetFiles", "validationCommands", "rollbackNotes"],
  },
  "release-gate-scorer": {
    expectedSectionTitle: "Release gate recommendation",
    purpose: "Emit pass, warn, or fail recommendation with confidence, blockers, and rationale.",
    requiredDataKeys: ["releaseGateDecision"],
    recommendedDataKeys: ["blockingFindingIds", "confidence", "rationale"],
  },
  "standardized-json-output": {
    expectedSectionTitle: "Standardized JSON handoff",
    purpose: "Emit the canonical machine-readable universal audit handoff.",
    requiredDataKeys: ["standardizedOutput"],
    recommendedDataKeys: ["standardizedOutput.runtime", "standardizedOutput.auth", "standardizedOutput.playwright", "standardizedOutput.artifactExpectations", "standardizedOutput.remediationPacks", "standardizedOutput.releaseGateDecision"],
  },
  "smoke-summary": {
    expectedSectionTitle: "Smoke analysis",
    purpose: "Produce a concise, high-signal intake summary and the most obvious release risk.",
    requiredDataKeys: [],
    recommendedDataKeys: ["stackHints", "topRisks", "nextSteps"],
  },
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
    case "pending":
      return `${agent} -> ${owner} pending via ${executor}.${detail}`;
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
    "Role output contract:",
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

function flushChunkLinesUntruncated(
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
    emit(line);
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

async function withExecutionRuntime<T>(
  runtime: ExecutionRuntimeContext,
  handler: () => Promise<T>,
): Promise<T> {
  return await executionRuntimeStorage.run(runtime, handler);
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
  const runtime = executionRuntimeStorage.getStore();
  runtime?.emitLog?.(log);
  try {
    if (runtime?.appendLogs) {
      await runtime.appendLogs(jobId, [log]);
    } else {
      await appendAnalysisJobLogs(jobId, [log]);
    }
  } catch (error) {
    console.warn("[ai-worker] Failed to append log:", error);
  }
}

async function executionCancellationRequested(jobId: string): Promise<boolean> {
  const runtime = executionRuntimeStorage.getStore();
  if (runtime?.isCancellationRequested) {
    return await runtime.isCancellationRequested(jobId);
  }
  return await isCancellationRequested(jobId);
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

function getRoleOutputContract(roleId: string): RoleOutputContract | null {
  return roleOutputContracts[roleId] ?? null;
}

function normalizeContractLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function findRoleContractSection(
  sections: RoleOutput["sections"] | AnalysisReport["sections"],
  contract: RoleOutputContract,
): (RoleOutput["sections"][number] | AnalysisReport["sections"][number]) | null {
  const acceptedTitles = [contract.expectedSectionTitle, ...(contract.acceptedSectionTitles ?? [])]
    .map(normalizeContractLabel);
  const matches = sections.filter(section => acceptedTitles.includes(normalizeContractLabel(section.title)));
  return matches.find(section => section.status === "ready")
    ?? matches[0]
    ?? null;
}

function getNestedDataValue(data: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, data);
}

function hasMeaningfulContractValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return false;
}

function evaluateRoleContract(
  role: Pick<RoleDefinition, "id" | "title">,
  sections: AnalysisReport["sections"],
): RoleContractEvaluation {
  const contract = getRoleOutputContract(role.id) ?? {
    expectedSectionTitle: role.title,
    purpose: role.title,
    requiredDataKeys: [],
    recommendedDataKeys: [],
  };
  const roleSections = sections.filter(section => section.roleId === role.id);
  const contractSection = findRoleContractSection(roleSections, contract) as AnalysisReport["sections"][number] | null;
  const missingDataKeys = contractSection
    ? contract.requiredDataKeys.filter(key => !hasMeaningfulContractValue(getNestedDataValue(contractSection.data, key)))
    : contract.requiredDataKeys;
  const status: RoleContractEvaluation["status"] = contractSection
    ? contractSection.status === "ready" && missingDataKeys.length === 0
      ? "ready"
      : contractSection.status === "skipped"
        ? "skipped"
        : "planned"
    : roleSections.length > 0
      ? roleSections.some(section => section.status === "skipped")
        ? "skipped"
        : "planned"
      : "missing";
  const summary = contractSection
    ? missingDataKeys.length > 0
      ? `${contract.expectedSectionTitle} was present but missed required data: ${missingDataKeys.join(", ")}.`
      : `${contract.expectedSectionTitle} satisfied the role output contract.`
    : roleSections.length > 0
      ? `${role.title} produced sections, but none matched ${contract.expectedSectionTitle}.`
      : `${role.title} did not produce a role-backed report section.`;
  return {
    roleId: role.id,
    title: role.title,
    expectedSectionTitle: contract.expectedSectionTitle,
    status,
    sectionTitles: roleSections.map(section => section.title),
    missingSection: !contractSection,
    missingDataKeys,
    recommendedDataKeys: contract.recommendedDataKeys,
    summary,
  };
}

function evaluateRoleContracts(
  roles: RoleDefinition[],
  sections: AnalysisReport["sections"],
): RoleContractEvaluation[] {
  return roles.map(role => evaluateRoleContract(role, sections));
}

function formatRoleOutputContractForPrompt(roleId: string): string {
  const contract = getRoleOutputContract(roleId);
  if (!contract) {
    return [
      "- Emit at least one ready section that clearly matches this role's purpose.",
      "- Put structured details in each section's data object.",
      "- Findings must include concrete evidence when reporting a defect or blocker.",
    ].join("\n");
  }

  return [
    `- Required section title: ${contract.expectedSectionTitle}`,
    contract.acceptedSectionTitles?.length
      ? `- Accepted equivalent section titles: ${contract.acceptedSectionTitles.join(", ")}`
      : null,
    `- Contract purpose: ${contract.purpose}`,
    contract.requiredDataKeys.length > 0
      ? `- Required data keys in that section: ${contract.requiredDataKeys.join(", ")}`
      : "- Required data keys in that section: none beyond evidence-backed structured data",
    contract.recommendedDataKeys.length > 0
      ? `- Recommended data keys: ${contract.recommendedDataKeys.join(", ")}`
      : null,
    "- If evidence is insufficient, still emit the required section with status \"planned\" and explain the blocker in summary/data.",
    "- Put defects, blockers, or unresolved risks in findings with severity, message, suggestion, and evidence.",
  ].filter(Boolean).join("\n");
}

function applyRoleOutputContract(roleId: string, output: RoleOutput): RoleOutput {
  const contract = getRoleOutputContract(roleId);
  if (!contract || output.sections.length !== 1 || findRoleContractSection(output.sections, contract)) {
    return output;
  }
  const [section] = output.sections;
  if (!section) {
    return output;
  }
  return roleOutputSchema.parse({
    ...output,
    sections: [{
      ...section,
      title: contract.expectedSectionTitle,
      data: {
        ...section.data,
        roleContract: {
          canonicalizedFromTitle: section.title,
          expectedSectionTitle: contract.expectedSectionTitle,
        },
      },
    }],
  });
}

function writeAgentFailureDiagnostics(options: {
  jobId: string;
  tempDir: string;
  status: "failed" | "cancelled";
  failureReason: string;
  logs: AnalysisLogEvent[];
}): ArtifactReference[] {
  const diagnosticPath = path.join(options.tempDir, "agent-failure.json");
  const payload = {
    schemaVersion: "speclens.agent-failure.v1",
    jobId: options.jobId,
    status: options.status,
    failureReason: options.failureReason,
    generatedAt: new Date().toISOString(),
    executionSteps: collectAnalysisExecutionSteps(options.logs),
    logs: options.logs.map(log => ({
      id: log.id,
      level: log.level,
      scope: log.scope,
      message: log.message,
      visibility: log.visibility,
      requestId: log.requestId ?? null,
      createdAt: log.createdAt,
    })),
  };
  fs.writeFileSync(diagnosticPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return [createLocalArtifactReference(options.tempDir, diagnosticPath, "runtime-log", "application/json")];
}

async function uploadLocalArtifactsToObjectStorage(
  options: {
    jobId: string;
    reportId?: string | null;
    baseDir: string;
    artifacts: ArtifactReference[];
    keyPrefix: string;
  },
): Promise<ArtifactReference[]> {
  const uploaded: ArtifactReference[] = [];
  for (const artifact of options.artifacts) {
    const absolutePath = path.resolve(options.baseDir, artifact.key);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    uploaded.push(await putObjectFromFile(
      storageConfig(),
      `${options.keyPrefix}/${path.basename(artifact.key)}`,
      absolutePath,
      artifact.mimeType,
      {
        kind: artifact.kind ?? "artifact",
        jobId: options.jobId,
        reportId: options.reportId ?? null,
      },
    ));
  }
  return uploaded;
}

async function finalizeAgentJobFailure(options: {
  jobId: string;
  tempDir: string;
  status?: "failed" | "cancelled";
  failureReason: string;
  logs: AnalysisLogEvent[];
  artifacts?: ArtifactReference[];
}): Promise<JobEnvelope> {
  const status = options.status ?? "failed";
  const localArtifacts = options.artifacts ?? [];
  let persistedArtifacts: ArtifactReference[] = [];
  try {
    await appendLog(
      options.jobId,
      options.logs,
      "artifact",
      `Persisting agent ${status} diagnostics for post-run review.`,
      status === "failed" ? "error" : "warn",
    );
    const diagnostics = writeAgentFailureDiagnostics({
      jobId: options.jobId,
      tempDir: options.tempDir,
      status,
      failureReason: options.failureReason,
      logs: options.logs,
    });
    persistedArtifacts = await uploadLocalArtifactsToObjectStorage({
      jobId: options.jobId,
      reportId: null,
      baseDir: options.tempDir,
      artifacts: [...diagnostics, ...localArtifacts],
      keyPrefix: `jobs/${options.jobId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist agent diagnostics.";
    await appendLog(
      options.jobId,
      options.logs,
      "artifact",
      `Failed to persist agent diagnostics: ${message}`,
      "warn",
    );
  }
  return await finalizeAnalysisJobFailure(options.jobId, {
    status,
    failureReason: options.failureReason,
    logs: options.logs,
    ...(persistedArtifacts.length > 0 ? { artifacts: persistedArtifacts } : {}),
  });
}

async function runProcess(command: string, args: string[], options: {
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
} = {}): Promise<void> {
  const env = {
    ...(options.env ?? process.env),
    PATH: options.env?.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
  };
  const child = spawn(command, args, {
    cwd: options.cwd,
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
  const nextEnv = { ...(env ?? process.env) };
  delete nextEnv.GIT_DIR;
  delete nextEnv.GIT_WORK_TREE;
  delete nextEnv.GIT_INDEX_FILE;
  await runProcess("git", ["clone", "--depth=1", repoUrl, destination], {
    cwd: os.tmpdir(),
    env: nextEnv,
  });
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
  return "planned";
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

function normalizeRoleOutput(raw: unknown, roleId?: string): RoleOutput {
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
          category: normalizeFindingCategory(findingRecord.category, roleId),
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

function readRoleOutput(outputPath: string, roleId?: string): RoleOutput {
  if (!fs.existsSync(outputPath)) {
    throw new Error("Codex did not emit an output file.");
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  return normalizeRoleOutput(parseJsonFromOutput(raw), roleId);
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
  const roleOutputContractBlock = formatRoleOutputContractForPrompt(options.roleId);
  const roleGuardrails = formatRoleExecutionGuardrailsForPrompt(options.roleId);

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
    "Role output contract:",
    roleOutputContractBlock,
    roleGuardrails ? ["Role-specific execution guardrails:", roleGuardrails].join("\n") : null,
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

function formatRoleExecutionGuardrailsForPrompt(roleId: string): string | null {
  if (roleId === "runtime-scout") {
    return [
      "- Hosted agent jobs intentionally run inside a one-shot sandbox without host Docker socket access.",
      "- Do not create a finding solely because Docker Compose, host Docker, or controller-side DinD preflight is unavailable inside the job sandbox.",
      "- Prefer direct repo install/start/health evidence, browser executor evidence, Playwright preflight evidence, and controller sandbox evidence for hosted runtime confidence.",
      "- Record Compose/DinD absence as a scoped limitation only when it blocks the direct hosted runtime evidence path.",
    ].join("\n");
  }
  if (roleId === "auth-cartographer") {
    return [
      "- Uploaded job snapshots normally exclude concrete `.env` files; do not create a finding solely because `.env` is absent.",
      "- Treat missing auth secrets as a finding only when required env names are undocumented, public recovery fails open, secrets are mishandled, or a configured deployment path breaks.",
      "- When auth material is absent but routes fail closed with explicit recovery, describe it as an execution limitation rather than a product defect.",
    ].join("\n");
  }
  if (roleId === "playwright-operator") {
    return [
      "- Do not run `npx playwright`, `playwright test`, or equivalent direct probes before dependencies are installed.",
      "- Prefer repository package scripts over transient tool downloads.",
      "- If execution is needed, run the locked install command first (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, etc.).",
      "- Treat worker-added `Playwright preflight` evidence as stronger than earlier exploratory command failures.",
      "- Uploaded job snapshots normally exclude concrete `.env` files; do not duplicate generic missing-env findings when the worker already records authenticated coverage as a scoped limitation.",
    ].join("\n");
  }
  if (roleId === "release-gate-scorer") {
    return [
      "- Use artifact-auditor handoff fields (`generatedArtifacts`, `sourcePaths`, `presentGeneratedKinds`, `missingGeneratedKinds`) as canonical evidence for already-executed sandbox artifacts.",
      "- Do not inspect project-root `.speclens-workspace`, `test-results`, or `playwright-report` paths as proof of hosted artifact absence.",
      "- Hosted browser/runtime artifacts are written under the job output root and mirrored by the controller after sandbox completion.",
      "- Fail on artifact evidence only when artifact-auditor reports missing required generated kinds or when prior execution evidence explicitly contradicts artifact-auditor output.",
      "- Missing concrete `.env` in an uploaded snapshot should lower authenticated-browser confidence at most once; do not escalate it to a release blocker when public recovery fails closed and unauthenticated/browser/Playwright evidence succeeded.",
    ].join("\n");
  }
  if (roleId === "navigation-qa-planner") {
    return [
      "- Keep `navigationTargets`, `journeys`, and `assertions` bounded to the highest-risk entries; do not dump the full route map.",
      "- Use concise strings and small objects only. Avoid prose paragraphs inside arrays.",
      "- If a target has similar variants, group it once and describe the variant in the assertion text.",
      "- Preferred limits: at most 12 navigation targets, 8 journeys, and 12 assertions.",
      "- Uploaded job snapshots normally exclude concrete `.env` files; keep auth-gated journey gaps scoped and avoid duplicating generic missing-env findings from auth/runtime roles.",
    ].join("\n");
  }
  if (roleId === "ux-friction-reviewer" || roleId === "cross-surface-consistency-reviewer") {
    return [
      "- Uploaded job snapshots normally exclude concrete `.env` files; do not create repeated generic missing-env findings.",
      "- If authenticated browser paths cannot run, report the specific user-facing UX risk or state that the limitation is already covered by execution evidence.",
      "- Prefer concrete route copy, recovery, empty-state, and artifact-backed findings over broad environment caveats.",
    ].join("\n");
  }
  if (roleId === "remediation-planner" || roleId === "e2e-remediation-planner") {
    return [
      "- Emit implementation-ready remediation packs, not a long narrative report.",
      "- Preferred limits: at most 5 packs, 5 actions per pack, and 4 validation commands total.",
      "- Do not include patch hunks, markdown tables, or raw artifact payloads inside JSON fields.",
      "- Treat stale validation blockers as non-blocking if later sandbox evidence contradicts them.",
      "- Treat repeated missing-env/authenticated-coverage findings as one scoped remediation dependency, not one pack per role.",
    ].join("\n");
  }
  return null;
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

function buildDeterministicRemediationPlannerOutput(options: {
  priorOutputs: PriorRoleOutput[];
}): RoleOutput {
  const syntheticFindings = collectSyntheticFindings(options.priorOutputs);
  const remediationPacks = buildRemediationPacks(syntheticFindings);
  const prioritizedFindings = syntheticFindings
    .filter(finding => finding.severity === "high" || finding.severity === "medium")
    .slice(0, 8)
    .map(finding => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      category: finding.category,
    }));
  const summary = remediationPacks.length > 0
    ? `${remediationPacks.length} remediation pack(s) were synthesized deterministically from ${syntheticFindings.length} collected finding(s).`
    : syntheticFindings.length > 0
      ? `No remediation packs were synthesized from ${syntheticFindings.length} collected finding(s).`
      : "No remediation planning was needed because the prior roles produced no findings.";

  return roleOutputSchema.parse({
    summary,
    sections: [{
      title: "Remediation planning",
      status: "ready",
      summary,
      data: {
        remediationPacks,
        prioritizedFindings,
        findingCount: syntheticFindings.length,
      },
    }],
    findings: [],
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
  const requiredKinds = [...new Set((handoff?.artifactExpectations ?? [])
    .filter(expectation => expectation.required !== false)
    .map(expectation => expectation.kind))];
  const missingKinds = requiredKinds.filter(kind => !presentKinds.includes(kind));
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

function reportExecutionAttemptSucceeded(report: AnalysisReport, attemptId: string): boolean {
  return report.summary.executionCoverage.attempted.some(attempt =>
    attempt.id === attemptId && attempt.status === "succeeded");
}

function reportBrowserQaAuthenticated(report: AnalysisReport): boolean {
  return report.sections.some(section =>
    section.title === "Browser QA execution"
    && section.status === "ready"
    && section.data.authenticated === true);
}

function hasGeneratedBrowserArtifactEvidence(artifactAnalysis: z.infer<typeof artifactAnalysisSchema>): boolean {
  const browserArtifactKinds = new Set([
    "playwright-report",
    "screenshot",
    "storage-state",
    "test-results",
    "trace",
  ]);
  if (artifactAnalysis.presentKinds.some(kind => browserArtifactKinds.has(kind))) {
    return true;
  }
  return artifactAnalysis.notableArtifacts.some(artifact =>
    browserArtifactKinds.has(artifact.kind)
    || artifact.key.includes("/generated/browser/")
    || artifact.key.includes("/playwright-report/")
    || artifact.key.includes("/test-results/"));
}

function isSupersededBrowserCoverageGap(
  gapSummary: string,
  report: AnalysisReport,
  artifactAnalysis: z.infer<typeof artifactAnalysisSchema>,
): boolean {
  const normalized = gapSummary.toLowerCase();
  const repositoryPlaywrightSucceeded = reportExecutionAttemptSucceeded(report, "repo-playwright");
  const browserQaSucceeded = reportExecutionAttemptSucceeded(report, "browser-qa");
  const browserQaAuthenticated = reportBrowserQaAuthenticated(report);
  const browserArtifactEvidence = hasGeneratedBrowserArtifactEvidence(artifactAnalysis);

  if (normalized.includes("auth") || normalized.includes("protected route") || normalized.includes("portal")) {
    return browserQaAuthenticated;
  }

  if (
    repositoryPlaywrightSucceeded
    && (
      normalized.includes("no playwright execution")
      || normalized.includes("no playwright suite executed")
      || normalized.includes("no repository-native playwright")
      || normalized.includes("no `npm run e2e")
      || normalized.includes("playwright execution was performed")
      || normalized.includes("based on repo contracts and existing artifacts only")
      || (browserArtifactEvidence && normalized.includes("no newly generated browser artifacts"))
    )
  ) {
    return true;
  }

  if (
    browserQaSucceeded
    && (
      normalized.includes("no browser execution")
      || normalized.includes("no browser automation")
      || normalized.includes("browser execution evidence")
      || normalized.includes("based on repo contracts and existing artifacts only")
      || (browserArtifactEvidence && normalized.includes("no newly generated browser artifacts"))
    )
  ) {
    return true;
  }

  return false;
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
    if (isSupersededBrowserCoverageGap(gap, report, artifactAnalysis)) {
      continue;
    }
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

  const repositoryPlaywrightSucceeded = report.summary.executionCoverage.attempted.some(attempt =>
    attempt.id === "repo-playwright" && attempt.status === "succeeded");

  if (playwright && playwright.detected && !playwright.runnable && !repositoryPlaywrightSucceeded) {
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

  if (playwright && playwright.runnable && !playwright.passed && !repositoryPlaywrightSucceeded) {
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
  const pathLinkedFindings = findings.filter(finding => finding.paths.length > 0).length;
  const evidenceRefFindings = findings.filter(finding => finding.evidenceRefs.length > 0).length;
  const traceabilityScore = findings.length === 0
    ? 100
    : clampPercent(((pathLinkedFindings + evidenceRefFindings) / (findings.length * 2)) * 100);
  const evidenceScore = findings.length === 0
    ? 100
    : clampPercent((((evidenceBackedFindings / findings.length) * 70) + (traceabilityScore * 0.3)));
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
    report.sections.some(section => section.title === "Role contract audit"),
    report.summary.releaseGateDecision !== null,
  ].filter(Boolean).length;
  const categoryCounts = buildCategoryCounts(findings);
  const dominantCategory = Object.entries(categoryCounts)
    .sort((left, right) => right[1] - left[1])[0] ?? null;
  const categoryCollapse = findings.length >= 8 && dominantCategory !== null && dominantCategory[1] / findings.length >= 0.8;
  const duplicateTitleGroups = Object.entries(findings.reduce<Record<string, number>>((accumulator, finding) => {
    const key = finding.title.trim().toLowerCase();
    if (key) {
      accumulator[key] = (accumulator[key] ?? 0) + 1;
    }
    return accumulator;
  }, {})).filter(([, count]) => count >= 3);
  const transparencyPenalty = (categoryCollapse ? 15 : 0) + (duplicateTitleGroups.length > 0 ? 12 : 0);
  const transparencyScore = clampPercent(((transparencySignals / 5) * 100) - transparencyPenalty);
  const capabilityPenalty = capabilityGaps.reduce((total, gap) => total + (gap.severity === "high" ? 35 : gap.severity === "medium" ? 18 : 8), 0);
  const capabilityScore = clampPercent(100 - capabilityPenalty);

  const dimensions = [
    {
      id: "evidence" as const,
      label: "Evidence quality",
      score: evidenceScore,
      rationale: findings.length === 0
        ? "No findings required evidence calibration for this run."
        : `${evidenceBackedFindings} of ${findings.length} finding(s) carried direct evidence; ${pathLinkedFindings} had file/path anchors and ${evidenceRefFindings} had structured evidence refs.`,
      evidence: findings.slice(0, 5).flatMap(finding => [
        ...finding.paths.slice(0, 1),
        ...finding.evidence.slice(0, 1),
      ]).slice(0, 8),
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
      rationale: categoryCollapse || duplicateTitleGroups.length > 0
        ? `${transparencySignals} of 5 transparency signals were present, with report-shape penalties for collapsed categories or duplicate generic findings.`
        : `${transparencySignals} of 5 transparency signals were present in the report.`,
      evidence: [
        ...sections.slice(0, 4).map(section => section.title),
        ...(categoryCollapse && dominantCategory ? [`${dominantCategory[1]} of ${findings.length} findings categorized as ${dominantCategory[0]}.`] : []),
        ...duplicateTitleGroups.slice(0, 2).map(([title, count]) => `${count} findings share title "${title}".`),
      ],
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
    const contractEvaluation = evaluateRoleContract(role, sections);
    const status = contractEvaluation.status;
    const highSeverityCount = findings.filter(finding => finding.roleId === role.id && finding.severity === "high").length;
    const score = clampPercent(
      status === "ready"
        ? 100 - (highSeverityCount * 25)
        : status === "planned"
          ? roleSections.length > 0
            ? 65
            : 55
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
      rationale: `${contractEvaluation.summary} ${roleSections.length} section(s) and ${findingCount} finding(s) were produced.`,
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
    ...(findings.length > 0 && pathLinkedFindings === 0 ? ["Report traceability gap: no findings include file or route path anchors."] : []),
    ...(findings.length > 0 && evidenceRefFindings === 0 ? ["Report evidence gap: no findings include structured evidence references."] : []),
    ...(categoryCollapse && dominantCategory ? [`Report categorization collapsed: ${dominantCategory[1]} of ${findings.length} findings are categorized as ${dominantCategory[0]}.`] : []),
    ...duplicateTitleGroups
      .slice(0, 3)
      .map(([title, count]) => `Report deduplication gap: ${count} findings share the generic title "${title}".`),
    ...evaluateRoleContracts(report.roles, sections)
      .filter(contract => contract.status !== "ready")
      .slice(0, 8)
      .map(contract => `Role contract gap: ${contract.title} - ${contract.summary}`),
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
  const roleContractEvaluations = evaluateRoleContracts(report.roles, sectionsWithFixHandoff);
  const readyRoleContracts = roleContractEvaluations.filter(contract => contract.status === "ready").length;
  const sectionsWithRoleContractAudit = upsertSummarySection(
    sectionsWithFixHandoff,
    "quality-review",
    "Role contract audit",
    `${readyRoleContracts} of ${roleContractEvaluations.length} role output contract(s) are ready.`,
    { roleContracts: roleContractEvaluations },
  );
  const reportWithSections = {
    ...reportWithCoverage,
    sections: sectionsWithRoleContractAudit,
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
    sectionsWithRoleContractAudit,
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
  streamLogs?: boolean;
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
      if (options.streamLogs && !shouldSuppressCodexLogLine(line)) {
        queueLine(options.onStdoutLine, line);
      }
    });
  });
  child.stderr?.on("data", chunk => {
    const value = String(chunk);
    stderrChunks.push(value);
    stderrRemainder = flushChunkLines(value, stderrRemainder, line => {
      if (options.streamLogs && !shouldSuppressCodexLogLine(line)) {
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
        if (options.streamLogs && stdoutRemainder.trim().length > 0 && !shouldSuppressCodexLogLine(stdoutRemainder.trim())) {
          queueLine(options.onStdoutLine, truncateLogMessage(stdoutRemainder.trim()));
        }
        if (options.streamLogs && stderrRemainder.trim().length > 0 && !shouldSuppressCodexLogLine(stderrRemainder.trim())) {
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

async function stageCodexAuth(tempDir: string, execution: JobExecutionRecord): Promise<string | null> {
  const tokens = await getCodexTokensForBinding(
    execution.metadata.codexAuth ?? {
      scope: "global",
      recordId: "codex:global",
    },
  );
  if (!tokens) {
    return null;
  }

  const authDir = path.join(tempDir, "codex");
  const authPath = path.join(authDir, "auth.json");
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(authPath, renderCodexAuthFile(tokens), { mode: 0o600 });
  return authPath;
}

async function syncCodexAuth(authPath: string | null, execution: JobExecutionRecord): Promise<void> {
  const runtime = executionRuntimeStorage.getStore();
  if (runtime?.syncCodexAuth) {
    await runtime.syncCodexAuth(authPath, execution);
    return;
  }
  if (!authPath || !fs.existsSync(authPath)) {
    return;
  }

  const tokens = parseCodexAuthFile(fs.readFileSync(authPath, "utf8"));
  if (!tokens) {
    return;
  }

  await storeCodexTokensForBinding(
    execution.metadata.codexAuth ?? {
      scope: "global",
      recordId: "codex:global",
    },
    tokens,
  );
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

function findNearestPlaywrightConfig(workingDirectory: string, repoPath: string, configPaths: string[]): string | null {
  let currentDir = workingDirectory;
  for (;;) {
    const configPath = configPaths.find(candidate => path.dirname(candidate) === currentDir);
    if (configPath) {
      return path.relative(workingDirectory, configPath) || path.basename(configPath);
    }
    if (currentDir === repoPath) {
      break;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir.startsWith(repoPath)) {
      break;
    }
    currentDir = parentDir;
  }
  return null;
}

function tokenizeShellCommand(command: string): string[] {
  return command
    .split(/\s+/)
    .map(token => token.trim())
    .map(token => token.replace(/^[("'`]+|[)"'`,;]+$/g, ""))
    .filter(Boolean)
    .filter(token => token !== "&&" && token !== "||" && token !== "|" && token !== ";");
}

function scriptContainsPlaywrightTest(
  script: string,
  workingDirectory: string,
  repoPath: string,
): boolean {
  if (/\bplaywright\s+test\b/.test(script)) {
    return true;
  }

  const candidatePaths = tokenizeShellCommand(script)
    .filter(token => /\.(?:[cm]?js|[cm]?ts|tsx)$/i.test(token))
    .map(token => path.resolve(workingDirectory, token))
    .filter(candidatePath => candidatePath.startsWith(repoPath) && fs.existsSync(candidatePath))
    .filter(candidatePath => fs.statSync(candidatePath).isFile());

  return candidatePaths.some(candidatePath => {
    try {
      const source = fs.readFileSync(candidatePath, "utf8").slice(0, 24_000);
      return /\bplaywright\b/.test(source) && /\btest\b/.test(source);
    } catch {
      return false;
    }
  });
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
  return "npm exec -- playwright test --list";
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
  const packageJsonPaths = walkRepoForFileNames(repoPath, new Set(["package.json"]), 4);
  const configPaths = walkRepoForFileNames(repoPath, new Set(PLAYWRIGHT_CONFIG_FILE_NAMES), 4);
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
        if (typeof script !== "string" || !scriptContainsPlaywrightTest(script, workingDirectory, repoPath)) {
          continue;
        }
        plans.push({
          label: scriptName,
          command: buildScriptRunCommand(packageManager, scriptName),
          workingDirectory,
          source: "package-script",
          packageManager,
          configPath: findNearestPlaywrightConfig(workingDirectory, repoPath, configPaths),
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
  const detached = process.platform !== "win32";
  const child = spawn("bash", ["-lc", options.command], {
    cwd: options.cwd,
    detached,
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

  return await new Promise<ShellRunResult>((resolve, reject) => {
    let settled = false;
    let forceResolveTimer: NodeJS.Timeout | null = null;
    const resolveOnce = (result: ShellRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (forceResolveTimer) {
        clearTimeout(forceResolveTimer);
      }
      resolve(result);
    };
    const killChildTree = () => {
      timedOut = true;
      try {
        if (detached && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
      forceResolveTimer = setTimeout(() => {
        resolveOnce({
          exitCode: null,
          signal: "SIGKILL",
          timedOut,
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
        });
      }, 2000);
    };
    const timer = setTimeout(killChildTree, options.timeoutMs);
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolveOnce({
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

function resolveSafePlaywrightVerificationCommand(
  handoff: StandardizedHandoff,
  repoPath: string,
): StandardizedHandoff["playwright"]["commands"][number] | null {
  const preflightPlan = detectPlaywrightPreflight(repoPath);
  if (preflightPlan) {
    return {
      label: preflightPlan.label,
      command: preflightPlan.command,
      workingDirectory: path.relative(repoPath, preflightPlan.workingDirectory) || ".",
      purpose: "Safely verify that the repository-native Playwright suite is discoverable without running the full suite.",
    };
  }

  const explicitListCommand = handoff.playwright.commands.find(command =>
    /\b--list\b/u.test(command.command) || /\blist\b/u.test(command.label.toLowerCase()));
  return explicitListCommand ?? null;
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

function formatBrowserFindingTarget(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const pathLabel = `${parsed.pathname}${parsed.search}`;
    return pathLabel.trim() || parsed.origin;
  } catch {
    return rawUrl;
  }
}

function isIgnorableBrowserRequestFailure(failure: string): boolean {
  return /\/_next\/static\/webpack\/[^ ]*\.hot-update\.(?:js|json)(?:\?|$|\s)/iu.test(failure)
    || /\.hot-update\.(?:js|json)(?:\?|$|\s)/iu.test(failure)
    || /\bGET\s+https?:\/\/[^/\s]+\/\?_rsc=[^\s]+/iu.test(failure)
    || /\bGET\s+\/\?_rsc=[^\s]+/iu.test(failure);
}

function isIgnorableBrowserConsoleError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("hydrated but some attributes")
    && normalized.includes("caret-color")
    && normalized.includes("transparent")
  ) {
    return true;
  }
  return normalized.includes("apiresponseerror: api unavailable while requesting /api/")
    && normalized.includes("about://react/server/webpack-internal");
}

function isRetryableBrowserNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "err_connection_refused",
    "err_connection_reset",
    "err_connection_closed",
    "econnrefused",
    "econnreset",
    "connection refused",
    "connection reset",
    "target closed",
    "timeout",
    "timed out",
  ].some(fragment => message.includes(fragment));
}

async function gotoBrowserPageWithRetry(
  page: any,
  url: string,
  options: { attempts?: number; timeoutMs?: number; waitUntil?: "domcontentloaded" | "load" | "networkidle" } = {},
): Promise<any> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await page.goto(url, {
        waitUntil: options.waitUntil ?? "domcontentloaded",
        timeout: options.timeoutMs ?? 15000,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableBrowserNavigationError(error)) {
        throw error;
      }
      await page.waitForTimeout(500 * attempt).catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to navigate to ${url}.`);
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
    "(?:^|\\s|[\"'`(<{\\[])(((?:primary|companion)\\/)?(?:[A-Za-z0-9._-]+\\/)*[A-Za-z0-9._-]+\\.[A-Za-z0-9._-]+)",
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

function inferEvidenceReferenceKind(value: string): EvidenceReference["kind"] {
  const normalized = value.trim().toLowerCase();
  if (/^(get|post|put|patch|delete|head|options)\s+https?:\/\//u.test(normalized)) {
    return "network";
  }
  if (/^https?:\/\//u.test(normalized)) {
    return "live-url";
  }
  if (/\.(png|jpe?g|webp|gif)$/u.test(normalized)) {
    return "screenshot";
  }
  if (/trace.*\.zip$/u.test(normalized) || /browser-trace\.zip$/u.test(normalized)) {
    return "trace";
  }
  if (/playwright-report|test-results|\.spec\.[cm]?[jt]sx?$/u.test(normalized)) {
    return "test-report";
  }
  if (/runtime\.log|validation-log|\.log$/u.test(normalized)) {
    return "runtime-log";
  }
  if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|docker-compose\.ya?ml)$/u.test(normalized)) {
    return "manifest";
  }
  if (normalized.startsWith("/") && !normalized.includes(".")) {
    return "route";
  }
  if (/console|pageerror|hydration|exception/u.test(normalized)) {
    return "console";
  }
  return "repo-file";
}

function buildFindingEvidenceRefs(evidence: string[], paths: string[]): EvidenceReference[] {
  const refs: EvidenceReference[] = [];
  const seen = new Set<string>();
  const push = (ref: EvidenceReference): void => {
    const key = `${ref.kind}:${ref.value}:${ref.sourcePath ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push(ref);
  };

  for (const pathValue of paths) {
    const normalizedPath = normalizeFindingPath(pathValue);
    if (!normalizedPath) {
      continue;
    }
    push({
      kind: inferEvidenceReferenceKind(normalizedPath),
      value: normalizedPath,
      detail: null,
      sourcePath: normalizedPath,
    });
  }

  for (const item of evidence) {
    const value = item.trim();
    if (!value) {
      continue;
    }
    const derivedPaths = extractFindingPaths([value]);
    if (derivedPaths.length > 0) {
      for (const derivedPath of derivedPaths) {
        push({
          kind: inferEvidenceReferenceKind(derivedPath),
          value: derivedPath,
          detail: value === derivedPath ? null : truncateText(value, 240),
          sourcePath: derivedPath,
        });
      }
      continue;
    }
    if (/^(get|post|put|patch|delete|head|options)\s+https?:\/\//iu.test(value) || /^https?:\/\//iu.test(value)) {
      push({
        kind: inferEvidenceReferenceKind(value),
        value,
        detail: null,
        sourcePath: null,
      });
      continue;
    }
    if (/console|pageerror|hydration|exception/iu.test(value)) {
      push({
        kind: "console",
        value: truncateText(value, 160),
        detail: truncateText(value, 240),
        sourcePath: null,
      });
    }
  }

  return refs.slice(0, 12);
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
  const candidates: Array<{ score: number; target: RuntimeExecutionTarget }> = [];
  const addCandidate = (candidate: {
    label: string;
    workingDirectory: string | null | undefined;
    startCommand: string | null | undefined;
    baseUrl: string | null | undefined;
    healthUrls: string[];
    kind: string | null;
    framework: string | null;
    source: "target" | "start-command" | "fallback";
  }): void => {
    if (!candidate.startCommand) {
      return;
    }
    const workingDirectory = resolveWorkingDirectory(repoPath, candidate.workingDirectory);
    const inferredBaseUrl = inferLocalBaseUrlFromStartCommand(repoPath, workingDirectory, candidate.startCommand);
    const baseUrl = inferredBaseUrl
      ?? normalizeAbsoluteUrl(candidate.baseUrl, handoff.runtime.baseUrls[0] ?? null)
      ?? normalizeAbsoluteUrl(handoff.runtime.baseUrls[0] ?? null, null);
    const healthUrls = inferredBaseUrl
      ? [inferredBaseUrl]
      : candidate.healthUrls
        .map(item => normalizeAbsoluteUrl(item, baseUrl))
        .filter((item): item is string => Boolean(item));
    const target = {
      label: candidate.label,
      workingDirectory,
      startCommand: candidate.startCommand,
      baseUrl,
      healthUrls: healthUrls.length > 0 ? healthUrls : (baseUrl ? [baseUrl] : []),
      kind: candidate.kind,
      framework: candidate.framework,
    };
    candidates.push({
      score: scoreSandboxRuntimeTarget(repoPath, target, candidate.source, Boolean(inferredBaseUrl)),
      target,
    });
  };

  for (const target of handoff.runtime.targets) {
    addCandidate({
      label: target.label,
      workingDirectory: target.workingDirectory,
      startCommand: target.startCommand,
      baseUrl: target.baseUrl,
      healthUrls: target.healthUrls,
      kind: target.kind,
      framework: target.framework,
      source: "target",
    });
  }

  for (const startCommand of handoff.runtime.startCommands) {
    addCandidate({
      label: startCommand.label,
      workingDirectory: startCommand.workingDirectory,
      startCommand: startCommand.command,
      baseUrl: null,
      healthUrls: [],
      kind: null,
      framework: null,
      source: "start-command",
    });
  }

  const fallback = inferRuntimeFallback(repoPath);
  const fallbackTargets = normalizeRuntimeTargets((fallback as { targets?: unknown }).targets);
  for (const fallbackTarget of fallbackTargets) {
    addCandidate({
      label: fallbackTarget.label,
      workingDirectory: fallbackTarget.workingDirectory ?? ".",
      startCommand: fallbackTarget.startCommand,
      baseUrl: fallbackTarget.baseUrl,
      healthUrls: fallbackTarget.healthUrls,
      kind: fallbackTarget.kind,
      framework: fallbackTarget.framework,
      source: "fallback",
    });
  }

  candidates.sort((left, right) =>
    right.score - left.score
    || Number(Boolean(right.target.baseUrl)) - Number(Boolean(left.target.baseUrl))
    || left.target.workingDirectory.localeCompare(right.target.workingDirectory)
    || left.target.label.localeCompare(right.target.label));

  return candidates[0]?.target ?? null;
}

function scoreSandboxRuntimeTarget(
  repoPath: string,
  target: RuntimeExecutionTarget,
  source: "target" | "start-command" | "fallback",
  hasInferredBaseUrl: boolean,
): number {
  const command = target.startCommand.trim().toLowerCase();
  const label = target.label.trim().toLowerCase();
  const scriptName = inferPackageScriptName(target.startCommand);
  let score = 0;

  if (source === "target") {
    score += 20;
  } else if (source === "fallback") {
    score += 15;
  }
  if (hasInferredBaseUrl) {
    score += 100;
  } else if (target.baseUrl) {
    score += 20;
  }
  if (target.kind?.toLowerCase().includes("web")) {
    score += 20;
  }
  if (target.framework && /next|vite|react|node|web/.test(target.framework.toLowerCase())) {
    score += 10;
  }
  if (scriptName) {
    score += scorePackageRuntimeScript(scriptName);
  }
  if (isSandboxUnsafeRuntimeCommand(command, label, scriptName)) {
    score -= 250;
  }
  if (target.workingDirectory === repoPath) {
    score += 5;
  }

  return score;
}

function scorePackageRuntimeScript(scriptName: string): number {
  const preferredScripts = [
    "speclens:start",
    "dev:web",
    "web:dev",
    "web:start",
    "start:web",
    "start",
    "dev",
    "preview",
    "serve",
  ];
  const index = preferredScripts.indexOf(scriptName);
  return index === -1 ? -10 : 80 - index;
}

function isSandboxUnsafeRuntimeCommand(command: string, label: string, scriptName: string | null): boolean {
  if (scriptName && /(^|:)(compose|deploy|provision|bootstrap|infra|ansible|terraform|k8s|cluster)(:|$)/.test(scriptName)) {
    return true;
  }
  return /\b(docker\s+compose|docker-compose|ansible-playbook|ansible-galaxy|terraform|kubectl|helm|pulumi|doctl|flyctl)\b/.test(command)
    || /\b(compose|deploy|provision|bootstrap|infra|ansible|terraform|k8s|cluster)\b/.test(label);
}

function inferPackageScriptName(command: string): string | null {
  const tokens = tokenizeShellCommand(command);
  if (tokens[0] === "npm" && tokens[1] === "run") {
    return tokens[2] ?? null;
  }
  if (tokens[0] === "pnpm") {
    return tokens[1] && tokens[1] !== "run" ? tokens[1] : tokens[2] ?? null;
  }
  if (tokens[0] === "yarn") {
    return tokens[1] ?? null;
  }
  if (tokens[0] === "bun" && tokens[1] === "run") {
    return tokens[2] ?? null;
  }
  return null;
}

function inferLocalBaseUrlFromStartCommand(repoPath: string, workingDirectory: string, startCommand: string): string | null {
  const scriptName = inferPackageScriptName(startCommand);
  if (!scriptName) {
    return null;
  }
  const manifest = readJsonRecord(path.join(workingDirectory, "package.json"));
  const scripts = manifest?.scripts && typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts)
    ? manifest.scripts as Record<string, unknown>
    : {};
  const script = typeof scripts[scriptName] === "string" ? scripts[scriptName] : startCommand;
  const port = inferPortFromCommandOrEntry(repoPath, workingDirectory, script);
  return port ? `http://127.0.0.1:${port}` : null;
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
    if (options.scope === "runtime-install" && isDependencyInstallCommand(command.command) && dependenciesAppearInstalled(workingDirectory)) {
      await appendLog(options.jobId, options.logs, options.scope, `Skipping ${command.label}; dependencies are already installed.`, "info");
      fs.writeFileSync(logPath, `Skipped ${command.command}; dependencies are already installed.\n`, "utf8");
      executed.push({
        label: command.label,
        command: command.command,
        workingDirectory,
        logPath,
        exitCode: 0,
      });
      continue;
    }
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

function isDependencyInstallCommand(command: string): boolean {
  return /\b(?:npm\s+(?:ci|install)|pnpm\s+install|yarn\s+install|bun\s+install)\b/.test(command);
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
          gotoBrowserPageWithRetry(options.page, options.pageUrl, {
            attempts: 2,
            timeoutMs: 8000,
            waitUntil: "domcontentloaded",
          }));
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
      await gotoBrowserPageWithRetry(options.page, options.pageUrl, {
        attempts: 2,
        timeoutMs: 12000,
        waitUntil: "domcontentloaded",
      }).catch(() => undefined);
    }
  }

  return interactions;
}

function buildNavigationPlan(
  handoff: StandardizedHandoff,
  baseUrl: string,
  options: { authenticated?: boolean } = {},
): { queued: string[]; skipped: Array<{ url: string; reason: string }> } {
  const queued: string[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const protectedPrefixes = buildProtectedRoutePrefixes(handoff.auth.frontend.protectedRoutes);
  const push = (candidate: string | null, requiresAuth = false) => {
    if (!candidate) {
      return;
    }
    const pageUrl = normalizeBrowserQaCandidate(candidate, baseUrl);
    if (!pageUrl) {
      skipped.push({ url: candidate, reason: "not a valid browser URL" });
      return;
    }
    const skipReason = getBrowserQaSkipReason(pageUrl, baseUrl, {
      authenticated: options.authenticated === true,
      requiresAuth,
      protectedPrefixes,
    });
    if (skipReason) {
      skipped.push({ url: pageUrl, reason: skipReason });
      return;
    }
    if (!queued.includes(pageUrl)) {
      queued.push(pageUrl);
    }
  };

  push(baseUrl);
  for (const target of handoff.playwright.navigationTargets) {
    push(target.path, target.requiresAuth);
  }
  for (const route of handoff.auth.frontend.protectedRoutes) {
    push(route, true);
  }
  if (queued.length === 0) {
    push(baseUrl);
  }
  return {
    queued: queued.slice(0, MAX_BROWSER_QA_PAGES),
    skipped,
  };
}

function buildProtectedRoutePrefixes(routes: string[]): string[] {
  return [...new Set(routes.flatMap(route => {
    const prefix = route
      .trim()
      .split(/\s+/)[0]
      ?.split(/[([]/)[0]
      ?.replace(/\/:[^/]+.*$/, "")
      .replace(/\*.*$/, "")
      .replace(/\/$/, "");
    if (!prefix || prefix === "/") {
      return [];
    }
    return [prefix.startsWith("/") ? prefix : `/${prefix}`];
  }))];
}

function normalizeBrowserQaCandidate(candidate: string, baseUrl: string): string | null {
  if (!isAtomicBrowserQaCandidate(candidate)) {
    return null;
  }
  const normalized = normalizeAbsoluteUrl(candidate, baseUrl);
  if (!normalized) {
    return null;
  }
  return normalizeBrowserUrl(normalized);
}

function isAtomicBrowserQaCandidate(candidate: string): boolean {
  const value = candidate.trim();
  if (!value) {
    return false;
  }
  if (/\s/u.test(value) || value.includes(",") || /\band\b/iu.test(value)) {
    return false;
  }
  return true;
}

function getBrowserQaSkipReason(
  candidateUrl: string,
  baseUrl: string,
  options: { authenticated: boolean; requiresAuth: boolean; protectedPrefixes: string[] },
): string | null {
  let parsed: URL;
  let parsedBase: URL;
  try {
    parsed = new URL(candidateUrl);
    parsedBase = new URL(baseUrl);
  } catch {
    return "not a valid browser URL";
  }
  if (parsed.origin !== parsedBase.origin) {
    return "outside the booted runtime origin";
  }

  const pathname = decodeURIComponent(parsed.pathname);
  if (pathname.startsWith("/api/")) {
    return "API endpoint, not a browser page";
  }
  if (/[<>{}\[\]]/.test(pathname) || /(^|\/):[^/]+/.test(pathname) || pathname.includes("*")) {
    return "unresolved route pattern";
  }
  if (!options.authenticated && (options.requiresAuth || options.protectedPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)))) {
    return "protected route requires authenticated browser state";
  }
  return null;
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
      await gotoBrowserPageWithRetry(options.page, loginUrl, {
        attempts: 3,
        timeoutMs: 15000,
        waitUntil: "domcontentloaded",
      });
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
  for (const candidate of KNOWN_PLAYWRIGHT_ARTIFACT_NAMES) {
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

function clearKnownPlaywrightArtifacts(cwd: string): string[] {
  const removed: string[] = [];
  for (const candidate of KNOWN_PLAYWRIGHT_ARTIFACT_NAMES) {
    const targetPath = path.join(cwd, candidate);
    if (!fs.existsSync(targetPath)) {
      continue;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    removed.push(targetPath);
  }
  return removed;
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
  const installCommands = options.handoff.runtime.installCommands
    .filter(command => isDependencyInstallCommand(command.command))
    .slice(0, 4);
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

    const playwrightCommand = resolveSafePlaywrightVerificationCommand(options.handoff, options.repoPath);
    if (playwrightCommand) {
      const playwrightLogPath = path.join(artifactsDir, "playwright-command.log");
      const playwrightCwd = resolveWorkingDirectory(options.repoPath, playwrightCommand.workingDirectory);
      const clearedArtifactPaths = clearKnownPlaywrightArtifacts(playwrightCwd)
        .map(item => relativeArtifactPath(options.repoPath, item))
        .filter((item): item is string => item !== null);
      if (clearedArtifactPaths.length > 0) {
        await appendLog(
          options.jobId,
          options.logs,
          "playwright",
          `Cleared stale Playwright artifacts before repository-native execution: ${clearedArtifactPaths.join(", ")}.`,
          "info",
        );
      }
      await appendLog(options.jobId, options.logs, "playwright", `Running safe Playwright verification command "${playwrightCommand.command}".`, "info");
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
          "Playwright verification command failed",
          fs.readFileSync(playwrightLogPath, "utf8").trim() || `The command "${playwrightCommand.command}" exited unsuccessfully.`,
          "Fix the safe Playwright verification command until it passes in the same environment the worker uses for hosted execution.",
          [relativeArtifactPath(options.tempDir, playwrightLogPath) ?? "playwright-command.log"],
          {
            primarySourceId: options.primarySourceId,
            companionSourceId: options.companionSourceId,
          },
        ));
        sections.push({
          title: "Playwright suite execution",
          status: "planned",
          summary: "A safe Playwright verification command was executed, but it did not complete successfully.",
          data: {
            command: playwrightCommand,
            logPath: relativeArtifactPath(options.tempDir, playwrightLogPath),
            copiedArtifacts,
            clearedArtifacts: clearedArtifactPaths,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
          },
        });
      } else {
        sections.push({
          title: "Playwright suite execution",
          status: "ready",
          summary: "The safe Playwright verification command completed successfully.",
          data: {
            command: playwrightCommand,
            logPath: relativeArtifactPath(options.tempDir, playwrightLogPath),
            copiedArtifacts,
            clearedArtifacts: clearedArtifactPaths,
          },
        });
      }
    } else {
      sections.push({
        title: "Playwright suite execution",
        status: "planned",
        summary: "No safe repository Playwright verification command was detected, so only direct browser QA was executed.",
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
    const protectedPrefixes = buildProtectedRoutePrefixes(options.handoff.auth.frontend.protectedRoutes);
    const navigationPlan = buildNavigationPlan(options.handoff, baseUrl, { authenticated });
    const queued = [...navigationPlan.queued];
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
        const response = await gotoBrowserPageWithRetry(page, normalizedUrl, {
          attempts: 3,
          timeoutMs: 15000,
          waitUntil: "domcontentloaded",
        });
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
        .map(link => normalizeBrowserQaCandidate(link, baseUrl))
        .filter((link): link is string => Boolean(link))
        .filter(link => !getBrowserQaSkipReason(link, baseUrl, {
          authenticated,
          requiresAuth: false,
          protectedPrefixes,
        }))
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
        if (isIgnorableBrowserConsoleError(errorMessage)) {
          continue;
        }
        const pageLabel = formatBrowserFindingTarget(normalizedUrl);
        findings.push(createRoleFinding(
          "medium",
          `Console error on ${pageLabel}`,
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
        if (isIgnorableBrowserRequestFailure(failure)) {
          continue;
        }
        const pageLabel = formatBrowserFindingTarget(normalizedUrl);
        findings.push(createRoleFinding(
          "medium",
          `Request failure on ${pageLabel}`,
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
        navigationTargets: navigationPlan.queued,
        skippedNavigationTargets: navigationPlan.skipped,
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
  tempDir: string;
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

  const workspace = createCoreWorkspace({
    rootDir: options.tempDir,
    name: safeSegment(options.jobId),
  });
  const artifactsDir = path.join(workspace.generatedDir, "browser", options.jobId);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const preflightLogPath = path.join(artifactsDir, "playwright-preflight.log");
  const preflightInstallLogPath = path.join(artifactsDir, "playwright-preflight-install.log");
  const config = loadAiWorkerConfig();
  const installDirectory = findPackageInstallDirectory(
    preflightPlan.workingDirectory,
    options.repoPath,
    preflightPlan.packageManager,
  );
  const installCommand = buildLockedInstallCommand(preflightPlan.packageManager, installDirectory);
  let installLogPath: string | null = null;

  if (!dependenciesAppearInstalled(installDirectory)) {
    const relativeInstallDirectory = path.relative(options.repoPath, installDirectory) || ".";
    await appendLog(
      options.jobId,
      options.logs,
      "playwright",
      `Preparing Playwright preflight dependencies via "${installCommand}".`,
      "info",
    );
    const installRun = await runShellCommand({
      command: installCommand,
      cwd: installDirectory,
      timeoutMs: config.executionCommandTimeoutMs,
    });
    const installOutput = [installRun.stdout.trim(), installRun.stderr.trim()].filter(Boolean).join("\n\n");
    fs.writeFileSync(preflightInstallLogPath, installOutput, "utf8");
    installLogPath = relativeArtifactPath(options.tempDir, preflightInstallLogPath);
    if (installRun.timedOut || installRun.exitCode !== 0) {
      const message = truncateText(installOutput || `The dependency install command "${installCommand}" exited unsuccessfully.`);
      await appendLog(options.jobId, options.logs, "playwright", `Playwright preflight dependency install failed: ${truncateLogMessage(message)}`, "warn");
      return {
        ...options.output,
        sections: [
          ...options.output.sections,
          {
            title: "Playwright preflight",
            status: "planned",
            summary: "Playwright preflight could not run because dependency preparation failed.",
            data: {
              detected: true,
              label: preflightPlan.label,
              command: preflightPlan.command,
              installCommand,
              installWorkingDirectory: relativeInstallDirectory,
              installLogPath,
              packageManager: preflightPlan.packageManager,
              timedOut: installRun.timedOut,
              exitCode: installRun.exitCode,
              output: message,
            },
          },
        ],
        findings: [
          ...options.output.findings,
          {
            severity: "medium",
            title: "Playwright preflight dependency install failed",
            message,
            suggestion: "Fix the repository dependency installation path so Playwright preflight can run in a clean hosted sandbox.",
            evidence: [installCommand, installLogPath ?? relativeInstallDirectory],
            sourceIds: [options.primarySourceId],
            paths: extractFindingPaths([relativeInstallDirectory, installLogPath ?? ""]),
            remediationPackIds: [],
          },
        ],
      };
    }
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
    timeoutMs: Math.min(config.playwrightCommandTimeoutMs, 300_000),
  });

  const combinedOutput = truncateText(
    [run.stdout.trim(), run.stderr.trim()].filter(Boolean).join("\n\n"),
  );
  const relativeWorkingDirectory = path.relative(options.repoPath, preflightPlan.workingDirectory) || ".";
  const relativeConfigPath = preflightPlan.configPath
    ? relativeArtifactPath(options.repoPath, path.resolve(preflightPlan.workingDirectory, preflightPlan.configPath))
    : null;
  fs.writeFileSync(
    preflightLogPath,
    [
      `command: ${preflightPlan.command}`,
      `workingDirectory: ${relativeWorkingDirectory}`,
      relativeConfigPath ? `configPath: ${relativeConfigPath}` : null,
      "",
      combinedOutput,
    ].filter(Boolean).join("\n"),
    "utf8",
  );
  const preflightPaths = extractFindingPaths(
    [
      relativeWorkingDirectory,
      relativeConfigPath ?? "",
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
            runnable: true,
            passed: true,
            suiteStatus: "passed",
            readiness: "ready",
            label: preflightPlan.label,
            command: preflightPlan.command,
            workingDirectory: relativeWorkingDirectory,
            source: preflightPlan.source,
            packageManager: preflightPlan.packageManager,
            configPath: relativeConfigPath,
            logPath: relativeArtifactPath(options.tempDir, preflightLogPath),
            installLogPath,
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
    const output = dropStalePlaywrightPreflightFindings(options.output);
    return {
      ...output,
      sections: [
        ...output.sections,
        {
          title: "Playwright preflight",
          status: "ready",
          summary: "The worker verified a runnable Playwright command with a safe preflight execution.",
          data: {
            detected: true,
            label: preflightPlan.label,
            command: preflightPlan.command,
            workingDirectory: relativeWorkingDirectory,
            source: preflightPlan.source,
            packageManager: preflightPlan.packageManager,
            configPath: relativeConfigPath,
            logPath: relativeArtifactPath(options.tempDir, preflightLogPath),
            installLogPath,
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
          workingDirectory: relativeWorkingDirectory,
          source: preflightPlan.source,
          packageManager: preflightPlan.packageManager,
          configPath: relativeConfigPath,
          logPath: relativeArtifactPath(options.tempDir, preflightLogPath),
          installLogPath,
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

function dropStalePlaywrightPreflightFindings(output: RoleOutput): RoleOutput {
  return {
    ...output,
    findings: output.findings.filter(finding => {
      const text = `${finding.title} ${finding.message}`.toLowerCase();
      if (text.includes("dependencies are not installed") || text.includes("dependency install")) {
        return false;
      }
      if (text.includes("docker compose v2") || text.includes("docker-compose v1") || text.includes("compose-backed local e2e path")) {
        return false;
      }
      if (text.includes("playwright execution is not ready")) {
        return false;
      }
      return true;
    }),
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

async function resolveExecutionLearnables(execution: JobExecutionRecord): Promise<Learnable[]> {
  const primaryLearnables = await listActiveSourceLearnables(execution.source.id);
  const companionLearnables = execution.companionSource
    ? (await listActiveSourceLearnables(execution.companionSource.id)).map(learnable => ({
        ...learnable,
        statement: `[Companion: ${execution.companionSource?.displayName}] ${learnable.statement}`,
        evidence: learnable.evidence.map(item => `[Companion] ${item}`),
      }))
    : [];
  return [...primaryLearnables, ...companionLearnables];
}

function createSandboxExecutionSnapshot(
  execution: JobExecutionRecord,
  plan: AiAgentExecutionPlan,
  learnables: Learnable[],
  codexAuthPath: string | null,
  outputRoot: string,
  timeoutMs: number | null,
): AgentSandboxExecutionSnapshot {
  return agentSandboxRequestSchema.shape.execution.parse({
    job: execution.job,
    workspace: execution.workspace,
    source: execution.source,
    companionSource: execution.companionSource,
    parentReport: execution.parentReport,
    metadata: execution.metadata satisfies JobExecutionMetadata,
    secrets: execution.secrets,
    plan,
    roleDefinitions: mapRoleDefinitions(plan),
    learnables,
    codexAuthPath,
    outputRoot,
    timeoutMs,
  });
}

async function buildSandboxExecutionContext(
  execution: JobExecutionRecord,
  options: {
    codexAuthPath: string | null;
    outputRoot: string;
    timeoutMs: number | null;
  },
): Promise<AgentExecutionContext> {
  const agentId = execution.job.agentId;
  if (!agentId) {
    throw new Error("Agent job is missing agentId.");
  }
  const plan = await getAiAgentExecutionPlan(agentId);
  const learnables = await resolveExecutionLearnables(execution);
  return {
    execution,
    snapshot: createSandboxExecutionSnapshot(
      execution,
      plan,
      learnables,
      options.codexAuthPath,
      options.outputRoot,
      options.timeoutMs,
    ),
  };
}

function createExecutionRecordFromSnapshot(snapshot: AgentSandboxExecutionSnapshot): JobExecutionRecord {
  return {
    job: snapshot.job,
    workspace: snapshot.workspace,
    source: snapshot.source,
    companionSource: snapshot.companionSource,
    parentReport: snapshot.parentReport,
    metadata: {
      ...(snapshot.metadata.remediation ? { remediation: snapshot.metadata.remediation } : {}),
      ...(snapshot.metadata.codexAuth ? { codexAuth: snapshot.metadata.codexAuth } : {}),
    },
    secrets: snapshot.secrets.map(secret => ({
      id: secret.id,
      kind: secret.kind,
      value: secret.value,
      ...(secret.name ? { name: secret.name } : {}),
    })),
  };
}

function createLocalArtifactReference(
  rootDir: string,
  filePath: string,
  artifactKind: ArtifactReference["kind"],
  mimeType: string,
): ArtifactReference {
  return {
    key: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    bucket: "local-workspace",
    region: "local",
    kind: artifactKind,
    mimeType,
    sizeBytes: fs.statSync(filePath).size,
  };
}

function createRemediationLocalArtifactReferences(
  rootDir: string,
  artifacts: Array<{
    kind: ArtifactReference["kind"];
    filePath: string;
    mimeType: string;
  }>,
): ArtifactReference[] {
  return artifacts
    .filter(item => fs.existsSync(item.filePath))
    .map(item => createLocalArtifactReference(rootDir, item.filePath, item.kind, item.mimeType));
}

function estimateRoleDurationMs(roleId: string, runtimeMode: JobExecutionRecord["job"]["runtimeMode"]): number {
  switch (roleId) {
    case "source-topology-scout":
      return 120_000;
    case "runtime-scout":
      return 420_000;
    case "auth-cartographer":
    case "live-surface-resolver":
      return 120_000;
    case "license-governor":
    case "dependency-risk-reviewer":
    case "component-cartographer":
    case "design-system-auditor":
    case "copy-consistency-auditor":
    case "accessibility-auditor":
    case "visual-qa-critic":
    case "ux-friction-reviewer":
    case "cross-surface-consistency-reviewer":
      return 120_000;
    case "architecture-reviewer":
    case "code-health-reviewer":
    case "navigation-qa-planner":
      return 180_000;
    case "browser-executor":
      return runtimeMode === "browser" ? 60_000 : 15_000;
    case "playwright-operator":
      return runtimeMode === "browser" ? 180_000 : 60_000;
    case "artifact-auditor":
      return 10_000;
    case "remediation-planner":
    case "e2e-remediation-planner":
    case "release-gate-scorer":
      return 150_000;
    case "standardized-json-output":
      return runtimeMode === "browser" ? 30_000 : 15_000;
    default:
      return 120_000;
  }
}

type ExecutionGraphRole = {
  id: string;
  order?: number;
  dependsOnRoleIds?: string[];
  nativeExecutorId?: string | null;
};

type RoleExecutionGraph = {
  roleIds: string[];
  dependenciesByRoleId: Map<string, string[]>;
  declaredDependenciesByRoleId: Map<string, string[]>;
  dependentsByRoleId: Map<string, string[]>;
  levels: string[][];
  syntheticDependencyCount: number;
  maxWidth: number;
};

function isExclusiveRuntimeRole(role: ExecutionGraphRole): boolean {
  return role.id === "browser-executor"
    || role.id === "playwright-operator"
    || role.id === "visual-qa-critic"
    || role.id === "standardized-json-output"
    || role.nativeExecutorId === "native-browser-suite"
    || role.nativeExecutorId === "native-visual-inspection";
}

function buildRoleExecutionGraph(roles: ExecutionGraphRole[]): RoleExecutionGraph {
  const roleIds = roles.map(role => role.id);
  const roleIdSet = new Set(roleIds);
  const dependenciesByRoleId = new Map<string, string[]>();
  const declaredDependenciesByRoleId = new Map<string, string[]>();
  const dependentsByRoleId = new Map<string, string[]>();
  let syntheticDependencyCount = 0;

  for (const role of roles) {
    const declaredDependencies = [...new Set((role.dependsOnRoleIds ?? [])
      .filter(roleId => roleIdSet.has(roleId) && roleId !== role.id))];
    declaredDependenciesByRoleId.set(role.id, declaredDependencies);
    dependenciesByRoleId.set(role.id, [...declaredDependencies]);
    dependentsByRoleId.set(role.id, []);
  }

  const exclusiveRuntimeRoles = roles.filter(isExclusiveRuntimeRole);
  for (let index = 1; index < exclusiveRuntimeRoles.length; index += 1) {
    const previousRoleId = exclusiveRuntimeRoles[index - 1]?.id;
    const roleId = exclusiveRuntimeRoles[index]?.id;
    if (!previousRoleId || !roleId) {
      continue;
    }
    const dependencies = dependenciesByRoleId.get(roleId) ?? [];
    if (!dependencies.includes(previousRoleId)) {
      dependencies.push(previousRoleId);
      syntheticDependencyCount += 1;
    }
  }

  for (const [roleId, dependencies] of dependenciesByRoleId) {
    dependenciesByRoleId.set(roleId, [...new Set(dependencies)]);
    for (const dependencyId of dependenciesByRoleId.get(roleId) ?? []) {
      dependentsByRoleId.get(dependencyId)?.push(roleId);
    }
  }

  const levels: string[][] = [];
  const completed = new Set<string>();
  const remaining = new Set(roleIds);
  while (remaining.size > 0) {
    const level = roles
      .filter(role => remaining.has(role.id))
      .filter(role => (dependenciesByRoleId.get(role.id) ?? []).every(dependencyId => completed.has(dependencyId)))
      .map(role => role.id);
    if (level.length === 0) {
      throw new Error("AI role dependency graph contains a cycle.");
    }
    levels.push(level);
    for (const roleId of level) {
      remaining.delete(roleId);
      completed.add(roleId);
    }
  }

  return {
    roleIds,
    dependenciesByRoleId,
    declaredDependenciesByRoleId,
    dependentsByRoleId,
    levels,
    syntheticDependencyCount,
    maxWidth: levels.reduce((max, level) => Math.max(max, level.length), 0),
  };
}

function estimateRoleExecutionGraphDurationMs(
  roles: ExecutionGraphRole[],
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"],
  maxConcurrency: number,
): number {
  if (roles.length === 0) {
    return 0;
  }
  const concurrency = Math.max(1, Math.floor(maxConcurrency));
  const graph = buildRoleExecutionGraph(roles);
  const roleById = new Map(roles.map(role => [role.id, role]));
  const pending = new Set(graph.roleIds);
  const completed = new Set<string>();
  const running = new Map<string, number>();
  let elapsedMs = 0;

  while (completed.size < graph.roleIds.length) {
    const ready = roles
      .filter(role => pending.has(role.id))
      .filter(role => (graph.dependenciesByRoleId.get(role.id) ?? []).every(dependencyId => completed.has(dependencyId)))
      .slice(0, Math.max(0, concurrency - running.size));
    for (const role of ready) {
      pending.delete(role.id);
      running.set(role.id, elapsedMs + estimateRoleDurationMs(role.id, runtimeMode));
    }
    if (running.size === 0) {
      return roles.reduce((total, role) => total + estimateRoleDurationMs(role.id, runtimeMode), 0);
    }
    const nextFinishedAt = Math.min(...running.values());
    elapsedMs = nextFinishedAt;
    for (const [roleId, finishedAt] of [...running.entries()]) {
      if (finishedAt === nextFinishedAt) {
        running.delete(roleId);
        if (roleById.has(roleId)) {
          completed.add(roleId);
        }
      }
    }
  }

  return elapsedMs;
}

function estimatePlanDurationMs(
  roles: ExecutionGraphRole[],
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"],
  maxConcurrency = 1,
): number {
  return estimateRoleExecutionGraphDurationMs(roles, runtimeMode, maxConcurrency);
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

function buildLockedInstallCommand(packageManager: PackageManager, installDirectory: string): string {
  if (packageManager === "pnpm") {
    return fs.existsSync(path.join(installDirectory, "pnpm-lock.yaml")) ? "pnpm install --frozen-lockfile" : "pnpm install";
  }
  if (packageManager === "yarn") {
    return fs.existsSync(path.join(installDirectory, "yarn.lock")) ? "yarn install --immutable" : "yarn install";
  }
  if (packageManager === "bun") {
    return "bun install";
  }
  if (fs.existsSync(path.join(installDirectory, "package-lock.json"))) {
    return "npm ci";
  }
  return "npm install";
}

function findPackageInstallDirectory(directory: string, repoPath: string, packageManager: PackageManager): string {
  const lockfileNames: Record<PackageManager, string[]> = {
    npm: ["package-lock.json"],
    pnpm: ["pnpm-lock.yaml"],
    yarn: ["yarn.lock"],
    bun: ["bun.lockb", "bun.lock"],
  };
  let currentDir = directory;
  for (;;) {
    if (lockfileNames[packageManager].some(fileName => fs.existsSync(path.join(currentDir, fileName)))) {
      return currentDir;
    }
    if (currentDir === repoPath) {
      break;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir.startsWith(repoPath)) {
      break;
    }
    currentDir = parentDir;
  }
  return directory;
}

function dependenciesAppearInstalled(directory: string): boolean {
  return fs.existsSync(path.join(directory, "node_modules"));
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

function pickRoleOutputFromIds(priorOutputs: PriorRoleOutput[], roleIds: string[]): PriorRoleOutput | null {
  for (const roleId of roleIds) {
    const candidate = pickRoleOutput(priorOutputs, roleId);
    if (candidate) {
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

function pickSectionDataFromRoleIds(
  priorOutputs: PriorRoleOutput[],
  roleIds: string[],
  preferredTitles: string[] = [],
): Record<string, unknown> {
  const roleOutput = pickRoleOutputFromIds(priorOutputs, roleIds);
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

function collectSyntheticFindings(priorOutputs: PriorRoleOutput[]): AnalysisReport["findings"] {
  const collected = priorOutputs.flatMap(output => output.output.findings.map(finding => {
    const paths = extractFindingPaths(finding.evidence ?? [], finding.paths ?? []);
    return {
      id: finding.id ?? createId("finding"),
      roleId: output.roleId,
      category: normalizeFindingCategory(finding.category, output.roleId),
      severity: finding.severity,
      title: finding.title,
      message: finding.message,
      suggestion: finding.suggestion,
      evidence: finding.evidence,
      evidenceRefs: buildFindingEvidenceRefs(finding.evidence ?? [], paths),
      sourceIds: finding.sourceIds ?? [],
      paths,
      remediationPackIds: [],
    };
  }));
  return dedupeReportFindings(collected);
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

function findGeneratedArtifactFiles(rootDir: string): string[] {
  const generatedDirs = [
    path.join(rootDir, "generated"),
    path.join(rootDir, ".speclens-workspace", "workspaces"),
  ].flatMap(candidate => {
    if (!fs.existsSync(candidate)) {
      return [];
    }
    if (path.basename(candidate) !== "workspaces") {
      return [candidate];
    }
    return fs.readdirSync(candidate, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(candidate, entry.name, "generated"))
      .filter(generatedDir => fs.existsSync(generatedDir));
  });
  if (generatedDirs.length === 0) {
    return [];
  }
  const discovered: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 5) {
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        visit(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      discovered.push(entryPath);
    }
  };
  for (const generatedDir of generatedDirs) {
    visit(generatedDir, 0);
  }
  return [...new Set(discovered)].sort();
}

function classifyGeneratedArtifact(filePath: string): ArtifactReference["kind"] {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(normalized);
  if (basename === "runtime.log") {
    return "runtime-log";
  }
  if (basename === "browser-trace.zip" || normalized.endsWith(".trace.zip")) {
    return "trace";
  }
  if (basename.endsWith("storage-state.json")) {
    return "storage-state";
  }
  if (basename === "playwright-command.log" || basename === "playwright-preflight.log" || basename.endsWith("-install.log")) {
    return "validation-log";
  }
  if (normalized.includes("playwright-report/")) {
    return "playwright-report";
  }
  if (normalized.includes("test-results/")) {
    return "test-results";
  }
  if (basename.endsWith(".png") || basename.endsWith(".jpg") || basename.endsWith(".jpeg") || basename.endsWith(".webp")) {
    return "screenshot";
  }
  return "artifact";
}

function buildGeneratedArtifactSnapshot(rootDir: string): Array<{
  kind: ArtifactReference["kind"];
  path: string;
  sizeBytes: number;
}> {
  return findGeneratedArtifactFiles(rootDir).map(filePath => ({
    kind: classifyGeneratedArtifact(filePath),
    path: relativeArtifactPath(rootDir, filePath) ?? path.relative(rootDir, filePath).replace(/\\/g, "/"),
    sizeBytes: fs.statSync(filePath).size,
  }));
}

function buildDeterministicArtifactAuditorOutput(options: {
  tempDir: string;
  runtimeMode: JobExecutionRecord["job"]["runtimeMode"];
  priorOutputs: PriorRoleOutput[];
}): RoleOutput {
  const navigationData = pickSectionData(options.priorOutputs, "navigation-qa-planner", ["Navigation QA plan"]);
  const browserData = pickSectionData(options.priorOutputs, "browser-executor", ["Browser QA execution", "Browser execution plan"]);
  const playwrightPlanData = pickSectionData(options.priorOutputs, "playwright-operator", ["Playwright operator plan"]);
  const playwrightPreflightData = pickSectionData(options.priorOutputs, "playwright-operator", ["Playwright preflight"]);
  const runtimeExecutionData = pickSectionData(options.priorOutputs, "standardized-json-output", ["Runtime execution"]);
  const generatedArtifacts = buildGeneratedArtifactSnapshot(options.tempDir);
  const generatedKinds = [...new Set(generatedArtifacts.map(artifact => artifact.kind))];
  const playwrightDetected = playwrightPlanData.detected === true
    || playwrightPlanData.present === true
    || playwrightPreflightData.detected === true
    || typeof playwrightPreflightData.command === "string"
    || typeof playwrightPreflightData.configPath === "string";
  const baseExpectations = [
    { kind: "report", required: true, label: "Controller-finalized JSON, Markdown, and HTML report exports.", source: "controller-finalization" },
    { kind: "route-map", required: true, label: "Generated route map or spec-pack route inventory.", source: "controller-finalization" },
    { kind: "remediation-pack", required: true, label: "Generated remediation package manifest for downstream fix jobs.", source: "controller-finalization" },
    { kind: "runtime-log", required: true, label: "Runtime boot and health-check log from sandbox execution.", source: "sandbox-runtime" },
    ...(options.runtimeMode === "browser"
      ? [
          { kind: "screenshot", required: true, label: "Representative screenshots captured by direct browser QA.", source: "browser-executor" },
          { kind: "trace", required: true, label: "Trace archive captured by direct browser QA.", source: "browser-executor" },
          { kind: "storage-state", required: true, label: "Captured browser storage state after auth and navigation attempts.", source: "browser-executor" },
        ]
      : []),
    ...(playwrightDetected
      ? [
          { kind: "validation-log", required: true, label: "Playwright preflight or suite command log.", source: "playwright-operator" },
          { kind: "playwright-report", required: false, label: "Repository-native Playwright HTML report when produced.", source: "playwright-operator" },
          { kind: "test-results", required: false, label: "Repository-native Playwright test-result directory when produced.", source: "playwright-operator" },
        ]
      : []),
  ];
  const artifactExpectations = normalizeArtifactExpectations([
    ...normalizeArtifactExpectations(navigationData.artifactExpectations),
    ...normalizeArtifactExpectations(browserData.artifactExpectations),
    ...normalizeArtifactExpectations(playwrightPlanData.artifactExpectations),
    ...normalizeArtifactExpectations(playwrightPreflightData.artifactExpectations),
    ...baseExpectations,
  ]);
  const dedupedExpectations = [...new Map(artifactExpectations.map(expectation => [
    `${expectation.kind}:${expectation.label.toLowerCase()}`,
    expectation,
  ])).values()];
  const expectedKinds = [...new Set(dedupedExpectations.map(expectation => expectation.kind))];
  const requiredArtifacts = dedupedExpectations.filter(expectation => expectation.required);
  const currentlyMissingGeneratedKinds = requiredArtifacts
    .map(expectation => expectation.kind)
    .filter(kind => !["report", "route-map", "remediation-pack"].includes(kind))
    .filter(kind => !generatedKinds.includes(kind));
  const finalizationDeferredKinds = requiredArtifacts
    .map(expectation => expectation.kind)
    .filter(kind => ["report", "route-map", "remediation-pack"].includes(kind));
  const sourcePaths = combineUniqueStrings(
    generatedArtifacts.map(artifact => artifact.path),
    normalizeStringArray([runtimeExecutionData.runtimeLog]),
    normalizeStringArray([browserData.tracePath]),
    normalizeStringArray([browserData.capturedStorageStatePath]),
    normalizeStringArray(browserData.pages),
    normalizeStringArray([playwrightPreflightData.logPath]),
  ).slice(0, 80);

  return roleOutputSchema.parse({
    summary: currentlyMissingGeneratedKinds.length > 0
      ? `Deterministic artifact audit expects ${expectedKinds.length} artifact kind(s); current sandbox output is missing generated kind(s): ${currentlyMissingGeneratedKinds.join(", ")}.`
      : `Deterministic artifact audit expects ${expectedKinds.length} artifact kind(s); generated sandbox artifacts currently cover ${generatedKinds.length} kind(s), with final report artifacts deferred to controller finalization.`,
    sections: [{
      title: "Artifact expectations",
      status: "ready",
      summary: finalizationDeferredKinds.length > 0
        ? `Artifact expectations were synthesized deterministically. Controller-finalized kind(s) deferred: ${[...new Set(finalizationDeferredKinds)].join(", ")}.`
        : "Artifact expectations were synthesized deterministically from prior execution outputs.",
      data: {
        artifactExpectations: dedupedExpectations,
        expectedKinds,
        requiredArtifacts,
        sourcePaths,
        generatedArtifacts,
        presentGeneratedKinds: generatedKinds,
        missingGeneratedKinds: currentlyMissingGeneratedKinds,
        finalizationDeferredKinds: [...new Set(finalizationDeferredKinds)],
      },
    }],
    findings: currentlyMissingGeneratedKinds.map(kind => ({
      severity: "medium" as const,
      title: `Generated ${kind} artifact missing before finalization`,
      message: `The deterministic artifact audit expected a ${kind} artifact from already-executed sandbox roles, but did not find one under the generated output directory.`,
      suggestion: "Inspect the runtime, browser, or Playwright role output and ensure it writes the expected artifact before report finalization.",
      evidence: sourcePaths,
      sourceIds: [],
      paths: [],
      remediationPackIds: [],
    })),
  });
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
  const preferredScriptNames = [
    "speclens:start",
    "dev:web",
    "web:dev",
    "web:start",
    "start:web",
    "start",
    "dev",
    "preview",
    "serve",
  ];
  const runtimeScriptScore = (scriptName: string): number => {
    const preferredIndex = preferredScriptNames.indexOf(scriptName);
    return preferredIndex === -1 ? 10 : 100 - preferredIndex;
  };
  const candidates = packageJsonPaths
    .map(packageJsonPath => {
      const manifest = readJsonRecord(packageJsonPath);
      const scripts = manifest?.scripts && typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts)
        ? manifest.scripts as Record<string, unknown>
        : {};
      const workingDirectory = path.dirname(packageJsonPath);
      const preferredScriptName = preferredScriptNames.find(name => typeof scripts[name] === "string") ?? null;
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
        score: runtimeScriptScore(preferredScriptName),
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
  const playwrightPlanData = pickSectionData(options.priorOutputs, "playwright-operator", ["Playwright operator plan"]);
  const playwrightPreflightData = pickSectionData(options.priorOutputs, "playwright-operator", ["Playwright preflight"]);
  const playwrightData: Record<string, unknown> = {
    ...playwrightPlanData,
    ...playwrightPreflightData,
    coverageGaps: combineUniqueStrings(playwrightPlanData.coverageGaps, playwrightPreflightData.coverageGaps),
    commands: Array.isArray(playwrightPreflightData.commands) && playwrightPreflightData.commands.length > 0
      ? playwrightPreflightData.commands
      : playwrightPlanData.commands,
  };
  const artifactData = pickSectionData(options.priorOutputs, "artifact-auditor", ["Artifact expectations"]);
  const remediationData = pickSectionDataFromRoleIds(
    options.priorOutputs,
    ["remediation-planner", "e2e-remediation-planner"],
    ["Remediation planning"],
  );
  const fixReadinessData = pickSectionData(options.priorOutputs, "fix-readiness-emitter", ["Fix readiness handoff"]);
  const releaseData = pickSectionData(options.priorOutputs, "release-gate-scorer", ["Release gate recommendation"]);
  const liveSurfaceData = pickSectionData(options.priorOutputs, "live-surface-resolver", ["Live surface resolution"]);
  const topologyData = pickSectionData(options.priorOutputs, "source-topology-scout", ["Source topology", "Repository inventory"]);
  const preflightPlan = detectPlaywrightPreflight(options.repoPath);
  const runtimeFallback = inferRuntimeFallback(options.repoPath);
  const syntheticFindings = collectSyntheticFindings(options.priorOutputs);
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
        ? [
            { kind: "validation-log", required: true, label: "Playwright preflight logs proving the detected repository-native execution path." },
            { kind: "playwright-report", required: false, label: "Repository-native Playwright report artifacts when present." },
            { kind: "test-results", required: false, label: "Repository-native Playwright test-result artifacts when present." },
          ]
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
  authPath: string | null;
}): Promise<NativeExecutionResult> {
  const nativeExecutorId = options.role.nativeExecutorId as NativeExecutorId | null;
  if (!nativeExecutorId) {
    return { output: roleOutputSchema.parse({ summary: "", sections: [], findings: [] }), logs: [] };
  }

  const workspace = createCoreWorkspace(
    nativeExecutorId === "native-browser-suite" || nativeExecutorId === "native-visual-inspection"
      ? {
          rootDir: options.tempDir,
          name: safeSegment(options.jobId),
        }
      : {
          rootDir: path.join(options.tempDir, "native-executors"),
          name: safeSegment(`${options.jobId}-${nativeExecutorId}`),
        },
  );
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
          codexAuthPath: options.authPath,
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
          codexAuthPath: options.authPath,
        });
        return {
          output: toRoleOutputFromLegacyResult(result),
          logs: result.logs,
        };
      }
    case "deterministic-artifact-expectations":
      return {
        output: buildDeterministicArtifactAuditorOutput({
          tempDir: options.tempDir,
          runtimeMode: options.runtimeMode,
          priorOutputs: options.priorOutputs,
        }),
        logs: [],
      };
    case "deterministic-remediation-planning":
      return {
        output: buildDeterministicRemediationPlannerOutput({
          priorOutputs: options.priorOutputs,
        }),
        logs: [],
      };
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
  execution: JobExecutionRecord;
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
      order: roleOrder + 1,
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
        authPath: options.authPath,
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
    const contractNativeOutput = applyRoleOutputContract(options.role.id, finalizedNativeOutput);
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
      detail: `${contractNativeOutput.sections.length} section(s), ${contractNativeOutput.findings.length} finding(s)`,
      startedAt: roleStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
    }, defaultVisibility);
    return contractNativeOutput;
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
  const maxCodexAttempts = Math.max(1, config.codexMaxAttempts);
  let run: CodexRunResult | null = null;
  let baseOutput: RoleOutput | null = null;
  let outputReadError: unknown = null;
  for (let attempt = 1; attempt <= maxCodexAttempts; attempt += 1) {
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
      prompt: attempt === 1
        ? prompt
        : [
            prompt,
            "Retry correction:",
            "- The previous response was not valid role-output JSON.",
            "- Return exactly one JSON object with keys `summary`, `sections`, and `findings`.",
            "- Do not include markdown, comments, trailing commas, unescaped newlines in strings, or text before/after the JSON object.",
            "- Keep arrays compact and bounded so the response remains parseable.",
          ].join("\n\n"),
      outputPath,
      timeoutMs: config.codexTimeoutMs,
      sandboxMode,
      bypassSandbox: config.codexBypassSandbox,
      authPath: options.authPath,
      streamLogs: config.codexStreamLogs,
      onStdoutLine: line => appendLog(options.jobId, options.logs, "codex", `${options.role.name}: ${line}`, "info", undefined, "verbose"),
      onStderrLine: line => appendLog(options.jobId, options.logs, "codex", `${options.role.name}: ${line}`, "warn", undefined, "verbose"),
      ...(outputSchemaPath ? { outputSchemaPath } : {}),
    });
    if (!run.timedOut && run.exitCode === 0) {
      await syncCodexAuth(options.authPath, options.execution);
      try {
        baseOutput = readRoleOutput(outputPath, options.role.id);
        outputReadError = null;
        break;
      } catch (error) {
        outputReadError = error;
        if (options.role.executorKind === "hybrid" && nativeOutput) {
          break;
        }
        if (attempt >= maxCodexAttempts) {
          break;
        }
        const detail = error instanceof Error ? error.message : "Codex emitted invalid JSON.";
        await appendLog(
          options.jobId,
          options.logs,
          "agent",
          `Role ${options.role.name} emitted invalid role output on attempt ${attempt}/${maxCodexAttempts}: ${truncateLogMessage(detail, 240)}. Retrying in ${Math.round(config.codexRetryDelayMs / 1000)}s.`,
          "warn",
          undefined,
          defaultVisibility,
        );
        await sleep(config.codexRetryDelayMs);
        continue;
      }
    }

    if (attempt >= maxCodexAttempts || !isRetryableCodexFailure(run)) {
      break;
    }

    const detail = sanitizeCodexDiagnosticText(run.stderr) || sanitizeCodexDiagnosticText(run.stdout) || "transient Codex failure";
    await appendLog(
      options.jobId,
      options.logs,
      "agent",
      `Role ${options.role.name} hit a retryable Codex error on attempt ${attempt}/${maxCodexAttempts}: ${truncateLogMessage(detail, 240)}. Retrying in ${Math.round(config.codexRetryDelayMs / 1000)}s.`,
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
      detail: detail || `Codex exited with code ${run.exitCode}.`,
      startedAt: roleStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, new Date().getTime() - new Date(roleStartedAt).getTime()),
    }, defaultVisibility);
    throw new Error(`${options.role.name} failed${detail ? `: ${detail}` : "."}`);
  }

  if (!baseOutput) {
    if (options.role.executorKind === "hybrid" && nativeOutput) {
      const detail = outputReadError instanceof Error ? outputReadError.message : "Codex emitted invalid JSON.";
      await appendLog(
        options.jobId,
        options.logs,
        "agent",
        `Role ${options.role.name} produced invalid Codex JSON; using deterministic native output instead. ${truncateLogMessage(detail, 240)}`,
        "warn",
        undefined,
        defaultVisibility,
      );
      baseOutput = nativeOutput;
    } else {
      const detail = outputReadError instanceof Error ? outputReadError.message : "Codex emitted invalid JSON.";
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
      throw new Error(`${options.role.name} emitted invalid role output: ${detail}`);
    }
  }
  const withExecutionEvidence = options.role.id === "playwright-operator"
    ? await augmentWithPlaywrightPreflight({
        jobId: options.jobId,
        logs: options.logs,
        repoPath: options.repoPath,
        tempDir: options.tempDir,
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
  const mergedOutput = applyRoleOutputContract(
    options.role.id,
    nativeOutput ? mergeRoleOutputs(nativeOutput, finalizedOutput) : finalizedOutput,
  );
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
      detail: `${mergedOutput.sections.length} section(s), ${mergedOutput.findings.length} finding(s)`,
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

function buildExecutionTiming(
  job: JobExecutionRecord["job"],
  jobStartedAt: number,
  estimatedTotalDurationMs: number | null,
  basis: string,
): JobEnvelope["timing"] {
  return {
    queueDurationMs: job.startedAt && job.createdAt
      ? Math.max(0, new Date(job.startedAt).getTime() - new Date(job.createdAt).getTime())
      : null,
    runDurationMs: Math.max(0, Date.now() - jobStartedAt),
    totalDurationMs: Math.max(0, Date.now() - new Date(job.createdAt).getTime()),
    elapsedMs: Math.max(0, Date.now() - new Date(job.createdAt).getTime()),
    estimatedTotalMs: estimatedTotalDurationMs,
    estimatedRemainingMs: 0,
    confidence: estimatedTotalDurationMs === null ? "medium" : "high",
    basis,
  };
}

function createFailureEnvelope(options: {
  snapshot: AgentSandboxExecutionSnapshot;
  logs: AnalysisLogEvent[];
  status: "failed" | "cancelled";
  failureReason: string;
  jobStartedAt: number;
  artifacts?: ArtifactReference[];
  estimatedTotalDurationMs?: number | null;
  finishedAt?: string;
}): JobEnvelope {
  return jobEnvelopeSchema.parse({
    job: {
      ...options.snapshot.job,
      status: options.status,
      failureReason: options.failureReason,
      finishedAt: options.finishedAt ?? new Date().toISOString(),
    },
    logs: options.logs,
    report: null,
    artifacts: options.artifacts ?? [],
    timing: buildExecutionTiming(
      options.snapshot.job,
      options.jobStartedAt,
      options.estimatedTotalDurationMs ?? null,
      "Derived from sandbox execution timing and the persisted job timestamps.",
    ),
    qualityScorecard: null,
    capabilityGaps: [],
    artifactAnalysis: null,
    executionSteps: collectAnalysisExecutionSteps(options.logs),
  });
}

function appendRoleOutputToReport(options: {
  role: { id: string; name: string };
  output: RoleOutput;
  sections: AnalysisReport["sections"];
  findings: AnalysisReport["findings"];
  execution: JobExecutionRecord;
}): void {
  if (options.output.summary.trim().length > 0) {
    options.sections.push({
      id: createId("section"),
      roleId: options.role.id,
      title: `${options.role.name} summary`,
      status: "ready",
      summary: options.output.summary.trim(),
      data: {},
    });
  }

  for (const section of options.output.sections) {
    options.sections.push({
      id: section.id ?? createId("section"),
      roleId: options.role.id,
      title: section.title,
      status: section.status,
      summary: section.summary,
      data: section.data,
    });
  }

  for (const finding of options.output.findings) {
    const normalizedPaths = extractFindingPaths(finding.evidence ?? [], finding.paths ?? []);
    const normalizedSourceIds = inferFindingSourceIds({
      explicitSourceIds: finding.sourceIds ?? [],
      evidence: finding.evidence ?? [],
      paths: normalizedPaths,
      primarySourceId: options.execution.job.sourceId,
      companionSourceId: options.execution.job.companionSourceId,
    });
    const evidenceRefs = buildFindingEvidenceRefs(finding.evidence ?? [], normalizedPaths);
    options.findings.push({
      id: finding.id ?? createId("finding"),
      roleId: options.role.id,
      category: normalizeFindingCategory(finding.category, options.role.id),
      severity: finding.severity,
      title: finding.title,
      message: finding.message,
      suggestion: finding.suggestion,
      evidence: finding.evidence ?? [],
      evidenceRefs,
      sourceIds: normalizedSourceIds,
      paths: normalizedPaths,
      remediationPackIds: finding.remediationPackIds ?? [],
    });
  }
}

function normalizeFindingDedupeText(value: string): string {
  return value
    .replace(/^%o\s+%s\s+/iu, "")
    .replace(/\?[0-9]+(?=[:\s])/gu, "?n")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function getBrowserFindingAnchor(finding: AnalysisReport["findings"][number]): string {
  const directPath = finding.paths[0] ?? "";
  if (directPath) {
    return directPath;
  }
  return finding.evidence.find(item => {
    const normalized = item.toLowerCase();
    return normalized.startsWith("http://")
      || normalized.startsWith("https://")
      || /\.(png|jpe?g|webp|gif)$/u.test(normalized);
  }) ?? "";
}

function getFindingDedupeKey(finding: AnalysisReport["findings"][number]): string {
  const title = normalizeFindingDedupeText(finding.title);
  if (/^(console error|request failure|page error) on /u.test(title)) {
    return [
      "browser",
      title,
      normalizeFindingDedupeText(getBrowserFindingAnchor(finding)),
    ].join("::");
  }
  return [
    title,
    normalizeFindingDedupeText(finding.message),
    normalizeFindingDedupeText(finding.suggestion),
    normalizeFindingDedupeText(finding.paths[0] ?? ""),
  ].join("::");
}

function mergeFindingStringList(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].map(value => value.trim()).filter(Boolean))];
}

function mergeDuplicateFinding(
  existing: AnalysisReport["findings"][number],
  duplicate: AnalysisReport["findings"][number],
): AnalysisReport["findings"][number] {
  const severityScore = { high: 3, medium: 2, low: 1 } as const;
  const evidenceRefs = [...existing.evidenceRefs];
  const evidenceRefKeys = new Set(evidenceRefs.map(ref => JSON.stringify(ref)));
  for (const ref of duplicate.evidenceRefs) {
    const key = JSON.stringify(ref);
    if (!evidenceRefKeys.has(key)) {
      evidenceRefKeys.add(key);
      evidenceRefs.push(ref);
    }
  }
  return {
    ...existing,
    severity: severityScore[duplicate.severity] > severityScore[existing.severity]
      ? duplicate.severity
      : existing.severity,
    evidence: mergeFindingStringList(existing.evidence, duplicate.evidence),
    evidenceRefs,
    sourceIds: mergeFindingStringList(existing.sourceIds, duplicate.sourceIds),
    paths: mergeFindingStringList(existing.paths, duplicate.paths),
    remediationPackIds: mergeFindingStringList(existing.remediationPackIds, duplicate.remediationPackIds),
  };
}

function dedupeReportFindings(findings: AnalysisReport["findings"]): AnalysisReport["findings"] {
  const findingsByKey = new Map<string, AnalysisReport["findings"][number]>();
  for (const finding of findings) {
    const key = getFindingDedupeKey(finding);
    const existing = findingsByKey.get(key);
    findingsByKey.set(key, existing ? mergeDuplicateFinding(existing, finding) : finding);
  }
  return [...findingsByKey.values()];
}

function dependencyOutputsForRole(options: {
  role: AiAgentExecutionPlan["roles"][number];
  roles: AiAgentExecutionPlan["roles"];
  declaredDependenciesByRoleId: Map<string, string[]>;
  outputsByRoleId: Map<string, PriorRoleOutput>;
}): PriorRoleOutput[] {
  const dependencies = options.declaredDependenciesByRoleId.get(options.role.id) ?? [];
  if (dependencies.length === 0) {
    return [];
  }
  const dependencySet = new Set(dependencies);
  return options.roles
    .filter(role => dependencySet.has(role.id))
    .map(role => options.outputsByRoleId.get(role.id))
    .filter((output): output is PriorRoleOutput => Boolean(output));
}

async function executeRolesWithGraph(options: {
  jobId: string;
  plan: AiAgentExecutionPlan;
  repoPath: string;
  tempDir: string;
  authPath: string | null;
  logs: AnalysisLogEvent[];
  learnables: Learnable[];
  execution: JobExecutionRecord;
  maxConcurrency: number;
}): Promise<PriorRoleOutput[]> {
  const roles = options.plan.roles;
  const graph = buildRoleExecutionGraph(roles);
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency));
  const effectiveConcurrency = Math.min(maxConcurrency, Math.max(1, graph.maxWidth));
  const outputsByRoleId = new Map<string, PriorRoleOutput>();
  const completedRoleIds = new Set<string>();
  const pendingRoleIds = new Set(graph.roleIds);
  const running = new Map<string, Promise<{
    role: AiAgentExecutionPlan["roles"][number];
    output?: RoleOutput;
    durationMs: number;
    error?: unknown;
  }>>();
  let cancellationRequested = false;

  await appendLog(
    options.jobId,
    options.logs,
    "agent",
    `Execution graph planned ${graph.levels.length} level(s), max width ${graph.maxWidth}, role concurrency ${effectiveConcurrency}.`,
  );
  if (graph.syntheticDependencyCount > 0) {
    await appendLog(
      options.jobId,
      options.logs,
      "agent",
      `Execution graph added ${graph.syntheticDependencyCount} runtime-resource ordering edge(s) to avoid browser, Playwright, and dev-server artifact races.`,
      "info",
      undefined,
      "verbose",
    );
  }

  const launchReadyRoles = async (): Promise<void> => {
    if (cancellationRequested) {
      return;
    }
    if (await executionCancellationRequested(options.jobId)) {
      cancellationRequested = true;
      return;
    }
    const openSlots = Math.max(0, effectiveConcurrency - running.size);
    if (openSlots === 0) {
      return;
    }
    const readyRoles = roles
      .filter(role => pendingRoleIds.has(role.id))
      .filter(role => (graph.dependenciesByRoleId.get(role.id) ?? [])
        .every(dependencyId => completedRoleIds.has(dependencyId)))
      .slice(0, openSlots);

    for (const role of readyRoles) {
      pendingRoleIds.delete(role.id);
      const priorOutputs = dependencyOutputsForRole({
        role,
        roles,
        declaredDependenciesByRoleId: graph.declaredDependenciesByRoleId,
        outputsByRoleId,
      });
      const roleStartedAt = Date.now();
      running.set(role.id, (async () => {
        try {
          const output = await executeRole({
            jobId: options.jobId,
            role,
            agentId: options.plan.agent.id,
            agentName: options.plan.agent.name,
            repoPath: options.repoPath,
            tempDir: options.tempDir,
            authPath: options.authPath,
            logs: options.logs,
            priorOutputs,
            learnables: options.learnables,
            execution: options.execution,
            primarySource: options.execution.source,
            companionSource: options.execution.companionSource,
            secrets: options.execution.secrets,
            runtimeMode: options.execution.job.runtimeMode,
          });
          return { role, output, durationMs: Date.now() - roleStartedAt };
        } catch (error) {
          return { role, error, durationMs: Date.now() - roleStartedAt };
        }
      })());
    }
  };

  while (completedRoleIds.size < roles.length) {
    await launchReadyRoles();
    if (running.size === 0) {
      if (cancellationRequested) {
        throw new AgentExecutionCancelledError();
      }
      throw new Error("AI role execution graph stalled before all roles completed.");
    }

    const result = await Promise.race(running.values());
    running.delete(result.role.id);
    if (result.error) {
      throw result.error;
    }
    if (!result.output) {
      throw new Error(`${result.role.name} completed without role output.`);
    }

    if (
      (options.plan.agent.id === "agent-universal-smoke"
        || options.plan.agent.id === "agent-e2e-smoke"
        || options.plan.agent.id === "agent-e2e-remediation")
      && result.role.id === "runtime-scout"
    ) {
      const removedPaths = cleanupTransientRuntimeArtifacts(options.repoPath);
      if (removedPaths.length > 0) {
        await appendLog(
          options.jobId,
          options.logs,
          "agent",
          `Cleaned transient runtime artifacts after ${result.role.name}: ${removedPaths.join(", ")}.`,
          "info",
          undefined,
          "verbose",
        );
      }
    }

    outputsByRoleId.set(result.role.id, {
      roleId: result.role.id,
      roleName: result.role.name,
      output: result.output,
    });
    completedRoleIds.add(result.role.id);

    const remainingRoles = roles.filter(role => !completedRoleIds.has(role.id));
    const remainingEstimateMs = estimatePlanDurationMs(
      remainingRoles,
      options.execution.job.runtimeMode,
      effectiveConcurrency,
    );
    await appendLog(
      options.jobId,
      options.logs,
      "agent",
      `Role ${result.role.name} finished in ${formatDurationMs(result.durationMs)}. Estimated remaining graph runtime ${formatDurationMs(remainingEstimateMs)}.`,
      "info",
      undefined,
      result.role.consoleVisibility === "quiet" ? "verbose" : "default",
    );

    if (await executionCancellationRequested(options.jobId)) {
      cancellationRequested = true;
    }
  }

  return roles.map(role => {
    const output = outputsByRoleId.get(role.id);
    if (!output) {
      throw new Error(`Missing output for role ${role.id}.`);
    }
    return output;
  });
}

async function executeAuditJobCore(
  context: AgentExecutionContext,
  queueMessageId: string,
): Promise<HostedAuditCoreResult> {
  const { execution, snapshot } = context;
  const jobId = snapshot.job.id;
  const logs: AnalysisLogEvent[] = [];
  const tempDir = snapshot.outputRoot;
  const plan = snapshot.plan;
  const config = loadAiWorkerConfig();
  const roleMaxConcurrency = Math.max(1, config.roleMaxConcurrency);
  const estimatedTotalDurationMs = estimatePlanDurationMs(plan.roles, snapshot.job.runtimeMode, roleMaxConcurrency);
  const jobStartedAt = Date.now();
  const authPath = snapshot.codexAuthPath;

  await appendLog(jobId, logs, "agent", `Agent ${execution.job.claimedRunnerId ?? config.workerId} claimed job ${jobId}.`);
  await appendLog(
    jobId,
    logs,
    "agent",
    `Planned ${plan.roles.length} role(s); estimated graph runtime ${formatDurationMs(estimatedTotalDurationMs)} for ${snapshot.job.runtimeMode} mode with role concurrency ${roleMaxConcurrency}.`,
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

  try {
    const { repoPath } = await materializeSource(execution, tempDir);
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

    if (snapshot.learnables.length > 0) {
      await appendLog(
        jobId,
        logs,
        "learnables",
        execution.companionSource
          ? `Loaded ${snapshot.learnables.filter(item => !item.statement.startsWith("[Companion:")).length} primary learnable(s) and ${snapshot.learnables.filter(item => item.statement.startsWith("[Companion:")).length} companion learnable(s).`
          : `Loaded ${snapshot.learnables.length} learnable(s) for this source.`,
      );
    }

    const sections: AnalysisReport["sections"] = [];
    const findings: AnalysisReport["findings"] = [];
    const priorOutputs = await executeRolesWithGraph({
      jobId,
      plan,
      repoPath,
      tempDir,
      authPath,
      logs,
      learnables: snapshot.learnables,
      execution,
      maxConcurrency: roleMaxConcurrency,
    });

    for (const role of plan.roles) {
      const roleOutput = priorOutputs.find(output => output.roleId === role.id);
      if (!roleOutput) {
        throw new Error(`Missing output for role ${role.id}.`);
      }
      appendRoleOutputToReport({
        role,
        output: roleOutput.output,
        sections,
        findings,
        execution,
      });
    }

    const dedupedFindings = dedupeReportFindings(findings);
    const report = enrichReportForUniversalAudit(analysisReportSchema.parse({
      id: `report-${jobId}`,
      workspaceId: execution.workspace.id,
      jobId,
      status: "ready",
      roles: snapshot.roleDefinitions,
      runtimeMode: execution.job.runtimeMode,
      title: resolveRepoTitle(execution, repoPath),
      summary: {
        totalFindings: dedupedFindings.length,
        high: dedupedFindings.filter(item => item.severity === "high").length,
        medium: dedupedFindings.filter(item => item.severity === "medium").length,
        low: dedupedFindings.filter(item => item.severity === "low").length,
        executionSteps: collectAnalysisExecutionSteps(logs),
      },
      findings: dedupedFindings,
      sections,
      artifacts: [],
      createdAt: new Date().toISOString(),
    }), plan.agent.id);

    await appendLog(
      jobId,
      logs,
      "agent",
      `Agent completed ${plan.roles.length} roles in ${formatDurationMs(Date.now() - jobStartedAt)}.`,
    );
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
      envelope: jobEnvelopeSchema.parse({
        job: {
          ...execution.job,
          status: "succeeded",
          reportId: report.id,
          finishedAt: new Date().toISOString(),
          queueMessageId,
        },
        logs,
        report,
        artifacts: report.artifacts,
        timing: buildExecutionTiming(
          execution.job,
          jobStartedAt,
          estimatedTotalDurationMs,
          "Derived from live sandbox execution timing and the persisted job timestamps.",
        ),
        qualityScorecard: report.summary.qualityScorecard,
        capabilityGaps: report.summary.capabilityGaps,
        artifactAnalysis: report.summary.artifactAnalysis,
        executionSteps: report.summary.executionSteps,
      }),
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
    return {
      envelope: finalizedEnvelope,
      learnables: synthesizeLearnablesFromReport(report),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent worker failed.";
    if (error instanceof AgentExecutionCancelledError) {
      await appendLog(jobId, logs, "agent", message, "warn");
      const artifacts = writeAgentFailureDiagnostics({
        jobId,
        tempDir,
        status: "cancelled",
        failureReason: message,
        logs,
      });
      return {
        envelope: createFailureEnvelope({
          snapshot,
          logs,
          status: "cancelled",
          failureReason: message,
          jobStartedAt,
          artifacts,
          estimatedTotalDurationMs,
        }),
        learnables: [],
      };
    }
    await appendLog(jobId, logs, "agent", message, "error");
    const artifacts = writeAgentFailureDiagnostics({
      jobId,
      tempDir,
      status: "failed",
      failureReason: message,
      logs,
    });
    return {
      envelope: createFailureEnvelope({
        snapshot,
        logs,
        status: "failed",
        failureReason: message,
        jobStartedAt,
        artifacts,
        estimatedTotalDurationMs,
      }),
      learnables: [],
    };
  }
}

async function executeRemediationJobCore(
  context: AgentExecutionContext,
  queueMessageId: string,
): Promise<HostedRemediationCoreResult> {
  const { execution, snapshot } = context;
  const jobId = execution.job.id;
  const logs: AnalysisLogEvent[] = [];
  const jobStartedAt = Date.now();
  const remediation = execution.metadata.remediation;
  const report = execution.parentReport;
  if (!remediation || !report) {
    return {
      envelope: createFailureEnvelope({
        snapshot,
        logs,
        status: "failed",
        failureReason: "Remediation metadata or parent report is missing.",
        jobStartedAt,
      }),
    };
  }

  const tempDir = snapshot.outputRoot;
  const exportDir = path.join(tempDir, "exports");
  const repoDir = path.join(tempDir, "repo");
  const authPath = snapshot.codexAuthPath;
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
        await syncCodexAuth(authPath, execution);
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
    const localArtifacts = createRemediationLocalArtifactReferences(tempDir, [
      { kind: "patch-bundle", filePath: patchBundlePath, mimeType: "text/x-diff" },
      { kind: "git-bundle", filePath: gitBundlePath, mimeType: "application/octet-stream" },
      { kind: "validation-log", filePath: validationLogPath, mimeType: "text/plain" },
      { kind: "changeset-manifest", filePath: manifestPath, mimeType: "application/json" },
      { kind: "pr-summary", filePath: prSummaryPath, mimeType: "text/markdown" },
    ]);
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
      detail: `${localArtifacts.length} artifact(s) prepared.`,
    }));

    return {
      envelope: jobEnvelopeSchema.parse({
        job: {
          ...execution.job,
          status: "succeeded",
          queueMessageId,
          changeset,
          finishedAt: new Date().toISOString(),
        },
        logs,
        report: null,
        artifacts: localArtifacts,
        timing: buildExecutionTiming(
          execution.job,
          jobStartedAt,
          Date.now() - new Date(execution.job.createdAt).getTime(),
          "Derived from queued remediation execution timing.",
        ),
        qualityScorecard: null,
        capabilityGaps: [],
        artifactAnalysis: null,
        executionSteps: collectAnalysisExecutionSteps(logs),
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remediation worker failed.";
    await appendLog(jobId, logs, "remediation", message, "error", requestId);
    const artifacts = writeAgentFailureDiagnostics({
      jobId,
      tempDir,
      status: "failed",
      failureReason: message,
      logs,
    });
    return {
      envelope: createFailureEnvelope({
        snapshot,
        logs,
        status: "failed",
        failureReason: message,
        jobStartedAt,
        artifacts,
      }),
    };
  }
}

async function runAgentJob(
  execution: JobExecutionRecord,
  queueMessageId: string,
): Promise<JobEnvelope> {
  const config = loadAiWorkerConfig();
  const jobId = execution.job.id;
  const tempDir = path.join(config.tempRoot, `${safeSegment(jobId)}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const authPath = await stageCodexAuth(tempDir, execution);
  try {
    const context = await buildSandboxExecutionContext(execution, {
      codexAuthPath: authPath,
      outputRoot: tempDir,
      timeoutMs: config.sandboxTimeoutMs,
    });
    const result = await withExecutionRuntime({ appendLogs: async () => undefined }, async () => {
      const coreResult = await executeAuditJobCore(context, queueMessageId);
      const logs = [...coreResult.envelope.logs];
      const report = coreResult.envelope.report;
      if (!report) {
        return await finalizeAgentJobFailure({
          jobId,
          tempDir,
          failureReason: coreResult.envelope.job.failureReason ?? "Agent worker failed.",
          status: coreResult.envelope.job.status === "cancelled" ? "cancelled" : "failed",
          logs,
          artifacts: coreResult.envelope.artifacts,
        });
      }
      const activeLearnables = await replaceSourceLearnables(
        execution.workspace.id,
        execution.source.id,
        jobId,
        coreResult.learnables,
      );
      logs.push(createLog(jobId, "learnables", `Stored ${activeLearnables.length} learnable(s) for future runs.`));
      logs.push(createLog(
        jobId,
        "quality",
        `Quality score ${report.summary.qualityScorecard?.overallScore ?? 0}/100; ${report.summary.capabilityGaps.length} capability gap(s); release gate ${report.summary.releaseGateDecision?.status ?? "unknown"}.`,
      ));
      const mirroredEnvelope = await mirrorArtifactsToObjectStorage(storageConfig(), {
        ...coreResult.envelope,
        logs,
      }, tempDir);
      logs.push(createLog(
        jobId,
        "artifact",
        `Persisted ${mirroredEnvelope.report?.artifacts.length ?? 0} artifact reference(s) for audit review.`,
      ));
      return await finalizeAnalysisJobSuccess(jobId, {
        ...mirroredEnvelope,
        logs,
      });
    });
    await syncCodexAuth(authPath, execution);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent worker failed.";
    return await finalizeAgentJobFailure({
      jobId,
      tempDir,
      failureReason: message,
      logs: [createLog(jobId, "agent", message, "error")],
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runRemediationJob(
  execution: JobExecutionRecord,
  queueMessageId: string,
): Promise<JobEnvelope> {
  const config = loadAiWorkerConfig();
  const jobId = execution.job.id;
  const tempDir = createRemediationTempDir();
  const authPath = await stageCodexAuth(tempDir, execution);
  try {
    const context = await buildSandboxExecutionContext(execution, {
      codexAuthPath: authPath,
      outputRoot: tempDir,
      timeoutMs: config.sandboxTimeoutMs,
    });
    const result = await withExecutionRuntime({ appendLogs: async () => undefined }, async () => {
      const coreResult = await executeRemediationJobCore(context, queueMessageId);
      const logs = [...coreResult.envelope.logs];
      if (coreResult.envelope.job.status !== "succeeded") {
        return await finalizeAgentJobFailure({
          jobId,
          tempDir,
          failureReason: coreResult.envelope.job.failureReason ?? "Remediation worker failed.",
          status: coreResult.envelope.job.status === "cancelled" ? "cancelled" : "failed",
          logs,
          artifacts: coreResult.envelope.artifacts,
        });
      }
      const changeset = coreResult.envelope.job.changeset;
      if (changeset) {
        await storeRemediationJobChangeset(jobId, changeset);
        if (execution.job.parentReportId) {
          await storeReportChangeset(execution.job.parentReportId, changeset, jobId);
        }
      }
      const persistedArtifacts = await uploadLocalArtifactsToObjectStorage({
        jobId,
        reportId: execution.parentReport?.id ?? null,
        baseDir: tempDir,
        artifacts: coreResult.envelope.artifacts,
        keyPrefix: `jobs/${jobId}/remediation`,
      });
      logs.push(createLog(jobId, "artifact", `Persisted ${persistedArtifacts.length} remediation artifact(s).`));
      return await finalizeAnalysisJobSuccess(jobId, {
        ...coreResult.envelope,
        logs,
        artifacts: persistedArtifacts,
      }, persistedArtifacts);
    });
    await syncCodexAuth(authPath, execution);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remediation worker failed.";
    return await finalizeAgentJobFailure({
      jobId,
      tempDir,
      failureReason: message,
      logs: [createLog(jobId, "remediation", message, "error", execution.job.queueMessageId ?? undefined)],
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const sandboxLogPrefix = "SPECLENS_LOG ";

function createSandboxStreamLogSink(
  jobId: string,
  onPersisted: (log: AnalysisLogEvent) => void,
): {
  push: (log: AnalysisLogEvent) => void;
  flush: () => Promise<void>;
} {
  const pendingLogs: AnalysisLogEvent[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let flushLoop: Promise<void> | null = null;

  const drainPendingLogs = async () => {
    if (flushLoop) {
      await flushLoop;
      return;
    }
    flushLoop = (async () => {
      while (pendingLogs.length > 0) {
        const batch = pendingLogs.splice(0, 100);
        try {
          await appendAnalysisJobLogs(jobId, batch);
          for (const log of batch) {
            onPersisted(log);
          }
        } catch {
          pendingLogs.unshift(...batch);
          break;
        }
      }
    })();
    try {
      await flushLoop;
    } finally {
      flushLoop = null;
      if (pendingLogs.length > 0) {
        scheduleFlush();
      }
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void drainPendingLogs();
    }, 250);
  };

  return {
    push(log) {
      pendingLogs.push(log);
      if (pendingLogs.length >= 25) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        void drainPendingLogs();
        return;
      }
      scheduleFlush();
    },
    async flush() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await drainPendingLogs();
    },
  };
}

function pipeSandboxStream(
  stream: NodeJS.ReadableStream,
  filePath: string,
  onLine: (line: string) => void,
): void {
  const destination = fs.createWriteStream(filePath, { flags: "a" });
  let remainder = "";
  stream.on("data", chunk => {
    const value = String(chunk);
    destination.write(value);
    remainder = flushChunkLinesUntruncated(value, remainder, onLine);
  });
  stream.on("end", () => {
    if (remainder.trim().length > 0) {
      onLine(remainder.trim());
    }
    destination.end();
  });
}

type AgentSandboxRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
};

async function waitForAgentSandbox(
  jobId: string,
  child: ReturnType<typeof spawn>,
  containerName: string,
): Promise<AgentSandboxRunResult> {
  const config = loadAiWorkerConfig();
  let timedOut = false;
  let cancelled = false;
  let forceKillTimer: NodeJS.Timeout | null = null;

  const terminateChild = (reason: "timeout" | "cancel"): void => {
    if (reason === "timeout") timedOut = true;
    if (reason === "cancel") cancelled = true;
    if (child.killed) {
      return;
    }
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
      void runProcess("docker", ["rm", "-f", containerName]).catch(error => {
        console.warn("[ai-worker] Failed to cleanup sandbox container:", error);
      });
    }, 5000);
  };

  const timeout = setTimeout(() => {
    terminateChild("timeout");
  }, config.sandboxTimeoutMs);
  const cancellationPoll = setInterval(() => {
    void isCancellationRequested(jobId).then(requested => {
      if (!requested || cancelled) {
        return;
      }
      terminateChild("cancel");
    }).catch(() => undefined);
  }, 1000);

  try {
    return await new Promise<AgentSandboxRunResult>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          timedOut,
          cancelled,
        });
      });
    });
  } finally {
    clearTimeout(timeout);
    clearInterval(cancellationPoll);
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
  }
}

function appendSandboxEnv(
  dockerArgs: string[],
  name: string,
  value: string | null | undefined,
): void {
  if (!value || value.trim().length === 0) {
    return;
  }
  dockerArgs.push("-e", `${name}=${value}`);
}

function forwardSandboxEnvironment(dockerArgs: string[], config: ReturnType<typeof loadAiWorkerConfig>): void {
  const names = [
    "CODEX_BIN",
    "OPENAI_CODEX_MODEL",
    "AI_WORKER_ROLE_MAX_CONCURRENCY",
    "AI_WORKER_CODEX_TIMEOUT_MS",
    "AI_WORKER_EXECUTION_COMMAND_TIMEOUT_MS",
    "AI_WORKER_RUNTIME_BOOT_TIMEOUT_MS",
    "AI_WORKER_PLAYWRIGHT_COMMAND_TIMEOUT_MS",
    "AI_WORKER_CODEX_MAX_ATTEMPTS",
    "AI_WORKER_CODEX_RETRY_DELAY_MS",
    "AI_WORKER_CODEX_USE_OUTPUT_SCHEMA",
    "AI_WORKER_PROMPT_CAPTURE_PATH",
    "OBJECT_STORAGE_PROVIDER",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_PUBLIC_ENDPOINT",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_FORCE_PATH_STYLE",
    "OBJECT_STORAGE_ACCESS_KEY_ID",
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "OBJECT_STORAGE_MIRROR_PROVIDER",
    "OBJECT_STORAGE_MIRROR_BUCKET",
    "OBJECT_STORAGE_MIRROR_ENDPOINT",
    "OBJECT_STORAGE_MIRROR_PUBLIC_ENDPOINT",
    "OBJECT_STORAGE_MIRROR_REGION",
    "OBJECT_STORAGE_MIRROR_FORCE_PATH_STYLE",
    "OBJECT_STORAGE_MIRROR_ACCESS_KEY_ID",
    "OBJECT_STORAGE_MIRROR_SECRET_ACCESS_KEY",
    "OBJECT_STORAGE_MIRROR_REQUIRED",
    "SPACES_BUCKET",
    "SPACES_ENDPOINT",
    "SPACES_REGION",
    "SPACES_ACCESS_KEY_ID",
    "SPACES_SECRET_ACCESS_KEY",
    "APP_STATE_ENCRYPTION_KEY",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_PRIVATE_KEY_FILE",
    "SPECLENS_REMOTE_PR_GITHUB_TOKEN",
    "SPECLENS_EXPOSE_E2E_TASKS",
  ];
  for (const name of names) {
    appendSandboxEnv(dockerArgs, name, process.env[name]);
  }
  appendSandboxEnv(
    dockerArgs,
    "OBJECT_STORAGE_ENDPOINT",
    config.sandboxObjectStorageEndpoint ?? process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? null,
  );
  appendSandboxEnv(dockerArgs, "AI_WORKER_CODEX_BYPASS_SANDBOX", "true");
  appendSandboxEnv(dockerArgs, "SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS", "true");
  appendSandboxEnv(
    dockerArgs,
    "DOCKER_HOST",
    config.sandboxNetwork === "host" ? "tcp://127.0.0.1:2375" : "tcp://host.docker.internal:2375",
  );
}

async function runHostedAgentSandbox(options: {
  execution: JobExecutionRecord;
  requestPath: string;
  tempDir: string;
  stdoutPath: string;
  stderrPath: string;
  extraEnv?: Record<string, string>;
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
}): Promise<AgentSandboxRunResult> {
  const config = loadAiWorkerConfig();
  const mountRoot = "/speclens-agent-run";
  const containerName = `speclens-agent-${safeSegment(options.execution.job.id)}-${safeSegment(config.workerId)}`.slice(0, 63);
  const dockerArgs = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--label",
    "speclens.managed=true",
    "--label",
    `speclens.aiWorkerId=${config.workerId}`,
    "--label",
    `speclens.jobId=${options.execution.job.id}`,
    "-v",
    `${options.tempDir}:${mountRoot}`,
  ];
  if (config.sandboxNetwork) {
    dockerArgs.push("--network", config.sandboxNetwork);
  } else {
    dockerArgs.push("--add-host", "host.docker.internal:host-gateway");
  }
  if (config.sandboxCpuLimit) {
    dockerArgs.push("--cpus", config.sandboxCpuLimit);
  }
  if (config.sandboxMemoryLimit) {
    dockerArgs.push("--memory", config.sandboxMemoryLimit);
  }
  if (typeof process.getuid === "function" && typeof process.getgid === "function") {
    dockerArgs.push("--user", `${process.getuid()}:${process.getgid()}`);
  }
  forwardSandboxEnvironment(dockerArgs, config);
  for (const [name, value] of Object.entries(options.extraEnv ?? {})) {
    appendSandboxEnv(dockerArgs, name, value);
  }
  dockerArgs.push(
    config.sandboxImage,
    "node",
    "--import",
    "tsx",
    "/app/apps/ai-worker/src/services/sandbox.ts",
    `${mountRoot}/${path.basename(options.requestPath)}`,
  );
  const child = spawn("docker", dockerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(config.dockerHost ? { DOCKER_HOST: config.dockerHost } : {}),
    },
  });
  pipeSandboxStream(child.stdout, options.stdoutPath, options.onStdoutLine);
  pipeSandboxStream(child.stderr, options.stderrPath, options.onStderrLine);
  return await waitForAgentSandbox(options.execution.job.id, child, containerName);
}

function stageSandboxPrivateKeyFile(tempDir: string, mountRoot: string): Record<string, string> {
  if (process.env.GITHUB_APP_PRIVATE_KEY?.trim()) {
    return {};
  }
  const privateKeyFile = process.env.GITHUB_APP_PRIVATE_KEY_FILE?.trim();
  if (!privateKeyFile) {
    return {};
  }
  const absolutePath = path.resolve(privateKeyFile);
  if (!fs.existsSync(absolutePath)) {
    return {};
  }
  const stagedPath = path.join(tempDir, "github-app-private-key.pem");
  fs.copyFileSync(absolutePath, stagedPath);
  fs.chmodSync(stagedPath, 0o600);
  return {
    GITHUB_APP_PRIVATE_KEY_FILE: `${mountRoot}/github-app-private-key.pem`,
  };
}

async function uploadSandboxRawLogs(jobId: string, stdoutPath: string, stderrPath: string): Promise<ArtifactReference[]> {
  const artifacts: ArtifactReference[] = [];
  if (fs.existsSync(stdoutPath) && fs.statSync(stdoutPath).size > 0) {
    artifacts.push(await putObjectFromFile(
      storageConfig(),
      `jobs/${jobId}/sandbox-stdout.log`,
      stdoutPath,
      "text/plain",
      {
        kind: "runtime-log",
        jobId,
        reportId: null,
      },
    ));
  }
  if (fs.existsSync(stderrPath) && fs.statSync(stderrPath).size > 0) {
    artifacts.push(await putObjectFromFile(
      storageConfig(),
      `jobs/${jobId}/sandbox-stderr.log`,
      stderrPath,
      "text/plain",
      {
        kind: "runtime-log",
        jobId,
        reportId: null,
      },
    ));
  }
  return artifacts;
}

function readSandboxFailure(stderrPath: string, fallback: string): string {
  if (!fs.existsSync(stderrPath)) {
    return fallback;
  }
  const content = fs.readFileSync(stderrPath, "utf8").trim();
  if (!content) {
    return fallback;
  }
  return content.split("\n").slice(-10).join("\n").slice(0, 1000);
}

async function executeHostedAgentJobInSandbox(
  execution: JobExecutionRecord,
  queueMessageId: string,
): Promise<JobEnvelope> {
  const config = loadAiWorkerConfig();
  const jobId = execution.job.id;
  const tempDir = path.join(config.tempRoot, `${safeSegment(jobId)}-${Date.now()}`);
  const stdoutPath = path.join(tempDir, "sandbox-stdout.log");
  const stderrPath = path.join(tempDir, "sandbox-stderr.log");
  const mountRoot = "/speclens-agent-run";
  const streamedLogIds = new Set<string>();
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const sandboxExtraEnv = stageSandboxPrivateKeyFile(tempDir, mountRoot);
  const executionForSandbox: JobExecutionRecord = {
    ...execution,
    job: {
      ...execution.job,
      queueMessageId: execution.job.queueMessageId ?? queueMessageId,
    },
  };

  const authPath = await stageCodexAuth(tempDir, executionForSandbox);
  const sandboxContext = await buildSandboxExecutionContext(executionForSandbox, {
    codexAuthPath: authPath
      ? `${mountRoot}/${path.relative(tempDir, authPath).replace(/\\/g, "/")}`
      : null,
    outputRoot: mountRoot,
    timeoutMs: config.sandboxTimeoutMs,
  });
  const requestPath = path.join(tempDir, "agent-sandbox-request.json");
  fs.writeFileSync(
    requestPath,
    `${JSON.stringify(agentSandboxRequestSchema.parse({
      schemaVersion: "speclens.agent-sandbox.v1",
      execution: sandboxContext.snapshot,
    }), null, 2)}\n`,
    "utf8",
  );

  const controllerLogs: AnalysisLogEvent[] = [];
  await appendLog(jobId, controllerLogs, "sandbox", `Launching hosted agent sandbox ${config.sandboxImage}.`, "info");
  await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
    id: "sandbox:launch",
    order: 1,
    title: "Launch hosted job sandbox",
    stepType: "stage",
    agentId: execution.job.agentId,
    agentName: "Hosted agent controller",
    status: "running",
    startedAt: new Date().toISOString(),
  }));
  const sandboxWaitStartedAt = new Date().toISOString();
  await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
    id: "sandbox:wait",
    order: 2,
    title: "Wait for hosted job sandbox",
    stepType: "stage",
    agentId: execution.job.agentId,
    agentName: "Hosted agent controller",
    status: "running",
    startedAt: sandboxWaitStartedAt,
  }));
  await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
    id: "sandbox:launch",
    order: 1,
    title: "Launch hosted job sandbox",
    stepType: "stage",
    agentId: execution.job.agentId,
    agentName: "Hosted agent controller",
    status: "succeeded",
    detail: "Docker sandbox process started.",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  }));

  try {
    const sandboxStreamLogSink = createSandboxStreamLogSink(jobId, log => {
      streamedLogIds.add(log.id);
    });
    const sandboxResult = await runHostedAgentSandbox({
      execution: executionForSandbox,
      requestPath,
      tempDir,
      stdoutPath,
      stderrPath,
      extraEnv: sandboxExtraEnv,
      onStdoutLine: line => {
        if (line.startsWith(sandboxLogPrefix)) {
          try {
            const log = analysisLogEventSchema.parse(JSON.parse(line.slice(sandboxLogPrefix.length)));
            sandboxStreamLogSink.push(log);
            return;
          } catch {
            // fall through to raw stdout logging
          }
        }
        void appendLog(jobId, controllerLogs, "sandbox-stdout", truncateLogMessage(line), "info", undefined, "verbose");
      },
      onStderrLine: line => {
        void appendLog(jobId, controllerLogs, "sandbox-stderr", truncateLogMessage(line), "warn", undefined, "verbose");
      },
    });
    await sandboxStreamLogSink.flush();

    const rawLogArtifacts = await uploadSandboxRawLogs(jobId, stdoutPath, stderrPath);
    const waitStatus = sandboxResult.cancelled || sandboxResult.timedOut || sandboxResult.exitCode !== 0
      ? "failed"
      : "succeeded";
    const waitDetail = sandboxResult.cancelled
      ? "Sandbox execution cancelled."
      : sandboxResult.timedOut
        ? `Sandbox timed out after ${config.sandboxTimeoutMs}ms.`
        : sandboxResult.exitCode !== 0
          ? `Sandbox exited with code ${sandboxResult.exitCode ?? "unknown"}.`
          : "Sandbox container exited cleanly.";
    await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
      id: "sandbox:wait",
      order: 2,
      title: "Wait for hosted job sandbox",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Hosted agent controller",
      status: waitStatus,
      detail: waitDetail,
      startedAt: sandboxWaitStartedAt,
      finishedAt: new Date().toISOString(),
    }));
    if (sandboxResult.cancelled || await isCancellationRequested(jobId)) {
      await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
        id: "sandbox:launch",
        order: 1,
        title: "Launch hosted job sandbox",
        stepType: "stage",
        agentId: execution.job.agentId,
        agentName: "Hosted agent controller",
        status: "failed",
        detail: "Sandbox execution cancelled.",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }));
      return await finalizeAnalysisJobFailure(jobId, {
        status: "cancelled",
        failureReason: "Cancelled during hosted sandbox execution.",
        logs: controllerLogs,
        artifacts: rawLogArtifacts,
      });
    }

    if (sandboxResult.timedOut) {
      await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
        id: "sandbox:launch",
        order: 1,
        title: "Launch hosted job sandbox",
        stepType: "stage",
        agentId: execution.job.agentId,
        agentName: "Hosted agent controller",
        status: "failed",
        detail: `Sandbox timed out after ${config.sandboxTimeoutMs}ms.`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }));
      return await finalizeAnalysisJobFailure(jobId, {
        failureReason: `Sandbox timed out after ${config.sandboxTimeoutMs}ms.`,
        logs: controllerLogs,
        artifacts: rawLogArtifacts,
      });
    }

    if (sandboxResult.exitCode !== 0) {
      await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
        id: "sandbox:launch",
        order: 1,
        title: "Launch hosted job sandbox",
        stepType: "stage",
        agentId: execution.job.agentId,
        agentName: "Hosted agent controller",
        status: "failed",
        detail: `Sandbox exited with code ${sandboxResult.exitCode ?? "unknown"}.`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }));
      return await finalizeAnalysisJobFailure(jobId, {
        failureReason: readSandboxFailure(stderrPath, `Sandbox exited with code ${sandboxResult.exitCode ?? "unknown"}.`),
        logs: controllerLogs,
        artifacts: rawLogArtifacts,
      });
    }

    const resultPath = path.join(tempDir, "result.json");
    if (!fs.existsSync(resultPath)) {
      throw new Error(`Sandbox completed without producing ${resultPath}.`);
    }
    const sandboxResponse = agentSandboxResultSchema.parse(JSON.parse(fs.readFileSync(resultPath, "utf8"))) satisfies AgentSandboxResult;
    await syncCodexAuth(authPath, execution);
    const missingLogs = sandboxResponse.envelope.logs.filter(log => !streamedLogIds.has(log.id));
    await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
      id: "sandbox:collect",
      order: 3,
      title: "Collect sandbox result bundle",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Hosted agent controller",
      status: "succeeded",
      detail: sandboxResponse.status,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }));

    if (sandboxResponse.status !== "succeeded" || sandboxResponse.envelope.job.status !== "succeeded") {
      const persistedArtifacts = await uploadLocalArtifactsToObjectStorage({
        jobId,
        reportId: sandboxResponse.envelope.report?.id ?? execution.parentReport?.id ?? null,
        baseDir: tempDir,
        artifacts: sandboxResponse.envelope.artifacts,
        keyPrefix: sandboxResponse.envelope.job.jobKind === "remediation"
          ? `jobs/${jobId}/remediation`
          : `jobs/${jobId}`,
      });
      return await finalizeAnalysisJobFailure(jobId, {
        status: sandboxResponse.envelope.job.status === "cancelled" ? "cancelled" : "failed",
        failureReason: sandboxResponse.failureReason ?? sandboxResponse.envelope.job.failureReason ?? "Sandbox execution failed.",
        logs: [...controllerLogs, ...missingLogs],
        artifacts: [...persistedArtifacts, ...rawLogArtifacts],
      });
    }

    if (sandboxResponse.envelope.job.jobKind === "remediation") {
      const changeset = sandboxResponse.envelope.job.changeset;
      if (changeset) {
        await storeRemediationJobChangeset(jobId, changeset);
        if (execution.job.parentReportId) {
          await storeReportChangeset(execution.job.parentReportId, changeset, jobId);
        }
      }
      const persistedArtifacts = await uploadLocalArtifactsToObjectStorage({
        jobId,
        reportId: execution.parentReport?.id ?? null,
        baseDir: tempDir,
        artifacts: sandboxResponse.envelope.artifacts,
        keyPrefix: `jobs/${jobId}/remediation`,
      });
      await appendLog(jobId, controllerLogs, "artifact", `Persisted ${persistedArtifacts.length} remediation artifact(s).`, "info");
      return await finalizeAnalysisJobSuccess(jobId, {
        ...sandboxResponse.envelope,
        logs: missingLogs,
        artifacts: persistedArtifacts,
      }, [...persistedArtifacts, ...rawLogArtifacts]);
    }

    const activeLearnables = await replaceSourceLearnables(
      execution.workspace.id,
      execution.source.id,
      jobId,
      sandboxResponse.learnables,
    );
    await appendLog(jobId, controllerLogs, "learnables", `Stored ${activeLearnables.length} learnable(s) for future runs.`, "info");
    const mirroredEnvelope = await mirrorArtifactsToObjectStorage(storageConfig(), {
      ...sandboxResponse.envelope,
      logs: missingLogs,
    }, tempDir);
    await appendLog(
      jobId,
      controllerLogs,
      "artifact",
      `Persisted ${mirroredEnvelope.report?.artifacts.length ?? 0} artifact reference(s) for audit review.`,
      "info",
    );
    return await finalizeAnalysisJobSuccess(jobId, {
      ...mirroredEnvelope,
      logs: missingLogs,
    }, rawLogArtifacts);
  } catch (error) {
    const rawLogArtifacts = await uploadSandboxRawLogs(jobId, stdoutPath, stderrPath);
    await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
      id: "sandbox:wait",
      order: 2,
      title: "Wait for hosted job sandbox",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Hosted agent controller",
      status: "failed",
      detail: error instanceof Error ? error.message : "Sandbox launch failed.",
      startedAt: sandboxWaitStartedAt,
      finishedAt: new Date().toISOString(),
    }));
    await appendExecutionStepLog(jobId, controllerLogs, buildExecutionStep({
      id: "sandbox:launch",
      order: 1,
      title: "Launch hosted job sandbox",
      stepType: "stage",
      agentId: execution.job.agentId,
      agentName: "Hosted agent controller",
      status: "failed",
      detail: error instanceof Error ? error.message : "Sandbox launch failed.",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }));
    return await finalizeAnalysisJobFailure(jobId, {
      failureReason: error instanceof Error ? error.message : "Sandbox launch failed.",
      logs: controllerLogs,
      artifacts: rawLogArtifacts,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function executeAgentSandboxRequest(
  request: z.infer<typeof agentSandboxRequestSchema>,
): Promise<AgentSandboxResult> {
  const parsedRequest = agentSandboxRequestSchema.parse(request);
  const execution = createExecutionRecordFromSnapshot(parsedRequest.execution);
  const queueMessageId = parsedRequest.execution.job.queueMessageId ?? "sandbox";
  return await withExecutionRuntime({
    appendLogs: async () => undefined,
    emitLog: log => {
      process.stdout.write(`${sandboxLogPrefix}${JSON.stringify(log)}\n`);
    },
    isCancellationRequested: async () => false,
    syncCodexAuth: async () => undefined,
  }, async () => {
    const coreResult = parsedRequest.execution.job.jobKind === "remediation"
      ? await executeRemediationJobCore({ execution, snapshot: parsedRequest.execution }, queueMessageId)
      : await executeAuditJobCore({ execution, snapshot: parsedRequest.execution }, queueMessageId);
    const learnedAt = new Date().toISOString();
    const learnableSeeds: LearnableSeed[] = "learnables" in coreResult && Array.isArray(coreResult.learnables)
      ? coreResult.learnables as LearnableSeed[]
      : [];
    const learnables = learnableSeeds.length > 0
      ? learnableSeeds.map((learnable: LearnableSeed, index: number) => ({
          id: createId("learnable"),
          workspaceId: execution.workspace.id,
          sourceId: execution.source.id,
          statement: learnable.statement,
          category: learnable.category,
          evidence: learnable.evidence ?? [],
          learnedFromJobId: execution.job.id,
          order: learnable.order ?? index,
          active: true,
          createdAt: learnedAt,
          updatedAt: learnedAt,
        }))
      : [];
    return agentSandboxResultSchema.parse({
      schemaVersion: "speclens.agent-sandbox-result.v1",
      status: coreResult.envelope.job.status,
      failureReason: coreResult.envelope.job.failureReason,
      envelope: coreResult.envelope,
      learnables,
    });
  });
}

function shouldUseInProcessSandboxTestHarness(): boolean {
  // API unit tests start the queue consumer without a Docker daemon or sandbox image.
  // The production controller path remains Docker-only and fails on sandbox launch errors.
  return process.env.NODE_ENV === "test" && process.env.AI_WORKER_TEST_IN_PROCESS_SANDBOX === "true";
}

async function executeClaimedAgentJobForTest(
  execution: JobExecutionRecord,
  queueMessageId: string,
): Promise<JobEnvelope> {
  return execution.job.jobKind === "remediation"
    ? await runRemediationJob(execution, queueMessageId)
    : await runAgentJob(execution, queueMessageId);
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
    const result = shouldUseInProcessSandboxTestHarness()
      ? await executeClaimedAgentJobForTest(execution, queueMessageId)
      : await executeHostedAgentJobInSandbox(execution, queueMessageId);
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

export function buildArtifactAnalysisForTest(
  handoff: StandardizedHandoff | null,
  artifacts: AnalysisReport["artifacts"],
) {
  return buildArtifactAnalysis(handoff, artifacts);
}

export function extractFindingPathsForTest(evidence: string[], explicitPaths: string[] = []): string[] {
  return extractFindingPaths(evidence, explicitPaths);
}

export function buildFindingEvidenceRefsForTest(evidence: string[], explicitPaths: string[] = []): EvidenceReference[] {
  const paths = extractFindingPaths(evidence, explicitPaths);
  return buildFindingEvidenceRefs(evidence, paths);
}

export function normalizeRoleOutputForTest(raw: unknown, roleId?: string): RoleOutput {
  return normalizeRoleOutput(raw, roleId);
}

function getHealthRequestPath(requestUrl: string | undefined): string {
  try {
    return new URL(requestUrl ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
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
      try {
        const pathname = getHealthRequestPath(request.url);
        if (pathname === "/metrics") {
          response.writeHead(200, { "content-type": getMetricsContentType() });
          response.end(await getMetricsSnapshot());
          return;
        }
        if (pathname === "/ready") {
          try {
            await checkDatabaseHealth();
            await checkQueueHealth();
            const storage = await checkObjectStorageHealth(storageConfig());
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: true, storage }));
          } catch (error) {
            console.warn(JSON.stringify({
              level: "warn",
              scope: "ai-worker.ready",
              error: error instanceof Error ? error.message : "Readiness check failed.",
            }));
            response.writeHead(503, { "content-type": "application/json" });
            response.end(JSON.stringify({
              ok: false,
              error: "Readiness check failed.",
            }));
          }
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, role: "ai-worker", workerId: config.workerId }));
      } catch (error) {
        console.warn(JSON.stringify({
          level: "warn",
          scope: "ai-worker.health",
          error: error instanceof Error ? error.message : "Health endpoint request failed.",
        }));
        if (!response.writableEnded) {
          if (!response.headersSent) {
            response.writeHead(500, { "content-type": "application/json" });
          }
          response.end(JSON.stringify({
            ok: false,
            error: "Health endpoint request failed.",
          }));
        }
      }
    })();
  });

  server.listen(config.healthPort, "0.0.0.0", () => {
    console.log(`[ai-worker] health endpoint listening on http://0.0.0.0:${config.healthPort}`);
  });

  await workAgentJobs(handleAgentJob, { batchSize: config.maxConcurrency });
}

export async function startEmbeddedAgentWorker(): Promise<void> {
  if (embeddedWorkerStarted) {
    return;
  }
  embeddedWorkerStarted = true;
  try {
    const config = loadAiWorkerConfig();
    await initializeDatabase();
    await workAgentJobs(handleAgentJob, { batchSize: config.maxConcurrency });
  } catch (error) {
    embeddedWorkerStarted = false;
    throw error;
  }
}

export function stopEmbeddedAgentWorker(): void {
  embeddedWorkerStarted = false;
}

export default {
  buildArtifactAnalysisForTest,
  buildFindingEvidenceRefsForTest,
  detectPlaywrightPreflightForTest,
  extractFindingPathsForTest,
  normalizeRoleOutputForTest,
  runAgentJobForTest,
  startAgentLoop,
  startEmbeddedAgentWorker,
  stopEmbeddedAgentWorker,
};
