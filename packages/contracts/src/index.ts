import { z } from "zod";

export const licenseEntitlementSchema = z.enum(["free", "pro", "commercial"]);
export type LicenseEntitlement = z.infer<typeof licenseEntitlementSchema>;

export const workspaceRoleSchema = z.enum(["owner", "member"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const roleIdSchema = z.string().min(1);
export type RoleId = z.infer<typeof roleIdSchema>;

export const sourceTypeSchema = z.enum([
  "git-public",
  "github-private",
  "upload-archive",
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const jobStatusSchema = z.enum(["pending", "queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const reportStatusSchema = z.enum(["draft", "ready", "archived"]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const billingProviderSchema = z.enum(["stripe"]);
export type BillingProvider = z.infer<typeof billingProviderSchema>;

export const analysisRuntimeModeSchema = z.enum(["static", "browser"]);
export type AnalysisRuntimeMode = z.infer<typeof analysisRuntimeModeSchema>;

export const jobExecutionPathSchema = z.literal("unified-agent");
export type JobExecutionPath = z.infer<typeof jobExecutionPathSchema>;

export const jobKindSchema = z.enum(["audit", "remediation"]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const auditBundleIdSchema = z.enum(["smoke", "standard", "exhaustive"]);
export type AuditBundleId = z.infer<typeof auditBundleIdSchema>;

export const findingCategorySchema = z.enum([
  "code",
  "architecture",
  "dependency",
  "license",
  "auth",
  "ux",
  "visual",
  "accessibility",
  "copy",
  "navigation",
  "consistency",
  "artifact",
  "docs",
  "ops",
]);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

export const evidenceKindSchema = z.enum([
  "repo-file",
  "manifest",
  "route",
  "selector",
  "screenshot",
  "trace",
  "console",
  "network",
  "runtime-log",
  "test-report",
  "live-url",
  "other",
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const artifactKindSchema = z.enum([
  "artifact",
  "report",
  "screenshot",
  "trace",
  "storage-state",
  "runtime-log",
  "playwright-report",
  "test-results",
  "route-map",
  "component-inventory",
  "remediation-pack",
  "patch-bundle",
  "git-bundle",
  "validation-log",
  "changeset-manifest",
  "pr-summary",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const aiToolCapabilitySchema = z.enum([
  "repo-read",
  "shell-exec",
  "http-fetch",
  "browser-automation",
  "artifact-write",
  "package-install",
  "dev-server",
  "test-exec",
  "auth-state",
]);
export type AiToolCapability = z.infer<typeof aiToolCapabilitySchema>;

export const analysisLogVisibilitySchema = z.enum(["default", "verbose"]);
export type AnalysisLogVisibility = z.infer<typeof analysisLogVisibilitySchema>;

export const aiRoleConsoleVisibilitySchema = z.enum(["normal", "quiet"]);
export type AiRoleConsoleVisibility = z.infer<typeof aiRoleConsoleVisibilitySchema>;

export const aiRoleExecutorKindSchema = z.enum(["codex", "native", "hybrid"]);
export type AiRoleExecutorKind = z.infer<typeof aiRoleExecutorKindSchema>;

export const analysisSectionStatusSchema = z.enum(["ready", "planned", "skipped"]);
export type AnalysisSectionStatus = z.infer<typeof analysisSectionStatusSchema>;

export const workspaceSecretKindSchema = z.enum(["credential-pair", "session-state", "api-token"]);
export type WorkspaceSecretKind = z.infer<typeof workspaceSecretKindSchema>;

export const learnableCategorySchema = z.enum(["runtime", "auth", "playwright", "repo-shape", "ops"]);
export type LearnableCategory = z.infer<typeof learnableCategorySchema>;

export const roleDefinitionSchema = z.object({
  id: roleIdSchema,
  title: z.string(),
  description: z.string().default(""),
  order: z.number().int().nonnegative().default(0),
  dependsOnRoleIds: z.array(roleIdSchema).default([]),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })).default([]),
});
export type RoleDefinition = z.infer<typeof roleDefinitionSchema>;

export const commercialContactInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional(),
  message: z.string().min(1).max(4000),
});
export type CommercialContactInput = z.infer<typeof commercialContactInputSchema>;

export const userSchema = z.object({
  id: z.string(),
  identityProvider: z.string(),
  identitySubject: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable().default(null),
  entitlement: licenseEntitlementSchema.default("free"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().default(null),
  entitlement: licenseEntitlementSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceMembershipSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  role: workspaceRoleSchema,
  createdAt: z.string(),
});
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>;

export const workspaceMemberSummarySchema = workspaceMembershipSchema.extend({
  displayName: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().url().nullable().default(null),
});
export type WorkspaceMemberSummary = z.infer<typeof workspaceMemberSummarySchema>;

export const workspaceSecretSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: workspaceSecretKindSchema,
  valuePreview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceSecret = z.infer<typeof workspaceSecretSchema>;

export const sourceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: sourceTypeSchema,
  displayName: z.string(),
  location: z.string(),
  visibility: z.enum(["public", "private"]),
  verificationStatus: z.enum(["pending", "verified", "failed"]).default("verified"),
  verificationError: z.string().nullable().default(null),
  githubInstallationId: z.string().nullable().default(null),
  uploadObjectKey: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Source = z.infer<typeof sourceSchema>;

export const analysisLogEventSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  level: z.enum(["info", "warn", "error"]),
  scope: z.string(),
  message: z.string(),
  visibility: analysisLogVisibilitySchema.default("default"),
  requestId: z.string().optional(),
  createdAt: z.string(),
});
export type AnalysisLogEvent = z.infer<typeof analysisLogEventSchema>;

export const evidenceReferenceSchema = z.object({
  kind: evidenceKindSchema,
  value: z.string(),
  detail: z.string().nullable().default(null),
  sourcePath: z.string().nullable().default(null),
});
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const artifactReferenceSchema = z.object({
  id: z.string().optional(),
  jobId: z.string().optional(),
  reportId: z.string().nullable().optional(),
  kind: artifactKindSchema.optional().default("artifact"),
  key: z.string(),
  bucket: z.string(),
  region: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  signedUrl: z.string().url().optional(),
  createdAt: z.string().optional(),
});
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const analysisFindingSchema = z.object({
  id: z.string(),
  roleId: roleIdSchema,
  category: findingCategorySchema.default("ops"),
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  message: z.string(),
  suggestion: z.string(),
  evidence: z.array(z.string()).default([]),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
  sourceIds: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  remediationPackIds: z.array(z.string()).default([]),
});
export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;

export const analysisReportSectionSchema = z.object({
  id: z.string(),
  roleId: roleIdSchema,
  title: z.string(),
  status: analysisSectionStatusSchema,
  summary: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type AnalysisReportSection = z.infer<typeof analysisReportSectionSchema>;

export const releaseGateDecisionSchema = z.object({
  status: z.enum(["pass", "warn", "fail"]),
  reason: z.string(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  blockingFindingIds: z.array(z.string()).default([]),
});
export type ReleaseGateDecision = z.infer<typeof releaseGateDecisionSchema>;

export const remediationPackSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  category: findingCategorySchema.default("ops"),
  ownerRoleId: z.string().nullable().default(null),
  findingIds: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  testingNotes: z.array(z.string()).default([]),
});
export type RemediationPack = z.infer<typeof remediationPackSchema>;

export const fixHandoffEntrySchema = z.object({
  remediationPackId: z.string().nullable().default(null),
  title: z.string(),
  summary: z.string(),
  targetFiles: z.array(z.string()).default([]),
  validationCommands: z.array(z.string()).default([]),
  rollbackNotes: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
});
export type FixHandoffEntry = z.infer<typeof fixHandoffEntrySchema>;

export const fixHandoffSchema = z.object({
  entries: z.array(fixHandoffEntrySchema).default([]),
  validationCommands: z.array(z.string()).default([]),
  rollbackNotes: z.array(z.string()).default([]),
});
export type FixHandoff = z.infer<typeof fixHandoffSchema>;

export const remediationStopReasonSchema = z.enum([
  "audit-only-complete",
  "validation-failed",
  "iteration-budget-exhausted",
  "no-further-safe-fixes",
  "remote-pr-not-configured",
]);
export type RemediationStopReason = z.infer<typeof remediationStopReasonSchema>;

export const remediationSelectionModeSchema = z.enum(["auto-priority", "selected-findings"]);
export type RemediationSelectionMode = z.infer<typeof remediationSelectionModeSchema>;

export const remediationOutputModeSchema = z.enum(["changeset", "remote-pr"]);
export type RemediationOutputMode = z.infer<typeof remediationOutputModeSchema>;

export const changesetSummarySchema = z.object({
  branchName: z.string().nullable().default(null),
  baseRef: z.string().default("HEAD"),
  changedFiles: z.array(z.string()).default([]),
  commandsRun: z.array(z.string()).default([]),
  validationCommands: z.array(z.string()).default([]),
  validationPassed: z.boolean().default(false),
  iterationCount: z.number().int().nonnegative().default(0),
  stopReason: remediationStopReasonSchema,
  fixedFindingIds: z.array(z.string()).default([]),
  residualFindingIds: z.array(z.string()).default([]),
  pullInstructions: z.array(z.string()).default([]),
  prUrl: z.string().url().nullable().default(null),
});
export type ChangesetSummary = z.infer<typeof changesetSummarySchema>;

export const gitReferenceSchema = z.object({
  name: z.string(),
  target: z.string().nullable().default(null),
  isHead: z.boolean().default(false),
  isRemote: z.boolean().default(false),
});
export type GitReference = z.infer<typeof gitReferenceSchema>;

export const codeTreeEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["file", "directory"]),
  changed: z.boolean().default(false),
  hasFindings: z.boolean().default(false),
});
export type CodeTreeEntry = z.infer<typeof codeTreeEntrySchema>;

export const gitPullRequestSummarySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  url: z.string().url(),
  headRef: z.string(),
  baseRef: z.string(),
  changedFiles: z.number().int().nonnegative().nullable().default(null),
  mergeable: z.boolean().nullable().default(null),
  updatedAt: z.string(),
});
export type GitPullRequestSummary = z.infer<typeof gitPullRequestSummarySchema>;

export const codeChangesetRecordSchema = z.object({
  jobId: z.string(),
  reportId: z.string().nullable().default(null),
  sourceId: z.string(),
  createdAt: z.string(),
  branchName: z.string().nullable().default(null),
  stopReason: remediationStopReasonSchema,
  changedFiles: z.array(z.string()).default([]),
  validationCommands: z.array(z.string()).default([]),
  validationPassed: z.boolean().default(false),
  pullInstructions: z.array(z.string()).default([]),
  prUrl: z.string().url().nullable().default(null),
});
export type CodeChangesetRecord = z.infer<typeof codeChangesetRecordSchema>;

export const codeReviewSourceOptionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: sourceTypeSchema,
  location: z.string(),
});
export type CodeReviewSourceOption = z.infer<typeof codeReviewSourceOptionSchema>;

