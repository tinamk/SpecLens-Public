import { z } from "zod";

export const licenseEntitlementSchema = z.enum(["free", "pro", "commercial"]);
export type LicenseEntitlement = z.infer<typeof licenseEntitlementSchema>;

export const workspaceRoleSchema = z.enum(["owner", "member"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const sourceTypeSchema = z.enum(["github-public", "github-private", "upload-archive", "workspace"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const reportStatusSchema = z.enum(["draft", "ready", "archived"]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const billingProviderSchema = z.enum(["stripe"]);
export type BillingProvider = z.infer<typeof billingProviderSchema>;

export const presetIdSchema = z.enum(["auto", "generic", "node-repo", "svelte-web", "tagtwo", "client-legacy"]);
export type PresetId = z.infer<typeof presetIdSchema>;

export const capabilityIdSchema = z.enum([
  "repo-inventory",
  "spec-check",
  "spec-generation",
  "component-inventory",
  "ui-text-inventory",
  "ui-label-scan",
  "consistency-check",
  "license-policy",
  "browser-self-check",
  "visual-inspection",
  "interaction-test",
  "chaos-advisor",
  "results-dashboard",
]);
export type CapabilityId = z.infer<typeof capabilityIdSchema>;

export const analysisRuntimeModeSchema = z.enum(["static", "browser"]);
export type AnalysisRuntimeMode = z.infer<typeof analysisRuntimeModeSchema>;

export const analysisSectionStatusSchema = z.enum(["ready", "planned", "skipped"]);
export type AnalysisSectionStatus = z.infer<typeof analysisSectionStatusSchema>;

export const workspaceSecretKindSchema = z.enum(["credential-pair", "session-state", "api-token"]);
export type WorkspaceSecretKind = z.infer<typeof workspaceSecretKindSchema>;

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
  createdAt: z.string(),
});
export type AnalysisLogEvent = z.infer<typeof analysisLogEventSchema>;

export const artifactReferenceSchema = z.object({
  key: z.string(),
  bucket: z.string(),
  region: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  signedUrl: z.string().url().optional(),
});
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const analysisFindingSchema = z.object({
  id: z.string(),
  capability: capabilityIdSchema,
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  message: z.string(),
  suggestion: z.string(),
  evidence: z.array(z.string()).default([]),
});
export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;

export const analysisReportSectionSchema = z.object({
  id: z.string(),
  capability: capabilityIdSchema,
  title: z.string(),
  status: analysisSectionStatusSchema,
  summary: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type AnalysisReportSection = z.infer<typeof analysisReportSectionSchema>;

export const analysisReportSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  jobId: z.string(),
  status: reportStatusSchema,
  preset: presetIdSchema,
  capabilities: z.array(capabilityIdSchema),
  runtimeMode: analysisRuntimeModeSchema,
  title: z.string(),
  summary: z.object({
    totalFindings: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
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
  reportId: z.string().nullable().default(null),
  status: jobStatusSchema,
  sourceType: sourceTypeSchema,
  sourceLocation: z.string(),
  preset: presetIdSchema,
  capabilities: z.array(capabilityIdSchema),
  runtimeMode: analysisRuntimeModeSchema,
  secretRefs: z.array(z.string()).default([]),
  requestedByUserId: z.string(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type AnalysisJob = z.infer<typeof analysisJobSchema>;

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

export const addSourceInputSchema = z.object({
  type: sourceTypeSchema,
  displayName: z.string().min(2),
  location: z.string(),
  visibility: z.enum(["public", "private"]).default("public"),
});
export type AddSourceInput = z.infer<typeof addSourceInputSchema>;

export const createAnalysisJobInputSchema = z.object({
  sourceId: z.string(),
  preset: presetIdSchema.default("auto"),
  capabilities: z.array(capabilityIdSchema).optional(),
  runtimeMode: analysisRuntimeModeSchema.optional(),
  secretRefs: z.array(z.string()).optional(),
});
export type CreateAnalysisJobInput = z.infer<typeof createAnalysisJobInputSchema>;

export const billingCheckoutInputSchema = z.object({
  workspaceId: z.string().optional(),
  plan: z.literal("pro").default("pro"),
});
export type BillingCheckoutInput = z.infer<typeof billingCheckoutInputSchema>;

export const stripeWebhookInputSchema = z.object({
  type: z.enum(["checkout.session.completed", "customer.subscription.deleted"]),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  subscriptionId: z.string().optional(),
});
export type StripeWebhookInput = z.infer<typeof stripeWebhookInputSchema>;

export const githubInstallQuerySchema = z.object({
  workspaceId: z.string().min(1),
});
export type GithubInstallQuery = z.infer<typeof githubInstallQuerySchema>;

export const githubWebhookInputSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["created", "deleted"]),
  installationId: z.string(),
  accountLogin: z.string(),
});
export type GithubWebhookInput = z.infer<typeof githubWebhookInputSchema>;

export const jobEnvelopeSchema = z.object({
  job: analysisJobSchema,
  logs: z.array(analysisLogEventSchema).default([]),
  report: analysisReportSchema.nullable().default(null),
});
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