export const codeReviewPayloadSchema = z.object({
  workspaceId: z.string(),
  source: codeReviewSourceOptionSchema,
  refs: z.array(gitReferenceSchema).default([]),
  selectedRef: z.string(),
  selectedPath: z.string().nullable().default(null),
  compareRef: z.string().nullable().default(null),
  fileContent: z.string().nullable().default(null),
  diff: z.string().nullable().default(null),
  tree: z.array(codeTreeEntrySchema).default([]),
  findings: z.array(analysisFindingSchema).default([]),
  unattributedFindings: z.array(analysisFindingSchema).default([]),
  remediationPacks: z.array(remediationPackSchema).default([]),
  fixHandoff: fixHandoffSchema.nullable().default(null),
  changesets: z.array(codeChangesetRecordSchema).default([]),
  selectedPullRequest: gitPullRequestSummarySchema.nullable().default(null),
  prSupport: z.enum(["available", "unavailable"]).default("unavailable"),
  activeReportId: z.string().nullable().default(null),
  activeFindingId: z.string().nullable().default(null),
});
export type CodeReviewPayload = z.infer<typeof codeReviewPayloadSchema>;

export const executionAttemptSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["attempted", "succeeded", "skipped", "failed"]),
  detail: z.string().nullable().default(null),
  evidence: z.array(z.string()).default([]),
});
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;

export const executionCoverageSchema = z.object({
  attempted: z.array(executionAttemptSchema).default([]),
  skipped: z.array(executionAttemptSchema).default([]),
});
export type ExecutionCoverage = z.infer<typeof executionCoverageSchema>;

export const surfaceDescriptorSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  kind: z.enum([
    "repo-app",
    "api",
    "docs",
    "admin",
    "public-site",
    "authenticated-site",
    "pricing",
    "legal",
    "live-url",
    "other",
  ]),
  location: z.string().nullable().default(null),
  companion: z.boolean().default(false),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});
export type SurfaceDescriptor = z.infer<typeof surfaceDescriptorSchema>;

export const componentInventorySectionSchema = z.object({
  components: z.array(z.object({
    name: z.string(),
    path: z.string(),
    kind: z.string().nullable().default(null),
  })).default([]),
  duplicateNames: z.array(z.string()).default([]),
  sharedPrimitiveGaps: z.array(z.string()).default([]),
});
export type ComponentInventorySection = z.infer<typeof componentInventorySectionSchema>;

export const copyConsistencySectionSchema = z.object({
  inconsistentTerms: z.array(z.string()).default([]),
  missingTextSurfaces: z.array(z.string()).default([]),
  unclearCtas: z.array(z.string()).default([]),
});
export type CopyConsistencySection = z.infer<typeof copyConsistencySectionSchema>;

export const visualQaSectionSchema = z.object({
  reviewedSurfaces: z.array(z.string()).default([]),
  overlapRisks: z.array(z.string()).default([]),
  hierarchyIssues: z.array(z.string()).default([]),
  readabilityIssues: z.array(z.string()).default([]),
});
export type VisualQaSection = z.infer<typeof visualQaSectionSchema>;

export const uxFrictionSectionSchema = z.object({
  journeys: z.array(z.string()).default([]),
  emptyStateIssues: z.array(z.string()).default([]),
  loadingStateIssues: z.array(z.string()).default([]),
  errorStateIssues: z.array(z.string()).default([]),
  informationArchitectureIssues: z.array(z.string()).default([]),
});
export type UxFrictionSection = z.infer<typeof uxFrictionSectionSchema>;

export const artifactAuditSectionSchema = z.object({
  expectedKinds: z.array(artifactKindSchema).default([]),
  presentKinds: z.array(artifactKindSchema).default([]),
  missingKinds: z.array(artifactKindSchema).default([]),
  invalidArtifacts: z.array(z.string()).default([]),
});
export type ArtifactAuditSection = z.infer<typeof artifactAuditSectionSchema>;

export const capabilityGapSchema = z.object({
  id: z.string(),
  scope: z.enum(["agent", "role", "skill", "runtime", "browser", "artifact", "auth", "ops"]).default("ops"),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  title: z.string(),
  summary: z.string(),
  missingCapabilities: z.array(z.string()).default([]),
  affectedSurfaces: z.array(z.string()).default([]),
  suggestedActions: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
export type CapabilityGap = z.infer<typeof capabilityGapSchema>;

export const artifactAnalysisSchema = z.object({
  expectedKinds: z.array(artifactKindSchema).default([]),
  presentKinds: z.array(artifactKindSchema).default([]),
  missingKinds: z.array(artifactKindSchema).default([]),
  invalidArtifacts: z.array(z.string()).default([]),
  producedCount: z.number().int().nonnegative().default(0),
  producedByKind: z.record(z.string(), z.number().int().nonnegative()).default({}),
  notableArtifacts: z.array(z.object({
    kind: artifactKindSchema,
    key: z.string(),
    mimeType: z.string().nullable().default(null),
  })).default([]),
  summary: z.string().default(""),
});
export type ArtifactAnalysis = z.infer<typeof artifactAnalysisSchema>;

export const qualityDimensionScoreSchema = z.object({
  id: z.enum(["evidence", "execution", "artifacts", "transparency", "capability"]),
  label: z.string(),
  score: z.number().int().min(0).max(100),
  rationale: z.string(),
  evidence: z.array(z.string()).default([]),
});
export type QualityDimensionScore = z.infer<typeof qualityDimensionScoreSchema>;

export const roleQualityScoreSchema = z.object({
  roleId: roleIdSchema,
  title: z.string(),
  status: z.enum(["ready", "planned", "skipped", "missing"]).default("missing"),
  score: z.number().int().min(0).max(100),
  findingCount: z.number().int().nonnegative().default(0),
  rationale: z.string(),
});
export type RoleQualityScore = z.infer<typeof roleQualityScoreSchema>;

export const skillQualityScoreSchema = z.object({
  skillId: z.string(),
  name: z.string(),
  score: z.number().int().min(0).max(100),
  coveredByRoleIds: z.array(roleIdSchema).default([]),
  rationale: z.string(),
});
export type SkillQualityScore = z.infer<typeof skillQualityScoreSchema>;

export const qualityScorecardSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.array(qualityDimensionScoreSchema).default([]),
  roleScores: z.array(roleQualityScoreSchema).default([]),
  skillScores: z.array(skillQualityScoreSchema).default([]),
  warnings: z.array(z.string()).default([]),
});
export type QualityScorecard = z.infer<typeof qualityScorecardSchema>;

export const jobTimingEstimateSchema = z.object({
  queueDurationMs: z.number().int().nonnegative().nullable().default(null),
  runDurationMs: z.number().int().nonnegative().nullable().default(null),
  totalDurationMs: z.number().int().nonnegative().nullable().default(null),
  elapsedMs: z.number().int().nonnegative().default(0),
  estimatedTotalMs: z.number().int().nonnegative().nullable().default(null),
  estimatedRemainingMs: z.number().int().nonnegative().nullable().default(null),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  basis: z.string(),
});
export type JobTimingEstimate = z.infer<typeof jobTimingEstimateSchema>;

export const analysisExecutionStepStatusSchema = z.enum(["pending", "running", "succeeded", "failed", "skipped"]);
export type AnalysisExecutionStepStatus = z.infer<typeof analysisExecutionStepStatusSchema>;

export const analysisExecutionStepSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative().default(0),
  title: z.string(),
  stepType: z.enum(["stage", "role", "executor", "handoff"]).default("role"),
  agentId: z.string().nullable().default(null),
  agentName: z.string().nullable().default(null),
  roleId: z.string().nullable().default(null),
  roleName: z.string().nullable().default(null),
  executorKind: aiRoleExecutorKindSchema.nullable().default(null),
  nativeExecutorId: z.string().nullable().default(null),
  status: analysisExecutionStepStatusSchema,
  detail: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
});
export type AnalysisExecutionStep = z.infer<typeof analysisExecutionStepSchema>;

export const analysisReportSummarySchema = z.object({
  totalFindings: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  auditBundleId: auditBundleIdSchema.default("standard"),
  categoryCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  releaseGateDecision: releaseGateDecisionSchema.nullable().default(null),
  remediationPacks: z.array(remediationPackSchema).default([]),
  fixHandoff: fixHandoffSchema.nullable().default(null),
  changeset: changesetSummarySchema.nullable().default(null),
  latestRemediationJobId: z.string().nullable().default(null),
  executionCoverage: executionCoverageSchema.default({ attempted: [], skipped: [] }),
  qualityScorecard: qualityScorecardSchema.nullable().default(null),
  capabilityGaps: z.array(capabilityGapSchema).default([]),
  artifactAnalysis: artifactAnalysisSchema.nullable().default(null),
  executionSteps: z.array(analysisExecutionStepSchema).default([]),
});
export type AnalysisReportSummary = z.infer<typeof analysisReportSummarySchema>;

export const analysisReportSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  jobId: z.string(),
  status: reportStatusSchema,
  roles: z.array(roleDefinitionSchema).default([]),
  runtimeMode: analysisRuntimeModeSchema,
  title: z.string(),
  summary: analysisReportSummarySchema,
  findings: z.array(analysisFindingSchema),
  sections: z.array(analysisReportSectionSchema).default([]),
  artifacts: z.array(artifactReferenceSchema),
  createdAt: z.string(),
});
export type AnalysisReport = z.infer<typeof analysisReportSchema>;

export const analysisJobSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sourceId: z.string(),
  companionSourceId: z.string().nullable().default(null),
  reportId: z.string().nullable().default(null),
  parentReportId: z.string().nullable().default(null),
  jobKind: jobKindSchema.default("audit"),
  status: jobStatusSchema,
  executionPath: jobExecutionPathSchema.default("unified-agent"),
  agentId: z.string().nullable().default(null),
  queueMessageId: z.string().nullable().default(null),
  claimedRunnerId: z.string().nullable().default(null),
  cancelRequestedAt: z.string().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  sourceType: sourceTypeSchema,
  sourceLocation: z.string(),
  companionSourceType: sourceTypeSchema.nullable().default(null),
  companionSourceLocation: z.string().nullable().default(null),
  roles: z.array(roleIdSchema),
  runtimeMode: analysisRuntimeModeSchema,
  codexAuthScope: z.enum(["user", "workspace", "global"]).nullable().default(null),
  secretRefs: z.array(z.string()).default([]),
  requestedByUserId: z.string(),
  changeset: changesetSummarySchema.nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type AnalysisJob = z.infer<typeof analysisJobSchema>;

export function resolveJobExecutionPath(job: {
  executionPath?: JobExecutionPath | string | null | undefined;
  agentId?: string | null | undefined;
}): JobExecutionPath {
  return job.executionPath === "unified-agent" ? job.executionPath : "unified-agent";
}

export function isCompatibilityJob(job: {
  executionPath?: JobExecutionPath | string | null | undefined;
  agentId?: string | null | undefined;
}): boolean {
  void job;
  return false;
}

export const billingSubscriptionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: billingProviderSchema,
  providerCustomerId: z.string(),
  providerSubscriptionId: z.string(),
  entitlement: licenseEntitlementSchema,
  status: z.enum(["trialing", "active", "past_due", "cancelled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;

export const githubInstallationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  githubInstallationId: z.string(),
  githubAccountLogin: z.string(),
  createdAt: z.string(),
});
export type GithubInstallation = z.infer<typeof githubInstallationSchema>;

export const githubRepositorySchema = z.object({
  id: z.number().int(),
  githubInstallationId: z.string(),
  githubAccountLogin: z.string(),
  name: z.string(),
  fullName: z.string(),
  htmlUrl: z.string().url(),
  cloneUrl: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
});
export type GithubRepository = z.infer<typeof githubRepositorySchema>;

export const pageInfoSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().min(1),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const createWorkspaceSecretInputSchema = z.object({
  name: z.string().min(2),
  kind: workspaceSecretKindSchema,
  value: z.string().min(1),
});
export type CreateWorkspaceSecretInput = z.infer<typeof createWorkspaceSecretInputSchema>;

export const updateWorkspaceSecretInputSchema = z.object({
  name: z.string().min(2),
  kind: workspaceSecretKindSchema,
  value: z.string().min(1),
});
export type UpdateWorkspaceSecretInput = z.infer<typeof updateWorkspaceSecretInputSchema>;

export const createWorkspaceMemberInputSchema = z.object({
  email: z.string().email(),
});
export type CreateWorkspaceMemberInput = z.infer<typeof createWorkspaceMemberInputSchema>;

export const addSourceInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("git-public"),
    displayName: z.string().min(2),
    location: z.string(),
  }),
  z.object({
    type: z.literal("github-private"),
    displayName: z.string().min(2),
    location: z.string(),
    githubInstallationId: z.string().min(1),
  }),
]);
export type AddSourceInput = z.infer<typeof addSourceInputSchema>;

export const updateSourceInputSchema = z.object({
  displayName: z.string().min(2),
});
export type UpdateSourceInput = z.infer<typeof updateSourceInputSchema>;

export const createAnalysisJobInputSchema = z.object({
  sourceId: z.string(),
  companionSourceId: z.string().optional(),
  agentId: z.string().optional(),
  roles: z.array(roleIdSchema).optional(),
  runtimeMode: analysisRuntimeModeSchema.optional(),
  codexAuthScope: z.enum(["user", "workspace", "global"]).optional(),
  secretRefs: z.array(z.string()).optional(),
});
export type CreateAnalysisJobInput = z.infer<typeof createAnalysisJobInputSchema>;

export const createAgentJobInputSchema = z.object({
  sourceId: z.string(),
  companionSourceId: z.string().optional(),
  runtimeMode: analysisRuntimeModeSchema.optional(),
  codexAuthScope: z.enum(["user", "workspace", "global"]).optional(),
  secretRefs: z.array(z.string()).optional(),
});
export type CreateAgentJobInput = z.infer<typeof createAgentJobInputSchema>;

export const queueAnalysisTaskInputSchema = createAgentJobInputSchema.extend({
  agentId: z.string(),
});
export type QueueAnalysisTaskInput = z.infer<typeof queueAnalysisTaskInputSchema>;

export const createRemediationTaskInputSchema = z.object({
  sourceId: z.string(),
  baseRef: z.string().default("HEAD"),
  selectionMode: remediationSelectionModeSchema.default("auto-priority"),
  selectedFindingIds: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(2).default(2),
  outputMode: remediationOutputModeSchema.default("changeset"),
  publishRemote: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.selectionMode === "selected-findings" && value.selectedFindingIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "selectedFindingIds must be provided when selectionMode is selected-findings.",
      path: ["selectedFindingIds"],
    });
  }
});
export type CreateRemediationTaskInput = z.infer<typeof createRemediationTaskInputSchema>;

export const persistedCodexAuthBindingSchema = z.object({
  scope: z.enum(["user", "workspace", "global"]),
  recordId: z.string(),
});
export type PersistedCodexAuthBinding = z.infer<typeof persistedCodexAuthBindingSchema>;

export const persistedRemediationMetadataSchema = z.object({
  reportId: z.string(),
  sourceId: z.string(),
  baseRef: z.string().default("HEAD"),
  selectionMode: remediationSelectionModeSchema.default("auto-priority"),
  selectedFindingIds: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(2).default(2),
  outputMode: remediationOutputModeSchema.default("changeset"),
  publishRemote: z.boolean().default(false),
  changeset: changesetSummarySchema.nullable().default(null),
}).superRefine((value, ctx) => {
  if (value.selectionMode === "selected-findings" && value.selectedFindingIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "selectedFindingIds must be provided when selectionMode is selected-findings.",
      path: ["selectedFindingIds"],
    });
  }
});
export type PersistedRemediationMetadata = z.infer<typeof persistedRemediationMetadataSchema>;

export const jobExecutionMetadataSchema = z.object({
  remediation: persistedRemediationMetadataSchema.nullable().optional(),
  codexAuth: persistedCodexAuthBindingSchema.nullable().optional(),
});
export type JobExecutionMetadata = z.infer<typeof jobExecutionMetadataSchema>;

export const billingCheckoutInputSchema = z.object({
  workspaceId: z.string().optional(),
  plan: z.literal("pro").default("pro"),
});
export type BillingCheckoutInput = z.infer<typeof billingCheckoutInputSchema>;

export const billingPortalSessionInputSchema = z.object({
  workspaceId: z.string().optional(),
});
export type BillingPortalSessionInput = z.infer<typeof billingPortalSessionInputSchema>;

export const billingPortalSessionResponseSchema = z.object({
  manageUrl: z.string().url(),
});
export type BillingPortalSessionResponse = z.infer<typeof billingPortalSessionResponseSchema>;

export const stripeWebhookInputSchema = z.object({
  type: z.enum(["checkout.session.completed", "customer.subscription.deleted", "customer.subscription.updated"]),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  subscriptionId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.string().optional(),
  eventId: z.string().optional(),
});
export type StripeWebhookInput = z.infer<typeof stripeWebhookInputSchema>;

export const githubInstallQuerySchema = z.object({
  workspaceId: z.string().min(1),
});
export type GithubInstallQuery = z.infer<typeof githubInstallQuerySchema>;

export const githubInstallIntentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  targetAppUrl: z.string().url(),
  requestedByUserId: z.string(),
  nonce: z.string(),
  expiresAt: z.string(),
  consumedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type GithubInstallIntent = z.infer<typeof githubInstallIntentSchema>;

export const githubInstallUrlResponseSchema = z.object({
  installUrl: z.string().url(),
  state: z.string(),
  expiresAt: z.string(),
});
export type GithubInstallUrlResponse = z.infer<typeof githubInstallUrlResponseSchema>;

export const githubLinkInstallationInputSchema = z.object({
  state: z.string().min(1),
  installationId: z.string().min(1),
});
export type GithubLinkInstallationInput = z.infer<typeof githubLinkInstallationInputSchema>;

export const reportExportResponseSchema = z.object({
  artifact: artifactReferenceSchema,
  downloadUrl: z.string(),
});
export type ReportExportResponse = z.infer<typeof reportExportResponseSchema>;

export const githubWebhookInputSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["created", "deleted"]),
  installationId: z.string(),
  accountLogin: z.string(),
});
export type GithubWebhookInput = z.infer<typeof githubWebhookInputSchema>;

export const githubWebhookTargetSchema = z.object({
  id: z.string(),
  environmentLabel: z.string(),
  appUrl: z.string().url(),
  webhookForwardUrl: z.string().url(),
  kind: z.enum(["prod", "local"]),
  status: z.enum(["active", "inactive"]),
  expiresAt: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GithubWebhookTarget = z.infer<typeof githubWebhookTargetSchema>;

export const githubGatewayRegisterInputSchema = z.object({
  environmentLabel: z.string().min(1),
  appUrl: z.string().url(),
  webhookForwardUrl: z.string().url(),
  kind: z.enum(["prod", "local"]),
});
export type GithubGatewayRegisterInput = z.infer<typeof githubGatewayRegisterInputSchema>;

export const jobEnvelopeSchema = z.object({
  job: analysisJobSchema,
  logs: z.array(analysisLogEventSchema).default([]),
  report: analysisReportSchema.nullable().default(null),
  artifacts: z.array(artifactReferenceSchema).default([]),
  timing: jobTimingEstimateSchema,
  qualityScorecard: qualityScorecardSchema.nullable().default(null),
  capabilityGaps: z.array(capabilityGapSchema).default([]),
  artifactAnalysis: artifactAnalysisSchema.nullable().default(null),
  executionSteps: z.array(analysisExecutionStepSchema).default([]),
});
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

export const runnerJobPayloadSchema = z.object({
  jobId: z.string(),
});
export type RunnerJobPayload = z.infer<typeof runnerJobPayloadSchema>;

export const agentJobPayloadSchema = z.object({
  jobId: z.string(),
});
export type AgentJobPayload = z.infer<typeof agentJobPayloadSchema>;

export const aiSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  instructions: z.string(),
  toolCapabilities: z.array(aiToolCapabilitySchema).default([]),
  order: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiSkill = z.infer<typeof aiSkillSchema>;

export const aiRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  prompt: z.string(),
  order: z.number().int().nonnegative().default(0),
  consoleVisibility: aiRoleConsoleVisibilitySchema.default("normal"),
  executorKind: aiRoleExecutorKindSchema.default("codex"),
  nativeExecutorId: z.string().nullable().default(null),
  dependsOnRoleIds: z.array(z.string()).default([]),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiRole = z.infer<typeof aiRoleSchema>;

export const aiAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  order: z.number().int().nonnegative().default(0),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    order: z.number().int().nonnegative().default(0),
  })).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiAgent = z.infer<typeof aiAgentSchema>;

export const aiAgentExecutionPlanSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  instructions: z.string(),
  toolCapabilities: z.array(aiToolCapabilitySchema).default([]),
  order: z.number().int().nonnegative().default(0),
});
export type AiAgentExecutionPlanSkill = z.infer<typeof aiAgentExecutionPlanSkillSchema>;

export const aiAgentExecutionPlanRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  prompt: z.string(),
  order: z.number().int().nonnegative().default(0),
  consoleVisibility: aiRoleConsoleVisibilitySchema.default("normal"),
  executorKind: aiRoleExecutorKindSchema.default("codex"),
  nativeExecutorId: z.string().nullable().default(null),
  dependsOnRoleIds: z.array(roleIdSchema).default([]),
  skills: z.array(aiAgentExecutionPlanSkillSchema).default([]),
});
export type AiAgentExecutionPlanRole = z.infer<typeof aiAgentExecutionPlanRoleSchema>;

export const aiAgentExecutionPlanSchema = z.object({
  agent: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().default(null),
  }),
  roles: z.array(aiAgentExecutionPlanRoleSchema).default([]),
});
export type AiAgentExecutionPlan = z.infer<typeof aiAgentExecutionPlanSchema>;

export const createAiSkillInputSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  instructions: z.string().min(2),
  toolCapabilities: z.array(aiToolCapabilitySchema).optional(),
  order: z.number().int().nonnegative().optional(),
});
export type CreateAiSkillInput = z.infer<typeof createAiSkillInputSchema>;

export const analysisTaskSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  roleCount: z.number().int().nonnegative().default(0),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().default(null),
    order: z.number().int().nonnegative().default(0),
    executorKind: aiRoleExecutorKindSchema.nullable().default(null),
    nativeExecutorId: z.string().nullable().default(null),
  })).default([]),
  skillNames: z.array(z.string()).default([]),
  toolCapabilities: z.array(aiToolCapabilitySchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AnalysisTask = z.infer<typeof analysisTaskSchema>;

export const createAiRoleInputSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  prompt: z.string().min(2),
  order: z.number().int().nonnegative().optional(),
  consoleVisibility: aiRoleConsoleVisibilitySchema.optional(),
  executorKind: aiRoleExecutorKindSchema.optional(),
  nativeExecutorId: z.string().nullable().optional(),
  dependsOnRoleIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
});
export type CreateAiRoleInput = z.infer<typeof createAiRoleInputSchema>;

export const analysisExecutionStepEventPrefix = "__speclens_step__";

export function encodeAnalysisExecutionStepEvent(step: AnalysisExecutionStep): string {
  return `${analysisExecutionStepEventPrefix}${JSON.stringify(analysisExecutionStepSchema.parse(step))}`;
}

export function parseAnalysisExecutionStepEvent(message: string): AnalysisExecutionStep | null {
  if (!message.startsWith(analysisExecutionStepEventPrefix)) {
    return null;
  }
  try {
    return analysisExecutionStepSchema.parse(JSON.parse(message.slice(analysisExecutionStepEventPrefix.length)));
  } catch {
    return null;
  }
}

export function collectAnalysisExecutionSteps(logs: Pick<AnalysisLogEvent, "message" | "createdAt">[]): AnalysisExecutionStep[] {
  const steps = new Map<string, AnalysisExecutionStep>();
  for (const log of logs) {
    const step = parseAnalysisExecutionStepEvent(log.message);
    if (!step) {
      continue;
    }
    const previous = steps.get(step.id);
    steps.set(step.id, previous
      ? analysisExecutionStepSchema.parse({
          ...previous,
          ...step,
          order: step.order ?? previous.order,
          startedAt: step.startedAt ?? previous.startedAt,
          finishedAt: step.finishedAt ?? previous.finishedAt,
          durationMs: step.durationMs ?? previous.durationMs,
          detail: step.detail ?? previous.detail,
        })
      : step);
  }
  return [...steps.values()].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    const leftStartedAt = left.startedAt ?? "";
    const rightStartedAt = right.startedAt ?? "";
    return leftStartedAt.localeCompare(rightStartedAt);
  });
}

export const learnableSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sourceId: z.string(),
  statement: z.string(),
  category: learnableCategorySchema,
  evidence: z.array(z.string()).default([]),
  learnedFromJobId: z.string(),
  order: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Learnable = z.infer<typeof learnableSchema>;

export const analysisLogListResponseSchema = z.object({
  logs: z.array(analysisLogEventSchema).default([]),
});
export type AnalysisLogListResponse = z.infer<typeof analysisLogListResponseSchema>;

export const learnableListResponseSchema = z.object({
  learnables: z.array(learnableSchema).default([]),
});
export type LearnableListResponse = z.infer<typeof learnableListResponseSchema>;

export const standardizedExecutionCommandSchema = z.object({
  label: z.string(),
  command: z.string(),
  workingDirectory: z.string().nullable().default(null),
  purpose: z.string().nullable().default(null),
});
export type StandardizedExecutionCommand = z.infer<typeof standardizedExecutionCommandSchema>;

export const standardizedAgentBlockerSchema = z.object({
  id: z.string().optional(),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  title: z.string(),
  message: z.string(),
  evidence: z.array(z.string()).default([]),
});
export type StandardizedAgentBlocker = z.infer<typeof standardizedAgentBlockerSchema>;

export const standardizedAgentRecommendationSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  action: z.string(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});
export type StandardizedAgentRecommendation = z.infer<typeof standardizedAgentRecommendationSchema>;

export const standardizedArtifactExpectationSchema = z.object({
  kind: artifactKindSchema,
  label: z.string(),
  required: z.boolean().default(true),
  source: z.string().nullable().default(null),
});
export type StandardizedArtifactExpectation = z.infer<typeof standardizedArtifactExpectationSchema>;

export const standardizedRuntimeHandoffSchema = z.object({
  installCommands: z.array(standardizedExecutionCommandSchema).default([]),
  buildCommands: z.array(standardizedExecutionCommandSchema).default([]),
  startCommands: z.array(standardizedExecutionCommandSchema).default([]),
  verificationCommands: z.array(standardizedExecutionCommandSchema).default([]),
  packageManagers: z.array(z.string()).default([]),
  targets: z.array(z.object({
    label: z.string(),
    kind: z.string().nullable().default(null),
    workingDirectory: z.string().nullable().default(null),
    startCommand: z.string().nullable().default(null),
    baseUrl: z.string().nullable().default(null),
    healthUrls: z.array(z.string()).default([]),
    framework: z.string().nullable().default(null),
  })).default([]),
  workingDirectories: z.array(z.string()).default([]),
  serviceDependencies: z.array(z.string()).default([]),
  envFiles: z.array(z.string()).default([]),
  ports: z.array(z.union([z.number().int().nonnegative(), z.string()])).default([]),
  baseUrls: z.array(z.string()).default([]),
});
export type StandardizedRuntimeHandoff = z.infer<typeof standardizedRuntimeHandoffSchema>;

export const standardizedAuthSurfaceSchema = z.object({
  strategy: z.string().nullable().default(null),
  loginRoutes: z.array(z.string()).default([]),
  callbackRoutes: z.array(z.string()).default([]),
  protectedRoutes: z.array(z.string()).default([]),
  secretRefs: z.array(z.string()).default([]),
  bootstrapSteps: z.array(z.string()).default([]),
  userActions: z.array(z.string()).default([]),
});
export type StandardizedAuthSurface = z.infer<typeof standardizedAuthSurfaceSchema>;

export const standardizedAuthHandoffSchema = z.object({
  frontend: standardizedAuthSurfaceSchema,
  api: standardizedAuthSurfaceSchema,
});
export type StandardizedAuthHandoff = z.infer<typeof standardizedAuthHandoffSchema>;

export const standardizedPlaywrightHandoffSchema = z.object({
  readiness: z.enum(["ready", "partial", "blocked"]).default("partial"),
  present: z.boolean().default(false),
  detected: z.boolean().default(false),
  runnable: z.boolean().default(false),
  passed: z.boolean().default(false),
  suiteStatus: z.enum(["not-detected", "detected", "runnable", "passed", "failed", "blocked"]).default("not-detected"),
  packageManager: z.string().nullable().default(null),
  configPaths: z.array(z.string()).default([]),
  commands: z.array(standardizedExecutionCommandSchema).default([]),
  setupCommands: z.array(standardizedExecutionCommandSchema).default([]),
  workingDirectories: z.array(z.string()).default([]),
  baseUrlStrategy: z.string().nullable().default(null),
  authStrategy: z.string().nullable().default(null),
  testTargets: z.array(z.string()).default([]),
  navigationTargets: z.array(z.object({
    path: z.string(),
    purpose: z.string().nullable().default(null),
    requiresAuth: z.boolean().default(false),
    source: z.enum(["router", "tests", "docs", "inferred"]).default("inferred"),
  })).default([]),
  journeys: z.array(z.object({
    title: z.string(),
    steps: z.array(z.string()).default([]),
    requiresAuth: z.boolean().default(false),
    priority: z.enum(["high", "medium", "low"]).default("medium"),
    successSignals: z.array(z.string()).default([]),
  })).default([]),
  assertions: z.array(z.string()).default([]),
  reporters: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  coverageGaps: z.array(z.string()).default([]),
});
export type StandardizedPlaywrightHandoff = z.infer<typeof standardizedPlaywrightHandoffSchema>;

export const standardizedAgentHandoffSchema = z.object({
  schemaVersion: z.literal("speclens.agent-handoff.v1"),
  generatedBy: z.object({
    agentId: z.string(),
    agentName: z.string(),
    roleId: z.string(),
    roleName: z.string(),
  }),
  runtime: standardizedRuntimeHandoffSchema,
  auth: standardizedAuthHandoffSchema,
  playwright: standardizedPlaywrightHandoffSchema,
  auditBundleId: auditBundleIdSchema.default("standard"),
  detectedSurfaces: z.array(surfaceDescriptorSchema).default([]),
  executionCoverage: executionCoverageSchema.default({ attempted: [], skipped: [] }),
  artifactExpectations: z.array(standardizedArtifactExpectationSchema).default([]),
  blockers: z.array(standardizedAgentBlockerSchema).default([]),
  recommendations: z.array(standardizedAgentRecommendationSchema).default([]),
  remediationPacks: z.array(remediationPackSchema).default([]),
  fixHandoff: fixHandoffSchema.nullable().default(null),
  releaseGateDecision: releaseGateDecisionSchema.nullable().default(null),
});
export type StandardizedAgentHandoff = z.infer<typeof standardizedAgentHandoffSchema>;

const executionFailureBlockerPattern = /\b(failed|failure|timed out|timeout|missing api key|could not|unable to)\b/i;

export function getStandardizedAgentHandoffFromReport(report: Pick<AnalysisReport, "sections">): StandardizedAgentHandoff {
  const handoffSection = report.sections.find(section => section.title === "Standardized JSON handoff");
  if (!handoffSection) {
    throw new Error('Report is missing the "Standardized JSON handoff" section.');
  }
  return standardizedAgentHandoffSchema.parse(handoffSection.data.standardizedOutput);
}

export function isExecutionFailureBlocker(blocker: Pick<StandardizedAgentBlocker, "title" | "message">): boolean {
  return executionFailureBlockerPattern.test(`${blocker.title} ${blocker.message}`);
}

export function assertGoodAgentReport(report: Pick<AnalysisReport, "sections">): StandardizedAgentHandoff {
  const handoff = getStandardizedAgentHandoffFromReport(report);
  const executionFailureBlockers = handoff.blockers.filter(isExecutionFailureBlocker);
  if (executionFailureBlockers.length > 0) {
    throw new Error(
      `Report contains execution-failure blockers: ${executionFailureBlockers.map(blocker => blocker.title).join(", ")}`,
    );
  }
  return handoff;
}

export const createAiAgentInputSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
  roleIds: z.array(z.string()).optional(),
});
export type CreateAiAgentInput = z.infer<typeof createAiAgentInputSchema>;

export const codexAuthStatusSchema = z.object({
  scope: z.enum(["user", "workspace", "global"]).default("global"),
  status: z.enum(["unauthenticated", "pending", "ready", "error"]),
  authMode: z.enum(["chatgpt", "api-key"]).nullable().default(null),
  accountId: z.string().nullable().default(null),
  userCode: z.string().nullable().default(null),
  verificationUri: z.string().nullable().default(null),
  verificationUriComplete: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  intervalSeconds: z.number().int().nonnegative().nullable().default(null),
  lastError: z.string().nullable().default(null),
  lastRefresh: z.string().nullable().default(null),
  disabled: z.boolean().default(false),
});
export type CodexAuthStatus = z.infer<typeof codexAuthStatusSchema>;

export const codexAuthOptionSchema = z.object({
  scope: z.enum(["user", "workspace", "global"]),
  label: z.string(),
  description: z.string(),
  status: codexAuthStatusSchema,
  available: z.boolean().default(false),
  selectable: z.boolean().default(false),
});
export type CodexAuthOption = z.infer<typeof codexAuthOptionSchema>;

export const codexAuthSelectionSchema = z.object({
  selectedScope: z.enum(["user", "workspace", "global"]).nullable().default(null),
  options: z.array(codexAuthOptionSchema).default([]),
});
export type CodexAuthSelection = z.infer<typeof codexAuthSelectionSchema>;

export const sandboxSecretSchema = z.object({
  id: z.string(),
  kind: workspaceSecretKindSchema,
  value: z.string(),
  name: z.string().optional(),
});
export type SandboxSecret = z.infer<typeof sandboxSecretSchema>;

export const agentSandboxExecutionSnapshotSchema = z.object({
  job: analysisJobSchema,
  workspace: workspaceSchema,
  source: sourceSchema,
  companionSource: sourceSchema.nullable().default(null),
  parentReport: analysisReportSchema.nullable().default(null),
  metadata: jobExecutionMetadataSchema.default({}),
  secrets: z.array(sandboxSecretSchema).default([]),
  plan: aiAgentExecutionPlanSchema,
  roleDefinitions: z.array(roleDefinitionSchema).default([]),
  learnables: z.array(learnableSchema).default([]),
  codexAuthPath: z.string().nullable().default(null),
  outputRoot: z.string(),
  timeoutMs: z.number().int().positive().nullable().default(null),
});
export type AgentSandboxExecutionSnapshot = z.infer<typeof agentSandboxExecutionSnapshotSchema>;

export const agentSandboxRequestSchema = z.object({
  schemaVersion: z.literal("speclens.agent-sandbox.v1"),
  execution: agentSandboxExecutionSnapshotSchema,
});
export type AgentSandboxRequest = z.infer<typeof agentSandboxRequestSchema>;

export const agentSandboxResultSchema = z.object({
  schemaVersion: z.literal("speclens.agent-sandbox-result.v1"),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  failureReason: z.string().nullable().default(null),
  envelope: jobEnvelopeSchema,
  learnables: z.array(learnableSchema).default([]),
});
export type AgentSandboxResult = z.infer<typeof agentSandboxResultSchema>;
