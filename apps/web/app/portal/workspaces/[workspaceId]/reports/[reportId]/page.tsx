import type {
  AnalysisExecutionStep,
  AnalysisFinding,
  AnalysisReport,
  AnalysisReportSection,
  ArtifactAnalysis,
  ArtifactReference,
  CapabilityGap,
  QualityDimensionScore,
  RemediationPack,
} from "@speclens/contracts";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { DataChipList, DataCommandList, DataPath, DataValue } from "../../../../../../components/data-visuals";
import { ReportExportAction, ReportRemediationForm } from "../../../../../../components/portal-actions";
import { WorkspaceRouteState } from "../../../../../../components/workspace-route-state";
import { ApiResponseError, getCurrentUser, getHostedJob, getHostedReport, getWorkspaceConsole } from "../../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  canManageWorkspaceRemediation,
  getReleaseGateTagClass,
  getChangesetBranchName,
  getJobStatusTagClass,
  getWorkspaceReportFindingCodeHref,
  getWorkspaceReportFindingsEmptyState,
  getWorkspaceReportFindingsEmptyStateTagClass,
  getWorkspaceReportRemediationCodeHref,
  getWorkspaceReportRemediationSummary,
  getWorkspaceReportSectionsEmptyState,
  getWorkspaceRunHref,
  isWorkspaceScopedReportPageContext,
} from "../../../../../../lib/portal";

type SourceOption = {
  id: string;
  displayName: string;
  type: string;
};

type ArtifactView = {
  artifact: ArtifactReference;
  href: string;
  index: number;
  name: string;
  kindLabel: string;
};

type ExecutionStepGroup = {
  childSteps: AnalysisExecutionStep[];
  step: AnalysisExecutionStep;
};

type RemediationActionView = {
  external?: boolean;
  href: Route | string;
  label: string;
};

type RemediationStageView = {
  detail: string;
  href?: Route;
  id: string;
  label: string;
  metric: string;
  statusLabel: string;
  tagClass: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
};

type RemediationCommandView = {
  commandDetail: string;
  commandTagClass: string;
  commandTagLabel: string;
  commandTitle: string;
  fixedFindingCount: number;
  handoffEntryCount: number;
  highPackCount: number;
  plannedFindingCount: number;
  primaryAction: RemediationActionView | null;
  residualFindingCount: number;
  secondaryAction: RemediationActionView | null;
  stages: RemediationStageView[];
};

type InsightCardView = {
  detail: string;
  href?: Route;
  id: string;
  label: string;
  metric: string;
  tagClass: string;
  title: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
};

type WorkflowRoleView = {
  detail: string;
  durationLabel: string;
  id: string;
  status: AnalysisExecutionStep["status"];
  tagClass: string;
  title: string;
};

type WorkflowCheckpointView = {
  detail: string;
  durationLabel: string;
  id: string;
  kindLabel: string;
  status: AnalysisExecutionStep["status"];
  tagClass: string;
  title: string;
};

type AgentWorkflowView = {
  checkpoints: WorkflowCheckpointView[];
  completedCount: number;
  executorCount: number;
  handoffCount: number;
  overview: string;
  progressPercent: number;
  roleCount: number;
  slowestRoles: WorkflowRoleView[];
  statusCounts: Record<AnalysisExecutionStep["status"], number>;
};

type FindingClusterView = {
  blockingCount: number;
  category: string;
  count: number;
  domId: string | null;
  high: number;
  low: number;
  medium: number;
  roleNames: string[];
  title: string;
};

type FindingTriageView = {
  blockingCount: number;
  categoryClusters: FindingClusterView[];
  investigationOrder: Array<{
    domId: string;
    evidenceCount: number;
    severity: AnalysisFinding["severity"];
    suggestion: string;
    title: string;
  }>;
  pathCount: number;
  sourceLinkedCount: number;
};

type FindingActionView = {
  domId: string;
  evidenceCount: number;
  packLabel: string | null;
  packTagClass: string;
  pathPreview: string | null;
  roleName: string;
  severity: AnalysisFinding["severity"];
  suggestion: string;
  title: string;
};

type FindingActionQueueView = {
  plannedCount: number;
  rows: FindingActionView[];
  totalFindingCount: number;
  urgentCount: number;
};

type ArtifactTrustView = {
  invalidArtifacts: string[];
  missingKinds: string[];
  notableArtifacts: Array<{
    href: string | null;
    key: string;
    kind: string;
    name: string;
  }>;
  presentKinds: string[];
  producedByKind: Array<{
    count: number;
    kind: string;
  }>;
  statusDetail: string;
  statusLabel: string;
  tagClass: string;
};

type RoleResultView = {
  blockingCount: number;
  detail: string;
  findingCount: number;
  findingHref: string | null;
  highCount: number;
  id: string;
  score: number | null;
  sectionCount: number;
  sectionHref: string | null;
  status: string;
  tagClass: string;
  title: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
};

type SkillCoverageView = {
  coveredRoles: string[];
  id: string;
  name: string;
  rationale: string;
  score: number;
  tagClass: string;
  tone: "danger" | "neutral" | "success" | "warning";
};

type RoleHealthView = {
  attentionRoles: RoleResultView[];
  averageScore: number | null;
  productiveRoles: RoleResultView[];
  readyCount: number;
  roleCount: number;
  skillCount: number;
  weakestSkills: SkillCoverageView[];
};

type ReviewPathStepView = {
  detail: string;
  href: string;
  id: string;
  label: string;
  metric: string;
  tagClass: string;
  title: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
};

type CockpitActionView = {
  external?: boolean;
  href: Route | string;
  label: string;
};

type ReportDiagnosticView = {
  detail: string;
  id: string;
  metric: string;
  tagClass: string;
  title: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
};

type BrowserQaEvidenceView = {
  authLabel: string;
  blockedReason: string | null;
  confidence: string;
  interactionCount: number;
  method: string;
  pageCount: number;
  protectedRouteCount: number;
  queuedProtectedRouteCount: number;
  skippedProtectedRouteCount: number;
  tagClass: string;
};

const severityRank: Record<AnalysisFinding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function getTagTone(tone: string): string {
  if (tone === "high" || tone === "fail" || tone === "failed" || tone === "error") return "tag tag--danger";
  if (tone === "medium" || tone === "warn" || tone === "warning" || tone === "degraded" || tone === "skipped") return "tag tag--warning";
  if (tone === "low" || tone === "ok" || tone === "pass" || tone === "ready" || tone === "succeeded") return "tag tag--success";
  if (tone === "running" || tone === "pending") return "tag tag--info";
  return "tag tag--neutral";
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} bytes`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationMs: number | null | undefined): string {
  if (!durationMs) return "n/a";
  const seconds = Math.round(durationMs / 1000);
  if (seconds === 0) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) return "n/a";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatKeyLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase());
}

function formatCategoryCounts(categoryCounts: Record<string, number>): string {
  const entries = Object.entries(categoryCounts);
  if (entries.length === 0) return "No categories";
  return entries.map(([category, count]) => `${formatKeyLabel(category)} ${count}`).join(", ");
}

function getArtifactHref(jobId: string, artifactIndex: number): string {
  return `/api/proxy/api/jobs/${jobId}/artifacts/${artifactIndex}`;
}

function getArtifactName(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
}

function getArtifactKindLabel(artifact: ArtifactReference): string {
  return formatKeyLabel(artifact.kind ?? "artifact");
}

function formatArtifactSummary(artifactCount: number, artifactAnalysis: ArtifactAnalysis | null): string {
  const artifactLabel = `${artifactCount} artifact record${artifactCount === 1 ? "" : "s"}`;
  if (!artifactAnalysis) return `${artifactLabel} available.`;
  if (artifactAnalysis.producedCount === artifactCount) return artifactAnalysis.summary;
  return `${artifactAnalysis.summary} ${artifactLabel} are available in the gallery and downloads.`;
}

function isImageArtifact(artifact: ArtifactReference): boolean {
  return artifact.mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(artifact.key);
}

function toStableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function getFindingDomId(finding: AnalysisFinding, index: number): string {
  return `${toStableId(finding.id)}-${index + 1}`;
}

function sortExecutionSteps(steps: AnalysisExecutionStep[]): AnalysisExecutionStep[] {
  return [...steps].sort((left, right) => (
    left.order - right.order
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id)
  ));
}

function groupExecutionSteps(steps: AnalysisExecutionStep[]): ExecutionStepGroup[] {
  const sortedSteps = sortExecutionSteps(steps);
  const groups: ExecutionStepGroup[] = [];
  const groupsByRole = new Map<string, ExecutionStepGroup>();

  for (const step of sortedSteps) {
    if (step.stepType === "executor") continue;
    const group = { childSteps: [], step };
    groups.push(group);
    if (step.roleId) {
      groupsByRole.set(step.roleId, group);
    }
  }

  for (const step of sortedSteps) {
    if (step.stepType !== "executor") continue;
    const parent = step.roleId ? groupsByRole.get(step.roleId) : null;
    if (parent) {
      parent.childSteps.push(step);
    } else {
      groups.push({ childSteps: [], step });
    }
  }

  return groups;
}

function getExecutorLabel(step: AnalysisExecutionStep): string {
  if (step.executorKind) return `${formatKeyLabel(step.executorKind)} executor`;
  if (step.nativeExecutorId) return formatKeyLabel(step.nativeExecutorId);
  return step.title;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPrimitiveValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (isRecord(value)) return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  return "value";
}

function summarizeDataValue(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return "No items";
    const sample = value.slice(0, 3).map(item => formatPrimitiveValue(item)).join(", ");
    return `${value.length} item${value.length === 1 ? "" : "s"} · ${sample}`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "No fields";
    return `${keys.length} field${keys.length === 1 ? "" : "s"} · ${keys.slice(0, 5).map(formatKeyLabel).join(", ")}`;
  }
  return typeof value === "string" ? <DataValue value={value} /> : formatPrimitiveValue(value);
}

function getRecordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecordBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function getRecordCount(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function buildBrowserQaEvidenceView(section: AnalysisReportSection): BrowserQaEvidenceView | null {
  if (section.title !== "Browser QA execution") {
    return null;
  }

  const authCoverage = isRecord(section.data.authCoverage) ? section.data.authCoverage : null;
  const pageCount = Array.isArray(section.data.pages) ? section.data.pages.length : 0;
  const interactionCount = Array.isArray(section.data.interactions) ? section.data.interactions.length : 0;
  const authenticated = getRecordBoolean(authCoverage, "authenticated") ?? getRecordBoolean(section.data, "authenticated") ?? false;
  const protectedRouteCount = getRecordCount(authCoverage, "protectedRouteCount");
  const queuedProtectedRouteCount = getRecordCount(authCoverage, "queuedProtectedRouteCount");
  const skippedProtectedRouteCount = getRecordCount(authCoverage, "skippedProtectedRouteCount");
  const method = getRecordString(authCoverage, "method") ?? (authenticated ? "browser-state" : "none");
  const confidence = getRecordString(authCoverage, "confidence") ?? (authenticated ? "medium" : "low");
  const blockedReason = getRecordString(authCoverage, "blockedReason");
  const authLabel = authenticated
    ? "Authenticated"
    : protectedRouteCount > 0
      ? "Auth blocked"
      : "Anonymous";

  return {
    authLabel,
    blockedReason,
    confidence,
    interactionCount,
    method,
    pageCount,
    protectedRouteCount,
    queuedProtectedRouteCount,
    skippedProtectedRouteCount,
    tagClass: authenticated ? "tag tag--success" : protectedRouteCount > 0 ? "tag tag--warning" : "tag tag--neutral",
  };
}

function renderBrowserQaEvidence(section: AnalysisReportSection): ReactNode {
  const evidence = buildBrowserQaEvidenceView(section);
  if (!evidence) {
    return null;
  }

  const protectedMetric = evidence.protectedRouteCount > 0
    ? `${evidence.queuedProtectedRouteCount}/${evidence.protectedRouteCount}`
    : "none";

  return (
    <div className="report-browser-evidence" data-testid={`report-browser-auth-coverage-${section.id}`}>
      <div className="report-coverage-grid">
        <div>
          <span className="report-summary-card__label">Auth state</span>
          <strong>{evidence.authLabel}</strong>
          <span className={evidence.tagClass}>{evidence.method}</span>
        </div>
        <div>
          <span className="report-summary-card__label">Protected targets</span>
          <strong>{protectedMetric}</strong>
          <span className={evidence.skippedProtectedRouteCount > 0 ? "tag tag--warning" : "tag tag--success"}>
            {evidence.skippedProtectedRouteCount} skipped
          </span>
        </div>
        <div>
          <span className="report-summary-card__label">Pages</span>
          <strong>{evidence.pageCount}</strong>
          <span className="tag tag--neutral">{evidence.interactionCount} interactions</span>
        </div>
        <div>
          <span className="report-summary-card__label">Confidence</span>
          <strong>{formatKeyLabel(evidence.confidence)}</strong>
          <span className={getTagTone(evidence.confidence === "high" ? "pass" : evidence.confidence === "medium" ? "warn" : "low")}>browser</span>
        </div>
      </div>
      {evidence.blockedReason ? (
        <p className="subtle-note" data-testid={`report-browser-auth-blocked-${section.id}`}>{evidence.blockedReason}</p>
      ) : null}
    </div>
  );
}

function renderStructuredData(section: AnalysisReportSection): ReactNode {
  const entries = Object.entries(section.data);
  if (entries.length === 0) {
    return null;
  }

  return (
    <>
      {renderBrowserQaEvidence(section)}
      <dl className="report-data-digest" data-testid={`report-data-digest-${section.id}`}>
        {entries.slice(0, 6).map(([key, value]) => (
          <div className="report-data-digest__row" key={key}>
            <dt>{formatKeyLabel(key)}</dt>
            <dd>{summarizeDataValue(value)}</dd>
          </div>
        ))}
      </dl>
      <details className="report-raw-details">
        <summary>Structured payload</summary>
        <pre className="data-preview">{JSON.stringify(section.data, null, 2)}</pre>
      </details>
    </>
  );
}

function renderScoreBar(score: number, label: string, detail: ReactNode, testId?: string): ReactNode {
  return (
    <article className="report-score-row" data-testid={testId} key={testId ?? label}>
      <div className="report-score-row__header">
        <strong>{label}</strong>
        <span className={getTagTone(score >= 80 ? "pass" : score >= 50 ? "warn" : "fail")}>{score}</span>
      </div>
      <div className="report-score-track" aria-hidden="true">
        <span style={{ width: `${score}%` }} />
      </div>
      <p>{detail}</p>
    </article>
  );
}

function renderQualityDimension(dimension: QualityDimensionScore): ReactNode {
  return renderScoreBar(dimension.score, dimension.label, dimension.rationale, `report-quality-dimension-${dimension.id}`);
}

function renderExecutionStep(group: ExecutionStepGroup): ReactNode {
  const { childSteps, step } = group;
  const duration = formatDuration(step.durationMs);
  return (
    <article className={`report-timeline-row report-timeline-row--${step.status}`} data-testid={`report-execution-step-${toStableId(step.id)}`} key={step.id}>
      <div className="report-timeline-row__marker" aria-hidden="true" />
      <div className="report-timeline-row__body">
        <div className="report-timeline-row__header">
          <div className="report-timeline-row__main">
            <strong>{step.title}</strong>
            <p>
              {step.agentName ?? step.agentId ?? "Hosted agent"}
              {step.roleName ? ` · ${step.roleName}` : ""}
              {step.executorKind ? ` · ${step.executorKind}` : ""}
            </p>
          </div>
          <div className="report-timeline-row__meta">
            <span className="tag tag--neutral">{formatKeyLabel(step.stepType)}</span>
            <span className={getTagTone(step.status)}>{step.status}</span>
            {duration === "n/a" ? null : <span className="report-duration-chip">{duration}</span>}
          </div>
        </div>
        {step.detail ? <p>{step.detail}</p> : null}
        {childSteps.length > 0 ? (
          <div className="report-executor-stack" data-testid={`report-execution-substeps-${toStableId(step.id)}`}>
            {childSteps.map(childStep => {
              const childDuration = formatDuration(childStep.durationMs);
              return (
                <div className="report-executor-row" data-testid={`report-execution-substep-${toStableId(childStep.id)}`} key={childStep.id}>
                  <span className="report-executor-row__marker" aria-hidden="true" />
                  <div className="report-executor-row__copy">
                    <strong>{getExecutorLabel(childStep)}</strong>
                    {childStep.detail ? <p>{childStep.detail}</p> : null}
                  </div>
                  <div className="report-executor-row__meta">
                    <span className={getTagTone(childStep.status)}>{childStep.status}</span>
                    {childDuration === "n/a" ? null : <span className="report-duration-chip">{childDuration}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function renderCapabilityGap(gap: CapabilityGap): ReactNode {
  return (
    <article className="report-gap-row" data-testid={`report-capability-gap-${toStableId(gap.id)}`} key={gap.id}>
      <div className="report-gap-row__header">
        <strong>{gap.title}</strong>
        <span className={getTagTone(gap.severity)}>{gap.severity}</span>
      </div>
      <p>{gap.summary}</p>
      {gap.suggestedActions.length > 0 ? (
        <ul className="report-compact-list">
          {gap.suggestedActions.map(action => <li key={action}>{action}</li>)}
        </ul>
      ) : null}
    </article>
  );
}

function renderRemediationPack(pack: RemediationPack): ReactNode {
  return (
    <article className="report-pack-row" data-testid={`report-remediation-pack-${pack.id}`} key={pack.id}>
      <div className="report-pack-row__header">
        <strong>{pack.title}</strong>
        <span className={getTagTone(pack.priority)}>{pack.priority}</span>
      </div>
      <p>{pack.summary}</p>
      {pack.actions.length > 0 ? (
        <ul className="report-compact-list">
          {pack.actions.map(action => <li key={action}>{action}</li>)}
        </ul>
      ) : null}
      {pack.testingNotes.length > 0 ? (
        <p className="subtle-note">Validation: {pack.testingNotes.join(" ")}</p>
      ) : null}
    </article>
  );
}

function sortFindings(findings: AnalysisFinding[], blockingFindingIds: Set<string>): AnalysisFinding[] {
  return [...findings].sort((left, right) => {
    const blockingDelta = Number(blockingFindingIds.has(right.id)) - Number(blockingFindingIds.has(left.id));
    if (blockingDelta !== 0) return blockingDelta;
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    if (severityDelta !== 0) return severityDelta;
    return left.title.localeCompare(right.title);
  });
}

function buildArtifactViews(artifacts: ArtifactReference[], jobId: string): ArtifactView[] {
  return artifacts.map((artifact, index) => ({
    artifact,
    href: getArtifactHref(jobId, index),
    index,
    name: getArtifactName(artifact.key),
    kindLabel: getArtifactKindLabel(artifact),
  }));
}

function groupArtifactViews(artifacts: ArtifactView[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const view of artifacts) {
    counts.set(view.kindLabel, (counts.get(view.kindLabel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

function getInsightTone(tone: InsightCardView["tone"]): string {
  if (tone === "danger") return "report-insight-card report-insight-card--danger";
  if (tone === "warning") return "report-insight-card report-insight-card--warning";
  if (tone === "success") return "report-insight-card report-insight-card--success";
  if (tone === "info") return "report-insight-card report-insight-card--info";
  return "report-insight-card";
}

function getWorkspaceCodeReviewHref(input: {
  baseRef?: string | null;
  branchName?: string | null;
  sourceId: string;
  workspaceId: string;
}): Route {
  const params = new URLSearchParams({ sourceId: input.sourceId });
  if (input.branchName) {
    params.set("ref", input.branchName);
    params.set("compare", input.baseRef?.trim() ? input.baseRef : "HEAD");
  }
  return `/portal/workspaces/${input.workspaceId}/code?${params.toString()}` as Route;
}

function getFindingDisplayKey(finding: AnalysisFinding): string {
  return [
    finding.title.trim().toLowerCase(),
    finding.suggestion.trim().toLowerCase(),
  ].join("::");
}

function dedupeFindingsForDisplay(findings: AnalysisFinding[], limit: number): AnalysisFinding[] {
  const seen = new Set<string>();
  const unique: AnalysisFinding[] = [];
  for (const finding of findings) {
    const key = getFindingDisplayKey(finding);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(finding);
    if (unique.length >= limit) {
      return unique;
    }
  }
  return unique;
}

function buildReportDiagnostics(report: AnalysisReport): ReportDiagnosticView[] {
  const findings = report.findings;
  if (findings.length === 0) {
    return [{
      id: "clear",
      title: "Report shape is simple",
      metric: "0 findings",
      detail: "No finding list needs clustering or deduplication.",
      tagClass: "tag tag--success",
      tone: "success",
    }];
  }

  const diagnostics: ReportDiagnosticView[] = [];
  const pathLinkedCount = findings.filter(finding => finding.paths.length > 0).length;
  const evidenceRefCount = findings.filter(finding => finding.evidenceRefs.length > 0).length;
  const categoryEntries = Object.entries(report.summary.categoryCounts);
  const dominantCategory = categoryEntries.sort((left, right) => right[1] - left[1])[0] ?? null;
  const duplicateTitles = Object.entries(findings.reduce<Record<string, number>>((accumulator, finding) => {
    const key = finding.title.trim().toLowerCase();
    if (key) {
      accumulator[key] = (accumulator[key] ?? 0) + 1;
    }
    return accumulator;
  }, {})).filter(([, count]) => count >= 3).sort((left, right) => right[1] - left[1]);

  if (dominantCategory && dominantCategory[1] / findings.length >= 0.8 && findings.length >= 8) {
    diagnostics.push({
      id: "category-collapse",
      title: "Categories are too broad",
      metric: `${dominantCategory[1]}/${findings.length}`,
      detail: `${formatKeyLabel(dominantCategory[0])} contains nearly every finding, so the triage board groups by role when that is more useful.`,
      tagClass: "tag tag--warning",
      tone: "warning",
    });
  }

  if (pathLinkedCount === 0) {
    diagnostics.push({
      id: "pathless-findings",
      title: "Findings are not path-linked",
      metric: "0 paths",
      detail: "The report can explain issues, but most findings cannot jump directly to a file or route yet.",
      tagClass: "tag tag--warning",
      tone: "warning",
    });
  } else if (pathLinkedCount / findings.length < 0.5) {
    diagnostics.push({
      id: "partial-paths",
      title: "Path coverage is partial",
      metric: `${pathLinkedCount}/${findings.length}`,
      detail: "Some findings can open code directly, but the report still needs better file/route anchoring.",
      tagClass: "tag tag--warning",
      tone: "warning",
    });
  }

  if (duplicateTitles.length > 0) {
    const [title, count] = duplicateTitles[0]!;
    diagnostics.push({
      id: "duplicate-findings",
      title: "Generic findings repeat",
      metric: `${count}x`,
      detail: `${count} findings share "${title}". The top lists dedupe repeated titles so reviewers see unique problems first.`,
      tagClass: "tag tag--warning",
      tone: "warning",
    });
  }

  if (evidenceRefCount === 0) {
    diagnostics.push({
      id: "evidence-refs",
      title: "Evidence is text-only",
      metric: "0 refs",
      detail: "The report has evidence strings, but no structured evidence references. Artifacts still provide the proof trail.",
      tagClass: "tag tag--info",
      tone: "info",
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      id: "healthy",
      title: "Report shape is reviewable",
      metric: "ready",
      detail: "Categories, paths, and duplicate titles are within normal review thresholds.",
      tagClass: "tag tag--success",
      tone: "success",
    });
  }

  return diagnostics.slice(0, 4);
}

function getRemediationStatusTone(status: string | null): RemediationStageView["tone"] {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "pending" || status === "queued" || status === "running") return "warning";
  if (status === "cancelled") return "neutral";
  return "neutral";
}

function buildInsightCards(input: {
  analysisJobHref: Route | null;
  artifactAnalysis: ArtifactAnalysis | null;
  blockingFindings: AnalysisFinding[];
  highlightedFindings: AnalysisFinding[];
  latestRemediationJobId?: string | null;
  latestRemediationJobStatus?: string | null;
  qualityScorecard: AnalysisReport["summary"]["qualityScorecard"];
  remediationBranchName?: string | null;
  remediationSourceId: string;
  report: AnalysisReport;
  workspaceId: string;
}): InsightCardView[] {
  const { report } = input;
  const gateStatus = report.summary.releaseGateDecision?.status ?? null;
  const weakestDimension = input.qualityScorecard?.dimensions
    .slice()
    .sort((left, right) => left.score - right.score)[0] ?? null;
  const topFinding = input.blockingFindings[0] ?? input.highlightedFindings[0] ?? null;
  const changeset = report.summary.changeset;
  const remediationJobHref = input.latestRemediationJobId
    ? `/portal/workspaces/${input.workspaceId}/runs/${input.latestRemediationJobId}` as Route
    : null;
  const changesetHref = changeset
    ? getWorkspaceCodeReviewHref({
        workspaceId: input.workspaceId,
        sourceId: input.remediationSourceId,
        branchName: input.remediationBranchName ?? null,
        baseRef: changeset.baseRef,
      })
    : null;
  const artifactIssueCount = (input.artifactAnalysis?.missingKinds.length ?? 0) + (input.artifactAnalysis?.invalidArtifacts.length ?? 0);
  const capabilityGap = report.summary.capabilityGaps[0] ?? null;

  let nextAction: InsightCardView;
  if (changeset?.prUrl) {
    nextAction = {
      id: "next-action",
      title: "Review the pull request",
      label: "Next action",
      metric: "PR ready",
      detail: "A remediation PR is linked. Use the report as the evidence trail while reviewing the diff.",
      tagClass: "tag tag--success",
      tone: "success",
      href: changeset.prUrl as Route,
    };
  } else if (changeset) {
    nextAction = {
      id: "next-action",
      title: changeset.validationPassed ? "Review the generated changeset" : "Inspect failed validation",
      label: "Next action",
      metric: `${changeset.changedFiles.length} file${changeset.changedFiles.length === 1 ? "" : "s"}`,
      detail: changeset.validationPassed
        ? "The patch is reviewable. Open code review before publishing or applying it."
        : "Validation did not pass. Inspect the remediation run and patch artifacts before promoting it.",
      tagClass: changeset.validationPassed ? "tag tag--success" : "tag tag--warning",
      tone: changeset.validationPassed ? "success" : "warning",
      ...(changesetHref ? { href: changesetHref } : {}),
    };
  } else if (remediationJobHref && (input.latestRemediationJobStatus === "queued" || input.latestRemediationJobStatus === "pending" || input.latestRemediationJobStatus === "running")) {
    nextAction = {
      id: "next-action",
      title: "Follow the remediation run",
      label: "Next action",
      metric: input.latestRemediationJobStatus,
      detail: "A fix run is already active. Watch logs, artifacts, and changeset generation from the run detail.",
      tagClass: getJobStatusTagClass(input.latestRemediationJobStatus),
      tone: "warning",
      href: remediationJobHref,
    };
  } else if (report.summary.remediationPacks.length > 0) {
    nextAction = {
      id: "next-action",
      title: "Queue auto-priority remediation",
      label: "Next action",
      metric: `${report.summary.remediationPacks.length} pack${report.summary.remediationPacks.length === 1 ? "" : "s"}`,
      detail: "The report already contains fix-ready packs. Start with one bounded changeset and validate it before applying.",
      tagClass: "tag tag--info",
      tone: "info",
    };
  } else {
    nextAction = {
      id: "next-action",
      title: report.summary.totalFindings > 0 ? "Triage findings into fix packs" : "No immediate fix run",
      label: "Next action",
      metric: report.summary.totalFindings > 0 ? "Triage" : "Clear",
      detail: report.summary.totalFindings > 0
        ? "The report has findings but no structured remediation pack. Re-run with remediation planning or triage manually."
        : "No findings require action from this report.",
      tagClass: report.summary.totalFindings > 0 ? "tag tag--warning" : "tag tag--success",
      tone: report.summary.totalFindings > 0 ? "warning" : "success",
    };
  }

  return [
    {
      id: "decision",
      title: gateStatus === "fail" ? "Release is blocked" : gateStatus === "warn" ? "Release needs review" : "Release signal is passing",
      label: "Decision",
      metric: gateStatus ?? "n/a",
      detail: report.summary.releaseGateDecision?.reason ?? "No release gate decision was recorded.",
      tagClass: getReleaseGateTagClass(gateStatus),
      tone: gateStatus === "fail" ? "danger" : gateStatus === "warn" ? "warning" : "success",
      ...(input.analysisJobHref ? { href: input.analysisJobHref } : {}),
    },
    {
      id: "top-signal",
      title: topFinding ? topFinding.title : "No priority finding",
      label: "Top signal",
      metric: topFinding ? topFinding.severity : "none",
      detail: topFinding ? topFinding.message : "The report did not surface a blocking or high-severity finding.",
      tagClass: topFinding ? getTagTone(topFinding.severity) : "tag tag--success",
      tone: topFinding?.severity === "high" ? "danger" : topFinding ? "warning" : "success",
    },
    {
      id: "weakest-dimension",
      title: weakestDimension ? weakestDimension.label : "No scorecard dimension",
      label: "Weakest dimension",
      metric: weakestDimension ? String(weakestDimension.score) : "n/a",
      detail: weakestDimension?.rationale ?? "No quality scorecard was emitted for this report.",
      tagClass: weakestDimension ? getTagTone(weakestDimension.score >= 80 ? "pass" : weakestDimension.score >= 50 ? "warn" : "fail") : "tag tag--neutral",
      tone: weakestDimension ? weakestDimension.score >= 80 ? "success" : weakestDimension.score >= 50 ? "warning" : "danger" : "neutral",
    },
    {
      id: "evidence",
      title: artifactIssueCount > 0 ? "Evidence needs attention" : "Evidence bundle is complete",
      label: "Evidence",
      metric: `${report.artifacts.length} artifact${report.artifacts.length === 1 ? "" : "s"}`,
      detail: artifactIssueCount > 0
        ? `${input.artifactAnalysis?.missingKinds.length ?? 0} expected artifact kind${(input.artifactAnalysis?.missingKinds.length ?? 0) === 1 ? "" : "s"} missing and ${input.artifactAnalysis?.invalidArtifacts.length ?? 0} invalid artifact${(input.artifactAnalysis?.invalidArtifacts.length ?? 0) === 1 ? "" : "s"} recorded.`
        : input.artifactAnalysis?.summary ?? "Artifacts are available for review.",
      tagClass: artifactIssueCount > 0 ? "tag tag--warning" : "tag tag--success",
      tone: artifactIssueCount > 0 ? "warning" : "success",
    },
    {
      id: "capability",
      title: capabilityGap ? capabilityGap.title : "No capability gap",
      label: "Capability",
      metric: `${report.summary.capabilityGaps.length} gap${report.summary.capabilityGaps.length === 1 ? "" : "s"}`,
      detail: capabilityGap?.summary ?? "No capability gaps were recorded.",
      tagClass: capabilityGap ? getTagTone(capabilityGap.severity) : "tag tag--success",
      tone: capabilityGap?.severity === "high" ? "danger" : capabilityGap ? "warning" : "success",
    },
    nextAction,
  ];
}

function buildAgentWorkflowView(executionSteps: AnalysisExecutionStep[]): AgentWorkflowView {
  const statusCounts: AgentWorkflowView["statusCounts"] = {
    failed: 0,
    pending: 0,
    running: 0,
    skipped: 0,
    succeeded: 0,
  };
  for (const step of executionSteps) {
    statusCounts[step.status] += 1;
  }
  const roleSteps = executionSteps.filter(step => step.stepType === "role");
  const completedCount = executionSteps.filter(step => step.status === "succeeded" || step.status === "failed" || step.status === "skipped").length;
  const progressPercent = executionSteps.length > 0 ? Math.round((completedCount / executionSteps.length) * 100) : 0;
  const slowestRoles = roleSteps
    .filter(step => typeof step.durationMs === "number")
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 5)
    .map(step => ({
      id: step.id,
      title: step.roleName ?? step.title,
      status: step.status,
      tagClass: getTagTone(step.status),
      durationLabel: formatDuration(step.durationMs),
      detail: step.detail ?? `${step.agentName ?? step.agentId ?? "Hosted agent"} role execution.`,
    }));
  const checkpoints = executionSteps
    .filter(step => step.stepType !== "role" || step.status !== "pending")
    .slice(0, 36)
    .map(step => ({
      detail: step.detail ?? `${step.agentName ?? step.agentId ?? "Hosted agent"} ${step.stepType} checkpoint.`,
      durationLabel: formatDuration(step.durationMs),
      id: step.id,
      kindLabel: formatKeyLabel(step.stepType),
      status: step.status,
      tagClass: getTagTone(step.status),
      title: step.roleName ?? step.title,
    }) satisfies WorkflowCheckpointView);

  return {
    checkpoints,
    completedCount,
    executorCount: executionSteps.filter(step => step.stepType === "executor").length,
    handoffCount: executionSteps.filter(step => step.stepType === "handoff").length,
    overview: executionSteps.length > 0
      ? `${completedCount}/${executionSteps.length} checkpoints reached. ${statusCounts.failed} failed, ${statusCounts.running} running, ${statusCounts.pending} pending.`
      : "No execution checkpoints were recorded.",
    progressPercent,
    roleCount: roleSteps.length,
    slowestRoles,
    statusCounts,
  };
}

function buildFindingTriageView(input: {
  blockingFindingIds: Set<string>;
  getRoleTitle: (roleId: string) => string;
  sortedFindings: AnalysisFinding[];
}): FindingTriageView {
  const clusters = new Map<string, FindingClusterView>();
  const paths = new Set<string>();
  let sourceLinkedCount = 0;
  const rawCategoryCounts = input.sortedFindings.reduce<Record<string, number>>((accumulator, finding) => {
    accumulator[finding.category] = (accumulator[finding.category] ?? 0) + 1;
    return accumulator;
  }, {});
  const dominantCategory = Object.entries(rawCategoryCounts)
    .sort((left, right) => right[1] - left[1])[0] ?? null;
  const clusterByRole = input.sortedFindings.length >= 8
    && dominantCategory !== null
    && dominantCategory[1] / input.sortedFindings.length >= 0.8;

  input.sortedFindings.forEach((finding, index) => {
    for (const path of finding.paths) {
      paths.add(path);
    }
    if (finding.sourceIds.length > 0) {
      sourceLinkedCount += 1;
    }

    const category = clusterByRole
      ? input.getRoleTitle(finding.roleId)
      : formatKeyLabel(finding.category);
    const existing = clusters.get(category) ?? {
      blockingCount: 0,
      category,
      count: 0,
      domId: null,
      high: 0,
      low: 0,
      medium: 0,
      roleNames: [],
      title: finding.title,
    };
    existing.count += 1;
    existing[finding.severity] += 1;
    if (input.blockingFindingIds.has(finding.id)) {
      existing.blockingCount += 1;
    }
    if (!existing.domId) {
      existing.domId = getFindingDomId(finding, index);
      existing.title = finding.title;
    }
    const roleName = input.getRoleTitle(finding.roleId);
    if (!existing.roleNames.includes(roleName)) {
      existing.roleNames.push(roleName);
    }
    clusters.set(category, existing);
  });

  const categoryClusters = [...clusters.values()]
    .sort((left, right) => (
      right.blockingCount - left.blockingCount
      || right.high - left.high
      || right.count - left.count
      || left.category.localeCompare(right.category)
    ))
    .slice(0, 6);
  const seenInvestigationKeys = new Set<string>();
  const investigationFindings: Array<{ finding: AnalysisFinding; index: number }> = [];
  input.sortedFindings.forEach((finding, index) => {
    const key = getFindingDisplayKey(finding);
    if (seenInvestigationKeys.has(key)) {
      return;
    }
    seenInvestigationKeys.add(key);
    investigationFindings.push({ finding, index });
  });

  return {
    blockingCount: input.sortedFindings.filter(finding => input.blockingFindingIds.has(finding.id)).length,
    categoryClusters,
    investigationOrder: investigationFindings.slice(0, 6).map(({ finding, index }) => ({
      domId: getFindingDomId(finding, index),
      evidenceCount: finding.evidence.length,
      severity: finding.severity,
      suggestion: finding.suggestion,
      title: finding.title,
    })),
    pathCount: paths.size,
    sourceLinkedCount,
  };
}

function buildFindingActionQueueView(input: {
  blockingFindingIds: Set<string>;
  getRoleTitle: (roleId: string) => string;
  remediationPacks: RemediationPack[];
  sortedFindings: AnalysisFinding[];
}): FindingActionQueueView {
  const packByFindingId = new Map<string, RemediationPack>();
  for (const pack of input.remediationPacks) {
    for (const findingId of pack.findingIds) {
      if (!packByFindingId.has(findingId)) {
        packByFindingId.set(findingId, pack);
      }
    }
  }

  const rows: FindingActionView[] = [];
  const seen = new Set<string>();
  input.sortedFindings.forEach((finding, index) => {
    const key = getFindingDisplayKey(finding);
    if (seen.has(key) || rows.length >= 8) {
      return;
    }
    seen.add(key);
    const pack = packByFindingId.get(finding.id) ?? null;
    rows.push({
      domId: getFindingDomId(finding, index),
      evidenceCount: finding.evidence.length + finding.evidenceRefs.length,
      packLabel: pack ? `${pack.priority} pack` : null,
      packTagClass: pack ? getTagTone(pack.priority) : "tag tag--neutral",
      pathPreview: finding.paths[0] ?? null,
      roleName: input.getRoleTitle(finding.roleId),
      severity: finding.severity,
      suggestion: finding.suggestion,
      title: finding.title,
    });
  });

  return {
    plannedCount: packByFindingId.size,
    rows,
    totalFindingCount: input.sortedFindings.length,
    urgentCount: input.sortedFindings.filter(finding =>
      input.blockingFindingIds.has(finding.id) || finding.severity === "high").length,
  };
}

function buildArtifactTrustView(input: {
  artifactAnalysis: ArtifactAnalysis | null;
  artifactViews: ArtifactView[];
}): ArtifactTrustView {
  const artifactByKey = new Map(input.artifactViews.map(view => [view.artifact.key, view] as const));
  const missingKinds = input.artifactAnalysis?.missingKinds.map(formatKeyLabel) ?? [];
  const invalidArtifacts = input.artifactAnalysis?.invalidArtifacts ?? [];
  const issueCount = missingKinds.length + invalidArtifacts.length;
  const producedByKind = Object.entries(input.artifactAnalysis?.producedByKind ?? {})
    .map(([kind, count]) => ({ kind: formatKeyLabel(kind), count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
  const notableArtifacts = (input.artifactAnalysis?.notableArtifacts ?? [])
    .slice(0, 6)
    .map(artifact => {
      const view = artifactByKey.get(artifact.key) ?? null;
      return {
        href: view?.href ?? null,
        key: artifact.key,
        kind: formatKeyLabel(artifact.kind),
        name: getArtifactName(artifact.key),
      };
    });

  return {
    invalidArtifacts,
    missingKinds,
    notableArtifacts,
    presentKinds: input.artifactAnalysis?.presentKinds.map(formatKeyLabel) ?? [],
    producedByKind,
    statusDetail: input.artifactAnalysis?.summary ?? `${input.artifactViews.length} artifact${input.artifactViews.length === 1 ? "" : "s"} registered for this run.`,
    statusLabel: issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : "Evidence ready",
    tagClass: issueCount > 0 ? "tag tag--warning" : "tag tag--success",
  };
}

function getScoreTone(score: number | null): RoleResultView["tone"] {
  if (score === null) return "neutral";
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

function getScoreTagClass(score: number | null): string {
  if (score === null) return "tag tag--neutral";
  return getTagTone(score >= 80 ? "pass" : score >= 50 ? "warn" : "fail");
}

function buildRoleHealthView(input: {
  blockingFindingIds: Set<string>;
  getRoleTitle: (roleId: string) => string;
  report: AnalysisReport;
  sortedFindings: AnalysisFinding[];
}): RoleHealthView {
  const scorecard = input.report.summary.qualityScorecard;
  const roleScores = scorecard?.roleScores ?? [];
  const sectionsByRole = new Map<string, AnalysisReportSection[]>();
  for (const section of input.report.sections) {
    sectionsByRole.set(section.roleId, [...(sectionsByRole.get(section.roleId) ?? []), section]);
  }

  const findingsByRole = new Map<string, AnalysisFinding[]>();
  for (const finding of input.sortedFindings) {
    findingsByRole.set(finding.roleId, [...(findingsByRole.get(finding.roleId) ?? []), finding]);
  }

  const roleIds = new Set<string>([
    ...input.report.roles.map(role => role.id),
    ...roleScores.map(role => role.roleId),
    ...input.report.sections.map(section => section.roleId),
    ...input.sortedFindings.map(finding => finding.roleId),
  ]);
  const roleScoreById = new Map(roleScores.map(role => [role.roleId, role] as const));
  const roleOrder = new Map(input.report.roles.map(role => [role.id, role.order] as const));

  const roles = [...roleIds].map(roleId => {
    const score = roleScoreById.get(roleId) ?? null;
    const findings = findingsByRole.get(roleId) ?? [];
    const sections = sectionsByRole.get(roleId) ?? [];
    const highCount = findings.filter(finding => finding.severity === "high").length;
    const blockingCount = findings.filter(finding => input.blockingFindingIds.has(finding.id)).length;
    const firstFinding = findings[0] ?? null;
    const firstFindingIndex = firstFinding ? input.sortedFindings.indexOf(firstFinding) : -1;
    const sectionHref = sections[0] ? `#section-${toStableId(sections[0].id)}` : null;
    const findingHref = firstFinding && firstFindingIndex >= 0 ? `#${getFindingDomId(firstFinding, firstFindingIndex)}` : null;
    const scoreValue = score?.score ?? null;
    const status = score?.status ?? (sections.length > 0 ? "ready" : "missing");
    const tone = blockingCount > 0 || highCount > 0 ? "danger" : getScoreTone(scoreValue);
    return {
      blockingCount,
      detail: score?.rationale ?? (sections[0]?.summary ?? "No role scorecard rationale was emitted for this role."),
      findingCount: findings.length,
      findingHref,
      highCount,
      id: roleId,
      score: scoreValue,
      sectionCount: sections.length,
      sectionHref,
      status,
      tagClass: blockingCount > 0 || highCount > 0 ? "tag tag--danger" : getScoreTagClass(scoreValue),
      title: score?.title ?? input.getRoleTitle(roleId),
      tone,
    } satisfies RoleResultView;
  }).sort((left, right) => (
    (roleOrder.get(left.id) ?? 9999) - (roleOrder.get(right.id) ?? 9999)
    || left.title.localeCompare(right.title)
  ));

  const attentionRoles = roles
    .slice()
    .sort((left, right) => (
      right.blockingCount - left.blockingCount
      || right.highCount - left.highCount
      || Number(left.score ?? -1) - Number(right.score ?? -1)
      || right.findingCount - left.findingCount
      || left.title.localeCompare(right.title)
    ))
    .slice(0, 3);
  const productiveRoles = roles
    .slice()
    .sort((left, right) => (
      right.findingCount - left.findingCount
      || right.sectionCount - left.sectionCount
      || left.title.localeCompare(right.title)
    ))
    .slice(0, 3);
  const scoreValues = roles.map(role => role.score).filter((score): score is number => typeof score === "number");
  const weakestSkills = (scorecard?.skillScores ?? [])
    .slice()
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
    .slice(0, 4)
    .map(skill => ({
      coveredRoles: skill.coveredByRoleIds.map(roleId => input.getRoleTitle(roleId)),
      id: skill.skillId,
      name: skill.name,
      rationale: skill.rationale,
      score: skill.score,
      tagClass: getScoreTagClass(skill.score),
      tone: skill.score >= 80 ? "success" : skill.score >= 50 ? "warning" : "danger",
    }) satisfies SkillCoverageView);

  return {
    attentionRoles,
    averageScore: scoreValues.length > 0 ? Math.round(scoreValues.reduce((total, score) => total + score, 0) / scoreValues.length) : null,
    productiveRoles,
    readyCount: roles.filter(role => role.status === "ready").length,
    roleCount: roles.length,
    skillCount: scorecard?.skillScores.length ?? 0,
    weakestSkills,
  };
}

function buildReviewPath(input: {
  agentWorkflow: AgentWorkflowView;
  artifactTrust: ArtifactTrustView;
  findingTriage: FindingTriageView;
  remediationCommand: RemediationCommandView;
  report: AnalysisReport;
  roleHealth: RoleHealthView;
}): ReviewPathStepView[] {
  const gateStatus = input.report.summary.releaseGateDecision?.status ?? "n/a";
  const highOrBlocking = input.findingTriage.blockingCount + input.report.summary.high;
  return [
    {
      id: "decision",
      label: "1",
      title: "Read the decision",
      metric: gateStatus,
      detail: input.report.summary.releaseGateDecision?.reason ?? "Start with the release gate and top signal.",
      href: "#report-decision-cockpit",
      tagClass: getReleaseGateTagClass(input.report.summary.releaseGateDecision?.status ?? null),
      tone: gateStatus === "fail" ? "danger" : gateStatus === "warn" ? "warning" : "success",
    },
    {
      id: "workflow",
      label: "2",
      title: "Check execution health",
      metric: `${input.agentWorkflow.progressPercent}%`,
      detail: input.agentWorkflow.overview,
      href: "#report-agent-workflow",
      tagClass: input.agentWorkflow.statusCounts.failed > 0 ? "tag tag--danger" : "tag tag--success",
      tone: input.agentWorkflow.statusCounts.failed > 0 ? "danger" : "success",
    },
    {
      id: "roles",
      label: "3",
      title: "Inspect role reliability",
      metric: input.roleHealth.averageScore === null ? "n/a" : String(input.roleHealth.averageScore),
      detail: `${input.roleHealth.readyCount}/${input.roleHealth.roleCount} roles ready; weakest skills are summarized below.`,
      href: "#report-role-health",
      tagClass: getScoreTagClass(input.roleHealth.averageScore),
      tone: getScoreTone(input.roleHealth.averageScore),
    },
    {
      id: "findings",
      label: "4",
      title: "Open action queue",
      metric: `${highOrBlocking} urgent`,
      detail: `${input.findingTriage.blockingCount} blocking findings and ${input.report.summary.high} high-severity findings are converted into an ordered fix queue.`,
      href: "#report-action-queue",
      tagClass: highOrBlocking > 0 ? "tag tag--danger" : input.report.summary.totalFindings > 0 ? "tag tag--warning" : "tag tag--success",
      tone: highOrBlocking > 0 ? "danger" : input.report.summary.totalFindings > 0 ? "warning" : "success",
    },
    {
      id: "evidence",
      label: "5",
      title: "Verify artifacts",
      metric: input.artifactTrust.statusLabel,
      detail: input.artifactTrust.statusDetail,
      href: "#report-artifact-trust",
      tagClass: input.artifactTrust.tagClass,
      tone: input.artifactTrust.tagClass.includes("warning") ? "warning" : "success",
    },
    {
      id: "fix",
      label: "6",
      title: "Move to fix",
      metric: input.remediationCommand.commandTagLabel,
      detail: input.remediationCommand.commandDetail,
      href: "#report-remediation-panel",
      tagClass: input.remediationCommand.commandTagClass,
      tone: input.remediationCommand.commandTagClass.includes("danger")
        ? "danger"
        : input.remediationCommand.commandTagClass.includes("warning")
          ? "warning"
          : input.remediationCommand.commandTagClass.includes("success")
            ? "success"
            : "info",
    },
  ];
}

function buildRemediationCommandView(input: {
  canMutate: boolean;
  latestRemediationJobId?: string | null;
  latestRemediationJobStatus?: string | null;
  remediationBranchName?: string | null;
  remediationSourceId: string;
  report: AnalysisReport;
  workspaceId: string;
}): RemediationCommandView {
  const { report } = input;
  const changeset = report.summary.changeset;
  const blockingFindingIds = report.summary.releaseGateDecision?.blockingFindingIds ?? [];
  const packs = report.summary.remediationPacks;
  const fixHandoffEntries = report.summary.fixHandoff?.entries ?? [];
  const plannedFindingIds = new Set(packs.flatMap(pack => pack.findingIds));
  const highPackCount = packs.filter(pack => pack.priority === "high").length;
  const latestRemediationJobHref = input.latestRemediationJobId
    ? `/portal/workspaces/${input.workspaceId}/runs/${input.latestRemediationJobId}` as Route
    : null;
  const changesetHref = changeset
    ? getWorkspaceCodeReviewHref({
        workspaceId: input.workspaceId,
        sourceId: input.remediationSourceId,
        branchName: input.remediationBranchName ?? null,
        baseRef: changeset.baseRef,
      })
    : null;
  const reportGateStatus = report.summary.releaseGateDecision?.status ?? null;
  const signalTone: RemediationStageView["tone"] = report.summary.high > 0 || blockingFindingIds.length > 0 || reportGateStatus === "fail"
    ? "danger"
    : report.summary.totalFindings > 0
      ? "warning"
      : "success";
  const signalDetail = report.summary.totalFindings === 0
    ? "No findings are blocking this report."
    : `${blockingFindingIds.length} blocking, ${report.summary.high} high, ${report.summary.medium} medium, ${report.summary.low} low.`;
  const planTone: RemediationStageView["tone"] = packs.length > 0 ? "success" : report.summary.totalFindings > 0 ? "warning" : "neutral";
  const runTone = getRemediationStatusTone(input.latestRemediationJobStatus ?? null);
  const changesetTone: RemediationStageView["tone"] = changeset
    ? changeset.changedFiles.length > 0
      ? "success"
      : "warning"
    : input.latestRemediationJobStatus === "running" || input.latestRemediationJobStatus === "queued" || input.latestRemediationJobStatus === "pending"
      ? "warning"
      : "neutral";
  const validationTone: RemediationStageView["tone"] = changeset?.prUrl
    ? "success"
    : changeset?.validationPassed
      ? "success"
      : changeset
        ? "warning"
        : "neutral";
  const validationMetric = changeset?.prUrl
    ? "PR linked"
    : changeset
      ? `${changeset.validationCommands.length} check${changeset.validationCommands.length === 1 ? "" : "s"}`
      : "Awaiting fix";
  const validationDetail = changeset?.prUrl
    ? "A remote pull request is linked to this remediation output."
    : changeset?.validationPassed
      ? "Validation passed. Review the diff before publishing or merging."
      : changeset
        ? "Validation is not green yet. Inspect the remediation run and patch artifacts before applying."
        : "Validation starts after a changeset is generated.";
  const stages: RemediationStageView[] = [
    {
      id: "signal",
      label: "Signal",
      metric: `${report.summary.totalFindings} finding${report.summary.totalFindings === 1 ? "" : "s"}`,
      statusLabel: reportGateStatus ? `Gate ${reportGateStatus}` : "Ungated",
      tagClass: getReleaseGateTagClass(reportGateStatus),
      tone: signalTone,
      detail: signalDetail,
    },
    {
      id: "plan",
      label: "Plan",
      metric: `${packs.length} pack${packs.length === 1 ? "" : "s"}`,
      statusLabel: packs.length > 0 ? "Fix plan ready" : "No fix plan",
      tagClass: getTagTone(planTone === "success" ? "pass" : planTone === "warning" ? "warn" : "neutral"),
      tone: planTone,
      detail: `${plannedFindingIds.size} finding${plannedFindingIds.size === 1 ? "" : "s"} mapped to packs, ${fixHandoffEntries.length} handoff entr${fixHandoffEntries.length === 1 ? "y" : "ies"}.`,
    },
    {
      id: "run",
      label: "Fix run",
      metric: input.latestRemediationJobStatus ?? "Not started",
      statusLabel: input.latestRemediationJobStatus ?? "Idle",
      tagClass: input.latestRemediationJobStatus ? getJobStatusTagClass(input.latestRemediationJobStatus) : "tag tag--neutral",
      tone: runTone,
      detail: input.latestRemediationJobStatus
        ? "A remediation job is linked to this report."
        : "Queue remediation when the proposed packs are ready to turn into code.",
      ...(latestRemediationJobHref ? { href: latestRemediationJobHref } : {}),
    },
    {
      id: "changeset",
      label: "Changeset",
      metric: changeset ? `${changeset.changedFiles.length} file${changeset.changedFiles.length === 1 ? "" : "s"}` : "No diff",
      statusLabel: changeset ? "Generated" : "Awaiting run",
      tagClass: changeset ? getTagTone(changeset.changedFiles.length > 0 ? "pass" : "warn") : "tag tag--neutral",
      tone: changesetTone,
      detail: changeset ? `Stop reason: ${formatKeyLabel(changeset.stopReason)}.` : "No reviewable patch has been generated yet.",
      ...(changesetHref ? { href: changesetHref } : {}),
    },
    {
      id: "validation",
      label: "Validate/PR",
      metric: validationMetric,
      statusLabel: changeset?.prUrl ? "Remote PR" : changeset?.validationPassed ? "Validated" : "Needs review",
      tagClass: changeset?.prUrl || changeset?.validationPassed ? "tag tag--success" : changeset ? "tag tag--warning" : "tag tag--neutral",
      tone: validationTone,
      detail: validationDetail,
      ...(changesetHref ? { href: changesetHref } : {}),
    },
  ];

  if (changeset?.prUrl) {
    return {
      commandTitle: "Remote PR is ready for review",
      commandDetail: "SpecLens has linked a pull request for this remediation. Review the PR and keep the report as the evidence trail.",
      commandTagLabel: "PR ready",
      commandTagClass: "tag tag--success",
      fixedFindingCount: changeset.fixedFindingIds.length,
      residualFindingCount: changeset.residualFindingIds.length,
      plannedFindingCount: plannedFindingIds.size,
      highPackCount,
      handoffEntryCount: fixHandoffEntries.length,
      primaryAction: { external: true, href: changeset.prUrl, label: "Open PR" },
      secondaryAction: latestRemediationJobHref ? { href: latestRemediationJobHref, label: "Open remediation run" } : null,
      stages,
    };
  }

  if (changeset) {
    return {
      commandTitle: changeset.validationPassed ? "Validated changeset is ready for review" : "Changeset needs validation review",
      commandDetail: changeset.validationPassed
        ? "Review the changed files and patch bundle, then publish or apply through the normal repo workflow."
        : "Inspect validation output and patch artifacts before applying. A failed check should block automatic promotion.",
      commandTagLabel: changeset.validationPassed ? "Review diff" : "Review required",
      commandTagClass: changeset.validationPassed ? "tag tag--success" : "tag tag--warning",
      fixedFindingCount: changeset.fixedFindingIds.length,
      residualFindingCount: changeset.residualFindingIds.length,
      plannedFindingCount: plannedFindingIds.size,
      highPackCount,
      handoffEntryCount: fixHandoffEntries.length,
      primaryAction: changesetHref ? { href: changesetHref, label: "Open code review" } : null,
      secondaryAction: latestRemediationJobHref ? { href: latestRemediationJobHref, label: "Open remediation run" } : null,
      stages,
    };
  }

  if (input.latestRemediationJobStatus === "running" || input.latestRemediationJobStatus === "queued" || input.latestRemediationJobStatus === "pending") {
    return {
      commandTitle: "Remediation is already in flight",
      commandDetail: "Follow the remediation run for sandbox logs, patch artifacts, validation output, and final changeset status.",
      commandTagLabel: "In progress",
      commandTagClass: "tag tag--warning",
      fixedFindingCount: 0,
      residualFindingCount: report.summary.totalFindings,
      plannedFindingCount: plannedFindingIds.size,
      highPackCount,
      handoffEntryCount: fixHandoffEntries.length,
      primaryAction: latestRemediationJobHref ? { href: latestRemediationJobHref, label: "Open remediation run" } : null,
      secondaryAction: null,
      stages,
    };
  }

  if (packs.length > 0) {
    return {
      commandTitle: input.canMutate ? "Queue a bounded remediation run" : "Workspace owner can queue remediation",
      commandDetail: input.canMutate
        ? "Use auto-priority for the first pass. It keeps the fix scoped to the highest impact pack and returns a reviewable changeset."
        : "The report has fix-ready packs, but only the workspace owner can start a remediation run.",
      commandTagLabel: input.canMutate ? "Ready to fix" : "Owner action",
      commandTagClass: input.canMutate ? "tag tag--info" : "tag tag--warning",
      fixedFindingCount: 0,
      residualFindingCount: report.summary.totalFindings,
      plannedFindingCount: plannedFindingIds.size,
      highPackCount,
      handoffEntryCount: fixHandoffEntries.length,
      primaryAction: null,
      secondaryAction: null,
      stages,
    };
  }

  return {
    commandTitle: report.summary.totalFindings > 0 ? "Triage findings before remediation" : "No remediation needed",
    commandDetail: report.summary.totalFindings > 0
      ? "This report has findings, but no structured remediation pack. Re-run with remediation planning or triage findings manually."
      : "The report did not produce findings that require a fix run.",
    commandTagLabel: report.summary.totalFindings > 0 ? "Needs plan" : "Clear",
    commandTagClass: report.summary.totalFindings > 0 ? "tag tag--warning" : "tag tag--success",
    fixedFindingCount: 0,
    residualFindingCount: report.summary.totalFindings,
    plannedFindingCount: plannedFindingIds.size,
    highPackCount,
    handoffEntryCount: fixHandoffEntries.length,
    primaryAction: null,
    secondaryAction: null,
    stages,
  };
}

function renderRemediationAction(action: RemediationActionView | null, className: string, testId: string): ReactNode {
  if (!action) return null;
  if (action.external) {
    return (
      <a className={className} data-testid={testId} href={action.href} target="_blank" rel="noreferrer">
        {action.label}
      </a>
    );
  }
  return (
    <Link className={className} data-testid={testId} href={action.href as Route}>
      {action.label}
    </Link>
  );
}

function renderCockpitAction(action: CockpitActionView | null, className: string, testId: string): ReactNode {
  if (!action) return null;
  if (action.external || action.href.startsWith("http")) {
    return (
      <a className={className} data-testid={testId} href={action.href} target="_blank" rel="noreferrer">
        {action.label}
      </a>
    );
  }
  if (action.href.startsWith("#")) {
    return (
      <a className={className} data-testid={testId} href={action.href}>
        {action.label}
      </a>
    );
  }
  return (
    <Link className={className} data-testid={testId} href={action.href as Route}>
      {action.label}
    </Link>
  );
}

function renderDecisionCockpit(input: {
  agentWorkflow: AgentWorkflowView;
  artifactTrust: ArtifactTrustView;
  blockingFindingIds: Set<string>;
  findingTriage: FindingTriageView;
  highlightedFindings: AnalysisFinding[];
  jobStatus: string;
  remediationCommand: RemediationCommandView;
  report: AnalysisReport;
  reportDiagnostics: ReportDiagnosticView[];
  roleHealth: RoleHealthView;
}): ReactNode {
  const {
    agentWorkflow,
    artifactTrust,
    blockingFindingIds,
    findingTriage,
    highlightedFindings,
    jobStatus,
    remediationCommand,
    report,
    reportDiagnostics,
    roleHealth,
  } = input;
  const gateStatus = report.summary.releaseGateDecision?.status ?? null;
  const qualityScore = report.summary.qualityScorecard?.overallScore ?? null;
  const firstPack = report.summary.remediationPacks[0] ?? null;
  const plannedFindingCount = new Set(report.summary.remediationPacks.flatMap(pack => pack.findingIds)).size;
  const urgentFindingCount = Math.max(blockingFindingIds.size, report.summary.high);
  const workflowFailed = agentWorkflow.statusCounts.failed > 0;
  const evidenceHasGaps = artifactTrust.tagClass.includes("warning") || artifactTrust.tagClass.includes("danger");
  const releaseLabel = gateStatus === "fail"
    ? "Release blocked"
    : gateStatus === "warn"
      ? "Release needs review"
      : gateStatus === "pass"
        ? "Release can proceed"
        : "Release undecided";
  const headline = gateStatus === "fail"
    ? `Blocked by ${urgentFindingCount} urgent finding${urgentFindingCount === 1 ? "" : "s"}`
    : gateStatus === "warn"
      ? "Review before release"
      : gateStatus === "pass"
        ? "No release blocker found"
        : "Report is ready for triage";
  const plainEnglish = gateStatus === "fail"
    ? `The AI job completed enough evidence to judge the repo, but the release gate is failing. The aggregate quality score${qualityScore === null ? "" : ` (${qualityScore})`} is not the decision; high-severity findings override it.`
    : gateStatus === "warn"
      ? "The run produced usable evidence, but the report still needs human review before the result should be promoted."
      : gateStatus === "pass"
        ? "The report did not find release-blocking issues. Review artifacts and low-priority notes before closing the run."
        : "The report has output, but no clear release gate was recorded. Treat the details as triage input.";
  const primaryAction = remediationCommand.primaryAction ?? (
    report.summary.remediationPacks.length > 0
      ? { href: "#report-remediation-panel", label: "Start remediation" }
      : { href: "#report-action-queue", label: "Open action queue" }
  );
  const secondaryAction = remediationCommand.secondaryAction ?? (
    highlightedFindings.length > 0
      ? { href: "#report-priority-findings", label: "See top blockers" }
      : { href: "#report-action-queue", label: "Open action queue" }
  );
  const trustSignals = [
    {
      badge: workflowFailed ? "debug" : "ok",
      detail: workflowFailed ? `${agentWorkflow.statusCounts.failed} checkpoint failure${agentWorkflow.statusCounts.failed === 1 ? "" : "s"}.` : `${agentWorkflow.completedCount} checkpoints completed.`,
      label: "AI workflow",
      tagClass: workflowFailed ? "tag tag--danger" : "tag tag--success",
      value: workflowFailed ? "Needs debug" : "Completed",
    },
    {
      badge: evidenceHasGaps ? "review" : "ready",
      detail: artifactTrust.statusDetail,
      label: "Evidence",
      tagClass: artifactTrust.tagClass,
      value: artifactTrust.statusLabel,
    },
    {
      badge: roleHealth.averageScore !== null && roleHealth.averageScore >= 80 ? "ready" : "review",
      detail: roleHealth.averageScore === null ? "No role scorecard emitted." : `${roleHealth.readyCount}/${roleHealth.roleCount} roles ready.`,
      label: "Role signal",
      tagClass: getScoreTagClass(roleHealth.averageScore),
      value: roleHealth.averageScore === null ? "n/a" : String(roleHealth.averageScore),
    },
  ];
  const findingSearchText = (finding: AnalysisFinding) => [
    finding.title,
    finding.message,
    finding.suggestion,
    finding.category,
    finding.roleId,
    ...finding.paths,
  ].join(" ").toLowerCase();
  const blockerFindings = report.findings.filter(finding =>
    blockingFindingIds.has(finding.id) || finding.severity === "high");
  const environmentFindings = report.findings.filter(finding =>
    /auth|credential|docker compose|database_url|env|keycloak|oauth|prerequisite|provider|secret/.test(findingSearchText(finding)));
  const architectureFindings = report.findings.filter(finding =>
    /architecture|boundary|centraliz|coupling|inversion|oversized|orchestrat/.test(findingSearchText(finding)));
  const tacticalFindings = report.findings.filter(finding =>
    finding.severity !== "high"
    && !environmentFindings.some(environmentFinding => environmentFinding.id === finding.id)
    && !architectureFindings.some(architectureFinding => architectureFinding.id === finding.id));
  const decisionLanes = [
    {
      count: blockerFindings.length,
      detail: blockerFindings.length > 0
        ? "These findings decide a failing release gate even when the quality score is high."
        : "No explicit high-severity or release-gate blocker is currently mapped.",
      href: blockerFindings.length > 0 ? "#report-action-queue" : "#report-findings-detail",
      label: "Gate",
      tagClass: blockerFindings.length > 0 ? "tag tag--danger" : "tag tag--success",
      title: "Release blockers",
    },
    {
      count: environmentFindings.length + report.summary.capabilityGaps.length,
      detail: "Config, credentials, Docker/Compose, and authenticated-browser prerequisites belong here. They should be tracked without mixing them into product-code defects.",
      href: "#report-capability-gaps",
      label: "Setup",
      tagClass: environmentFindings.length + report.summary.capabilityGaps.length > 0 ? "tag tag--warning" : "tag tag--success",
      title: "Environment prerequisites",
    },
    {
      count: architectureFindings.length,
      detail: "Boundary, coupling, and oversized-module findings usually need isolated refactor packs, not opportunistic edits during GUI or runtime work.",
      href: "#report-action-queue",
      label: "Refactor",
      tagClass: architectureFindings.length > 0 ? "tag tag--danger" : "tag tag--success",
      title: "Architecture work",
    },
    {
      count: tacticalFindings.length,
      detail: "Copy, state, accessibility, and small interaction fixes can usually be batched after blocker and prerequisite decisions are clear.",
      href: "#report-action-queue",
      label: "Batch",
      tagClass: tacticalFindings.length > 0 ? "tag tag--info" : "tag tag--success",
      title: "Tactical quick wins",
    },
  ];
  const nextMoves = [
    {
      detail: firstPack
        ? `${firstPack.summary} ${plannedFindingCount} finding${plannedFindingCount === 1 ? "" : "s"} mapped to remediation.`
        : remediationCommand.commandDetail,
      href: "#report-remediation-panel",
      label: "1",
      tagClass: remediationCommand.commandTagClass,
      title: firstPack ? firstPack.title : remediationCommand.commandTitle,
    },
    {
      detail: findingTriage.investigationOrder.length > 0
        ? `Start with ${findingTriage.blockingCount} blocking finding${findingTriage.blockingCount === 1 ? "" : "s"} and ${report.summary.high} high-severity finding${report.summary.high === 1 ? "" : "s"}.`
        : "No finding investigation order was emitted.",
      href: "#report-action-queue",
      label: "2",
      tagClass: findingTriage.blockingCount > 0 || report.summary.high > 0 ? "tag tag--danger" : "tag tag--success",
      title: "Work the ordered action queue",
    },
    {
      detail: evidenceHasGaps
        ? "Resolve artifact gaps before trusting browser or Playwright conclusions."
        : "Use screenshots, logs, traces, and Playwright output as the proof trail for review.",
      href: "#report-artifact-trust",
      label: "3",
      tagClass: artifactTrust.tagClass,
      title: "Verify the proof before applying fixes",
    },
  ];
  const topFinding = highlightedFindings[0] ?? null;
  const executiveBrief = [
    {
      answer: workflowFailed
        ? "No. Debug the failed execution checkpoint before trusting the conclusion."
        : evidenceHasGaps
          ? "Partially. The job ran, but artifact gaps need review before promotion."
          : "Yes as review evidence. The hosted workflow completed and the evidence bundle is present.",
      href: "#report-agent-workflow",
      metric: workflowFailed ? "debug" : evidenceHasGaps ? "verify" : "ready",
      question: "Can I trust this run?",
      tagClass: workflowFailed ? "tag tag--danger" : evidenceHasGaps ? "tag tag--warning" : "tag tag--success",
    },
    {
      answer: topFinding
        ? `${topFinding.title}: ${topFinding.suggestion}`
        : "No blocking or high-priority finding was pulled forward.",
      href: topFinding ? "#report-action-queue" : "#report-findings-detail",
      metric: topFinding ? topFinding.severity : "none",
      question: "What is the main issue?",
      tagClass: topFinding ? getTagTone(topFinding.severity) : "tag tag--success",
    },
    {
      answer: artifactTrust.statusDetail,
      href: "#report-artifact-trust",
      metric: artifactTrust.statusLabel,
      question: "What evidence proves it?",
      tagClass: artifactTrust.tagClass,
    },
    {
      answer: remediationCommand.commandDetail,
      href: "#report-remediation-panel",
      metric: remediationCommand.commandTagLabel,
      question: "What should happen next?",
      tagClass: remediationCommand.commandTagClass,
    },
  ];

  return (
    <section className={`report-decision-cockpit report-decision-cockpit--${gateStatus ?? "unknown"}`} data-testid="report-decision-cockpit" id="report-decision-cockpit">
      <div className="report-decision-cockpit__hero">
        <div className="report-decision-cockpit__copy">
          <div className="portal-inline-actions">
            <span className={getReleaseGateTagClass(gateStatus)}>{releaseLabel}</span>
            <span className={getJobStatusTagClass(jobStatus)}>Job {jobStatus}</span>
            <span className={workflowFailed ? "tag tag--danger" : "tag tag--success"}>
              Workflow {workflowFailed ? "attention" : "clean"}
            </span>
          </div>
          <h2>{headline}</h2>
          <p>{plainEnglish}</p>
          <div className="report-decision-cockpit__actions">
            {renderCockpitAction(primaryAction, "button-secondary", "report-cockpit-primary-action")}
            {renderCockpitAction(secondaryAction, "button-ghost", "report-cockpit-secondary-action")}
          </div>
        </div>
        <div className="report-decision-cockpit__score" data-testid="report-cockpit-score">
          <span>Decision context</span>
          <strong>{qualityScore ?? "n/a"}</strong>
          <p>
            Quality score is evidence quality, not automatic approval.
            {gateStatus === "fail" ? " The release gate wins because blockers exist." : ""}
          </p>
        </div>
      </div>

      <div className="report-decision-cockpit__split" data-testid="report-cockpit-outcome-split">
        <article>
          <span className="report-summary-card__label">What happened</span>
          <strong>AI run completed inside the hosted workflow</strong>
          <p>{agentWorkflow.overview}</p>
        </article>
        <article>
          <span className="report-summary-card__label">What it means</span>
          <strong>{report.summary.releaseGateDecision?.reason ?? "No release decision was recorded."}</strong>
          <p>{report.summary.totalFindings} findings: {report.summary.high} high, {report.summary.medium} medium, {report.summary.low} low.</p>
        </article>
        <article>
          <span className="report-summary-card__label">What to do</span>
          <strong>{remediationCommand.commandTitle}</strong>
          <p>{remediationCommand.commandDetail}</p>
        </article>
      </div>

      <div className="report-decision-cockpit__brief" data-testid="report-cockpit-executive-brief">
        <div className="report-cockpit-brief__intro">
          <span className="report-summary-card__label">Executive brief</span>
          <h3>Answer these four questions first</h3>
          <p>Use this block before reading raw findings. It separates run trust, product risk, evidence, and the next concrete action.</p>
        </div>
        <div className="report-cockpit-brief__grid">
          {executiveBrief.map(item => (
            <a className="report-cockpit-brief-card" href={item.href} key={item.question}>
              <div className="report-cockpit-brief-card__header">
                <strong>{item.question}</strong>
                <span className={item.tagClass}>{item.metric}</span>
              </div>
              <p>{item.answer}</p>
            </a>
          ))}
        </div>
      </div>

      <div className="report-decision-cockpit__lanes" data-testid="report-cockpit-decision-lanes">
        <div className="report-cockpit-lanes__intro">
          <span className="report-summary-card__label">Decision lanes</span>
          <h3>Separate blockers from prerequisites and refactors</h3>
          <p>A high score can coexist with a failed gate. These lanes explain why and show which work should not be mixed together.</p>
        </div>
        <div className="report-cockpit-lanes__grid">
          {decisionLanes.map(lane => (
            <a className="report-cockpit-lane" href={lane.href} key={lane.title}>
              <div className="report-cockpit-lane__header">
                <span className={lane.tagClass}>{lane.label}</span>
                <strong>{lane.count}</strong>
              </div>
              <h4>{lane.title}</h4>
              <p>{lane.detail}</p>
            </a>
          ))}
        </div>
      </div>

      <div className="report-decision-cockpit__diagnostics" data-testid="report-cockpit-diagnostics">
        <div>
          <span className="report-summary-card__label">Report clarity</span>
          <h3>Why this report may still feel hard to read</h3>
          <p>The run can be technically successful while the report shape still needs stronger clustering, anchors, or deduplication. These diagnostics explain the report itself.</p>
        </div>
        <div className="report-diagnostic-grid">
          {reportDiagnostics.map(diagnostic => (
            <article className={`report-diagnostic-card report-diagnostic-card--${diagnostic.tone}`} data-testid={`report-diagnostic-${diagnostic.id}`} key={diagnostic.id}>
              <div className="report-diagnostic-card__header">
                <strong>{diagnostic.title}</strong>
                <span className={diagnostic.tagClass}>{diagnostic.metric}</span>
              </div>
              <p>{diagnostic.detail}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="report-decision-cockpit__content">
        <div className="report-decision-cockpit__moves" data-testid="report-cockpit-next-moves">
          <h3>Recommended path</h3>
          {nextMoves.map(move => (
            <a className="report-cockpit-move" href={move.href} key={move.label}>
              <span>{move.label}</span>
              <div>
                <div className="report-cockpit-move__header">
                  <strong>{move.title}</strong>
                  <span className={move.tagClass}>open</span>
                </div>
                <p>{move.detail}</p>
              </div>
            </a>
          ))}
        </div>
        <div className="report-decision-cockpit__blockers" data-testid="report-cockpit-blockers">
          <h3>{highlightedFindings.length > 0 ? "Top blockers" : "No blockers"}</h3>
          {highlightedFindings.length === 0 ? <p className="subtle-note">No high-priority findings were pulled forward.</p> : null}
          {highlightedFindings.slice(0, 3).map((finding, index) => (
            <article className="report-cockpit-blocker" key={`${finding.id}:${index}`}>
              <span className={blockingFindingIds.has(finding.id) ? "tag tag--danger" : getTagTone(finding.severity)}>
                {blockingFindingIds.has(finding.id) ? "blocking" : finding.severity}
              </span>
              <strong>{finding.title}</strong>
              <p>{finding.suggestion}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="report-decision-cockpit__trust" data-testid="report-cockpit-trust">
        {trustSignals.map(signal => (
          <article key={signal.label}>
            <div>
              <span className="report-summary-card__label">{signal.label}</span>
              <strong>{signal.value}</strong>
            </div>
            <span className={signal.tagClass}>{signal.badge}</span>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function renderRemediationCommandCenter(view: RemediationCommandView): ReactNode {
  return (
    <div className="report-remediation-command" data-testid="report-remediation-command">
      <div className="report-remediation-command__brief">
        <div className="report-remediation-command__copy">
          <span className={view.commandTagClass}>{view.commandTagLabel}</span>
          <h3>{view.commandTitle}</h3>
          <p>{view.commandDetail}</p>
        </div>
        <div className="report-remediation-command__actions">
          {renderRemediationAction(view.primaryAction, "button-secondary", "report-remediation-primary-action")}
          {renderRemediationAction(view.secondaryAction, "button-ghost", "report-remediation-secondary-action")}
        </div>
      </div>
      <div className="report-remediation-path" data-testid="report-remediation-path">
        {view.stages.map((stage, index) => (
          <article className={`report-remediation-stage report-remediation-stage--${stage.tone}`} data-testid={`report-remediation-stage-${stage.id}`} key={stage.id}>
            <div className="report-remediation-stage__rail" aria-hidden="true">
              <span>{index + 1}</span>
            </div>
            <div className="report-remediation-stage__body">
              <div className="report-remediation-stage__header">
                <strong>{stage.label}</strong>
                <span className={stage.tagClass}>{stage.statusLabel}</span>
              </div>
              <span className="report-remediation-stage__metric">{stage.metric}</span>
              <p>{stage.detail}</p>
              {stage.href ? (
                <Link className="report-remediation-stage__link" data-testid={`report-remediation-stage-open-${stage.id}`} href={stage.href}>
                  Open
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <dl className="report-remediation-metrics" data-testid="report-remediation-metrics">
        <div>
          <dt>Planned findings</dt>
          <dd>{view.plannedFindingCount}</dd>
        </div>
        <div>
          <dt>High-priority packs</dt>
          <dd>{view.highPackCount}</dd>
        </div>
        <div>
          <dt>Handoff entries</dt>
          <dd>{view.handoffEntryCount}</dd>
        </div>
        <div>
          <dt>Fixed/residual</dt>
          <dd>{view.fixedFindingCount}/{view.residualFindingCount}</dd>
        </div>
      </dl>
    </div>
  );
}

function renderInsightDeck(insights: InsightCardView[]): ReactNode {
  return (
    <section className="report-insight-deck" data-testid="report-insight-deck" id="report-insight-deck">
      {insights.map(insight => {
        const content = (
          <>
            <div className="report-insight-card__header">
              <span className="report-insight-card__label">{insight.label}</span>
              <span className={insight.tagClass}>{insight.metric}</span>
            </div>
            <strong>{insight.title}</strong>
            <p>{insight.detail}</p>
          </>
        );
        if (insight.href) {
          return (
            <Link className={getInsightTone(insight.tone)} data-testid={`report-insight-${insight.id}`} href={insight.href} key={insight.id}>
              {content}
            </Link>
          );
        }
        return (
          <article className={getInsightTone(insight.tone)} data-testid={`report-insight-${insight.id}`} key={insight.id}>
            {content}
          </article>
        );
      })}
    </section>
  );
}

function getReviewPathClass(step: ReviewPathStepView): string {
  if (step.tone === "danger") return "report-review-step report-review-step--danger";
  if (step.tone === "warning") return "report-review-step report-review-step--warning";
  if (step.tone === "success") return "report-review-step report-review-step--success";
  if (step.tone === "info") return "report-review-step report-review-step--info";
  return "report-review-step";
}

function renderReviewPath(steps: ReviewPathStepView[]): ReactNode {
  return (
    <nav className="report-review-path" data-testid="report-review-path" aria-label="Report review path">
      <div className="report-review-path__header">
        <span className="tag tag--info">Review flow</span>
        <div>
          <h2>How to read this report</h2>
          <p>Follow the path from decision to evidence to fix. Each step jumps to the exact board that explains the result.</p>
        </div>
      </div>
      <div className="report-review-path__grid">
        {steps.map(step => (
          <a className={getReviewPathClass(step)} data-testid={`report-review-step-${step.id}`} href={step.href} key={step.id}>
            <span className="report-review-step__index">{step.label}</span>
            <div className="report-review-step__body">
              <div className="report-review-step__header">
                <strong>{step.title}</strong>
                <span className={step.tagClass}>{step.metric}</span>
              </div>
              <p>{step.detail}</p>
            </div>
          </a>
        ))}
      </div>
    </nav>
  );
}

function renderFindingActionQueue(view: FindingActionQueueView): ReactNode {
  return (
    <section className="portal-panel report-action-queue" data-testid="report-action-queue" id="report-action-queue">
      <PortalSectionHeader
        badgeLabel="Action queue"
        badgeClassName={view.urgentCount > 0 ? "tag tag--danger" : view.rows.length > 0 ? "tag tag--warning" : "tag tag--success"}
        title="What to work on first"
        description="This converts the report into a bounded queue: impact, owner signal, suggested action, location, and remediation-pack coverage."
      />
      <div className="report-action-queue__summary" data-testid="report-action-queue-summary">
        <article>
          <span className="report-summary-card__label">Queued now</span>
          <strong>{view.rows.length}</strong>
        </article>
        <article>
          <span className="report-summary-card__label">Urgent</span>
          <strong>{view.urgentCount}</strong>
        </article>
        <article>
          <span className="report-summary-card__label">Mapped to packs</span>
          <strong>{view.plannedCount}/{view.totalFindingCount}</strong>
        </article>
      </div>
      <div className="report-action-queue__rows">
        {view.rows.length === 0 ? <p className="subtle-note">No findings need action from this report.</p> : null}
        {view.rows.map((finding, index) => (
          <a className={`report-action-row report-action-row--${finding.severity}`} data-testid={`report-action-row-${index + 1}`} href={`#${finding.domId}`} key={finding.domId}>
            <span className="report-action-row__rank">{index + 1}</span>
            <div className="report-action-row__body">
              <div className="report-action-row__header">
                <h3>{finding.title}</h3>
                <div className="portal-inline-actions">
                  <span className={getTagTone(finding.severity)}>{finding.severity}</span>
                  <span className={finding.packTagClass}>{finding.packLabel ?? "unpacked"}</span>
                </div>
              </div>
              <p>{finding.suggestion}</p>
              <div className="report-action-row__meta">
                <span>{finding.roleName}</span>
                <span>{finding.evidenceCount} evidence ref{finding.evidenceCount === 1 ? "" : "s"}</span>
                {finding.pathPreview ? <DataPath value={finding.pathPreview} /> : <span>No path anchor</span>}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function renderAgentWorkflowMap(view: AgentWorkflowView): ReactNode {
  return (
    <section className="portal-panel report-agent-workflow" data-testid="report-agent-workflow" id="report-agent-workflow">
      <PortalSectionHeader
        badgeLabel="Agent workflow"
        badgeClassName={view.statusCounts.failed > 0 ? "tag tag--danger" : view.statusCounts.pending > 0 ? "tag tag--warning" : "tag tag--success"}
        title="Execution map"
        description={view.overview}
      />
      <div className="report-workflow-meter" data-testid="report-agent-workflow-meter">
        <div>
          <span className="report-summary-card__label">Checkpoint progress</span>
          <strong>{view.progressPercent}%</strong>
        </div>
        <div className="report-workflow-track" aria-hidden="true">
          <span style={{ width: `${view.progressPercent}%` }} />
        </div>
      </div>
      <div className="report-workflow-stats" data-testid="report-agent-workflow-stats">
        <span className="tag tag--success">succeeded {view.statusCounts.succeeded}</span>
        <span className="tag tag--info">running {view.statusCounts.running}</span>
        <span className="tag tag--neutral">pending {view.statusCounts.pending}</span>
        <span className="tag tag--warning">skipped {view.statusCounts.skipped}</span>
        <span className="tag tag--danger">failed {view.statusCounts.failed}</span>
        <span className="tag tag--neutral">roles {view.roleCount}</span>
        <span className="tag tag--neutral">executors {view.executorCount}</span>
        <span className="tag tag--neutral">handoffs {view.handoffCount}</span>
      </div>
      <div className="report-workflow-timeline" data-testid="report-agent-workflow-timeline">
        <div className="report-workflow-timeline__header">
          <h3>Execution timeline</h3>
          <span className="tag tag--neutral">{view.checkpoints.length} checkpoint{view.checkpoints.length === 1 ? "" : "s"}</span>
        </div>
        {view.checkpoints.length === 0 ? <p className="subtle-note">No timeline checkpoints were recorded.</p> : null}
        <div className="report-workflow-timeline__grid">
          {view.checkpoints.map(step => (
            <article className="report-workflow-checkpoint" data-testid={`report-agent-workflow-checkpoint-${toStableId(step.id)}`} key={step.id}>
              <div className="report-workflow-checkpoint__header">
                <span className="tag tag--neutral">{step.kindLabel}</span>
                <span className={step.tagClass}>{step.status}</span>
              </div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
              <span className="report-duration-chip">{step.durationLabel}</span>
            </article>
          ))}
        </div>
      </div>
      {view.slowestRoles.length > 0 ? (
        <div className="report-workflow-slowest" data-testid="report-agent-workflow-slowest">
          {view.slowestRoles.map(role => (
            <article className="report-workflow-role" data-testid={`report-agent-workflow-role-${toStableId(role.id)}`} key={role.id}>
              <div className="report-workflow-role__header">
                <strong>{role.title}</strong>
                <span className={role.tagClass}>{role.status}</span>
              </div>
              <span className="report-duration-chip">{role.durationLabel}</span>
              <p>{role.detail}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="subtle-note">No completed role durations were recorded yet.</p>
      )}
    </section>
  );
}

function renderFindingTriageBoard(view: FindingTriageView): ReactNode {
  return (
    <section className="portal-panel report-triage-board" data-testid="report-triage-board" id="report-triage-board">
      <PortalSectionHeader
        badgeLabel="Triage"
        badgeClassName={view.blockingCount > 0 ? "tag tag--danger" : view.investigationOrder.length > 0 ? "tag tag--warning" : "tag tag--success"}
        title="Finding triage board"
        description={`${view.sourceLinkedCount} source-linked finding${view.sourceLinkedCount === 1 ? "" : "s"} across ${view.pathCount} path${view.pathCount === 1 ? "" : "s"}. Start with blocking/high clusters before opening the full list.`}
      />
      <div className="report-triage-layout">
        <div className="report-triage-clusters" data-testid="report-triage-clusters">
          {view.categoryClusters.length === 0 ? <p className="subtle-note">No findings to cluster.</p> : null}
          {view.categoryClusters.map(cluster => (
            <article className="report-triage-cluster" data-testid={`report-triage-cluster-${toStableId(cluster.category)}`} key={cluster.category}>
              <div className="report-triage-cluster__header">
                <strong>{cluster.category}</strong>
                <span className={cluster.blockingCount > 0 || cluster.high > 0 ? "tag tag--danger" : cluster.medium > 0 ? "tag tag--warning" : "tag tag--success"}>
                  {cluster.count} finding{cluster.count === 1 ? "" : "s"}
                </span>
              </div>
              <p>{cluster.title}</p>
              <div className="report-triage-cluster__counts">
                <span>blocking {cluster.blockingCount}</span>
                <span>high {cluster.high}</span>
                <span>medium {cluster.medium}</span>
                <span>low {cluster.low}</span>
              </div>
              {cluster.roleNames.length > 0 ? <DataChipList items={cluster.roleNames.slice(0, 4)} /> : null}
              {cluster.domId ? (
                <a className="report-remediation-stage__link" href={`#${cluster.domId}`} data-testid={`report-triage-open-${toStableId(cluster.category)}`}>
                  Open first finding
                </a>
              ) : null}
            </article>
          ))}
        </div>
        <div className="report-investigation-order" data-testid="report-investigation-order">
          <h3>Investigation order</h3>
          {view.investigationOrder.length === 0 ? <p className="subtle-note">No findings require investigation.</p> : null}
          {view.investigationOrder.map((finding, index) => (
            <a className="report-investigation-row" href={`#${finding.domId}`} key={finding.domId}>
              <span>{index + 1}</span>
              <div>
                <strong>{finding.title}</strong>
                <p>{finding.suggestion}</p>
              </div>
              <div className="report-investigation-row__meta">
                <span className={getTagTone(finding.severity)}>{finding.severity}</span>
                <span className="tag tag--neutral">{finding.evidenceCount} evidence</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function renderArtifactTrustBoard(view: ArtifactTrustView): ReactNode {
  return (
    <section className="report-artifact-trust" data-testid="report-artifact-trust" id="report-artifact-trust">
      <div className="report-artifact-trust__header">
        <div>
          <span className={view.tagClass}>{view.statusLabel}</span>
          <h3>Artifact trust board</h3>
          <p>{view.statusDetail}</p>
        </div>
      </div>
      <div className="report-artifact-trust__grid">
        <article className="report-artifact-trust__card">
          <strong>Produced by kind</strong>
          {view.producedByKind.length === 0 ? <p className="subtle-note">No artifact kind counts were recorded.</p> : null}
          <div className="report-artifact-kind-grid">
            {view.producedByKind.map(item => (
              <span className="tag tag--neutral" key={item.kind}>{item.kind} {item.count}</span>
            ))}
          </div>
        </article>
        <article className="report-artifact-trust__card">
          <strong>Coverage</strong>
          {view.missingKinds.length === 0 ? <p>No required artifact kinds are missing.</p> : <DataChipList items={view.missingKinds} />}
          {view.invalidArtifacts.length > 0 ? (
            <>
              <strong>Invalid artifacts</strong>
              <DataChipList items={view.invalidArtifacts} />
            </>
          ) : null}
        </article>
        <article className="report-artifact-trust__card report-artifact-trust__card--wide">
          <strong>Notable evidence</strong>
          {view.notableArtifacts.length === 0 ? <p className="subtle-note">No notable artifacts were highlighted by the run.</p> : null}
          <div className="report-artifact-notables">
            {view.notableArtifacts.map(artifact => (
              artifact.href ? (
                <a href={artifact.href} target="_blank" rel="noreferrer" key={artifact.key}>
                  <span className="tag tag--info">{artifact.kind}</span>
                  <DataPath value={artifact.name} />
                </a>
              ) : (
                <span key={artifact.key}>
                  <span className="tag tag--info">{artifact.kind}</span>
                  <DataPath value={artifact.name} />
                </span>
              )
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function getRoleResultClass(role: RoleResultView): string {
  if (role.tone === "danger") return "report-role-card report-role-card--danger";
  if (role.tone === "warning") return "report-role-card report-role-card--warning";
  if (role.tone === "success") return "report-role-card report-role-card--success";
  if (role.tone === "info") return "report-role-card report-role-card--info";
  return "report-role-card";
}

function renderRoleCard(role: RoleResultView, testId: string): ReactNode {
  return (
    <article className={getRoleResultClass(role)} data-testid={testId} key={role.id}>
      <div className="report-role-card__header">
        <strong>{role.title}</strong>
        <span className={role.tagClass}>{role.score === null ? role.status : role.score}</span>
      </div>
      <p>{role.detail}</p>
      <div className="report-role-card__metrics">
        <span>{role.status}</span>
        <span>{role.findingCount} finding{role.findingCount === 1 ? "" : "s"}</span>
        <span>{role.blockingCount} blocking</span>
        <span>{role.sectionCount} section{role.sectionCount === 1 ? "" : "s"}</span>
      </div>
      <div className="portal-inline-actions">
        {role.findingHref ? <a className="report-remediation-stage__link" href={role.findingHref}>Open finding</a> : null}
        {role.sectionHref ? <a className="report-remediation-stage__link" href={role.sectionHref}>Open section</a> : null}
      </div>
    </article>
  );
}

function renderRoleHealthBoard(view: RoleHealthView): ReactNode {
  return (
    <section className="portal-panel report-role-health" data-testid="report-role-health" id="report-role-health">
      <PortalSectionHeader
        badgeLabel="Role intelligence"
        badgeClassName={view.averageScore !== null && view.averageScore >= 80 ? "tag tag--success" : "tag tag--warning"}
        title="Role and skill health"
        description={`${view.readyCount}/${view.roleCount} roles ready. ${view.skillCount} skill score${view.skillCount === 1 ? "" : "s"} emitted. Average role score ${view.averageScore ?? "n/a"}.`}
      />
      <div className="report-role-health__summary" data-testid="report-role-health-summary">
        <article>
          <span className="report-summary-card__label">Average role score</span>
          <strong>{view.averageScore ?? "n/a"}</strong>
        </article>
        <article>
          <span className="report-summary-card__label">Ready roles</span>
          <strong>{view.readyCount}/{view.roleCount}</strong>
        </article>
        <article>
          <span className="report-summary-card__label">Skill scores</span>
          <strong>{view.skillCount}</strong>
        </article>
      </div>
      <div className="report-role-health__columns">
        <div className="report-role-health__column" data-testid="report-role-attention">
          <h3>Needs attention</h3>
          {view.attentionRoles.length === 0 ? <p className="subtle-note">No role attention data was emitted.</p> : null}
          {view.attentionRoles.map(role => renderRoleCard(role, `report-role-attention-${toStableId(role.id)}`))}
        </div>
        <div className="report-role-health__column" data-testid="report-role-contribution">
          <h3>Most productive</h3>
          {view.productiveRoles.length === 0 ? <p className="subtle-note">No role contribution data was emitted.</p> : null}
          {view.productiveRoles.map(role => renderRoleCard(role, `report-role-productive-${toStableId(role.id)}`))}
        </div>
      </div>
      <div className="report-skill-strip" data-testid="report-skill-coverage">
        <h3>Weakest covered skills</h3>
        {view.weakestSkills.length === 0 ? <p className="subtle-note">No skill scorecard was emitted.</p> : null}
        <div className="report-skill-grid">
          {view.weakestSkills.map(skill => (
            <article className={`report-skill-card report-skill-card--${skill.tone}`} data-testid={`report-skill-${toStableId(skill.id)}`} key={skill.id}>
              <div className="report-skill-card__header">
                <strong>{skill.name}</strong>
                <span className={skill.tagClass}>{skill.score}</span>
              </div>
              <p>{skill.rationale}</p>
              {skill.coveredRoles.length > 0 ? <DataChipList items={skill.coveredRoles.slice(0, 5)} /> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function renderFixHandoff(report: AnalysisReport): ReactNode {
  const handoff = report.summary.fixHandoff;
  if (!handoff || handoff.entries.length === 0) {
    return null;
  }

  return (
    <section className="report-fix-handoff" data-testid="report-fix-handoff">
      <PortalSectionHeader
        badgeLabel="Action board"
        badgeClassName="tag tag--info"
        title="Implementation handoff"
        description="Concrete work slices, target files, validation commands, rollback notes, and follow-ups extracted from the agent handoff."
      />
      <div className="report-fix-handoff__grid">
        {handoff.entries.map((entry, index) => (
          <article className="report-fix-card" data-testid={`report-fix-handoff-entry-${index + 1}`} key={`${entry.title}:${index}`}>
            <div className="report-fix-card__header">
              <span className="tag tag--neutral">slice {index + 1}</span>
              {entry.remediationPackId ? <span className="tag tag--info">{entry.remediationPackId}</span> : null}
            </div>
            <strong>{entry.title}</strong>
            <p>{entry.summary}</p>
            {entry.targetFiles.length > 0 ? (
              <div className="report-fix-card__block">
                <span>Target files</span>
                <DataChipList items={entry.targetFiles} />
              </div>
            ) : null}
            {entry.validationCommands.length > 0 ? (
              <div className="report-fix-card__block">
                <span>Validation</span>
                <DataCommandList commands={entry.validationCommands} />
              </div>
            ) : null}
            {entry.rollbackNotes.length > 0 ? (
              <div className="report-fix-card__block">
                <span>Rollback</span>
                <ul className="report-compact-list">
                  {entry.rollbackNotes.map(note => <li key={note}>{note}</li>)}
                </ul>
              </div>
            ) : null}
            {entry.followUps.length > 0 ? (
              <div className="report-fix-card__block">
                <span>Follow-ups</span>
                <ul className="report-compact-list">
                  {entry.followUps.map(note => <li key={note}>{note}</li>)}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {handoff.validationCommands.length > 0 || handoff.rollbackNotes.length > 0 ? (
        <div className="report-fix-handoff__footer" data-testid="report-fix-handoff-global">
          {handoff.validationCommands.length > 0 ? (
            <div>
              <strong>Global validation</strong>
              <DataCommandList commands={handoff.validationCommands} />
            </div>
          ) : null}
          {handoff.rollbackNotes.length > 0 ? (
            <div>
              <strong>Global rollback notes</strong>
              <ul className="report-compact-list">
                {handoff.rollbackNotes.map(note => <li key={note}>{note}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default async function WorkspaceReportPage({
  params,
}: {
  params: Promise<{ workspaceId: string; reportId: string }>;
}) {
  const { workspaceId, reportId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/reports/${reportId}`);

  try {
    const report = await getHostedReport(reportId);
    const [job, currentUser, workspaceConsole, latestRemediationJob] = await Promise.all([
      getHostedJob(report.jobId),
      getCurrentUser(),
      getWorkspaceConsole(workspaceId),
      report.summary.latestRemediationJobId
        ? getHostedJob(report.summary.latestRemediationJobId).catch(() => null)
        : Promise.resolve(null),
    ]);
    const roleLookup = new Map(report.roles.map(role => [role.id, role.title]));
    const canMutate = canManageWorkspaceRemediation(currentUser.id === workspaceConsole.workspace.ownerUserId);
    if (!isWorkspaceScopedReportPageContext(
      workspaceId,
      [report, job.job, latestRemediationJob?.job],
      workspaceConsole,
    )) {
      throw new ApiResponseError(404, `Report ${reportId} does not belong to workspace ${workspaceId}.`);
    }
    const sourceOptions: SourceOption[] = [
      {
        id: job.job.sourceId,
        displayName: workspaceConsole.sources.find(source => source.id === job.job.sourceId)?.displayName ?? "Primary source",
        type: job.job.sourceType,
      },
      ...(job.job.companionSourceId && job.job.companionSourceType
        ? [{
            id: job.job.companionSourceId,
            displayName: workspaceConsole.sources.find(source => source.id === job.job.companionSourceId)?.displayName ?? "Companion source",
            type: job.job.companionSourceType,
          }]
        : []),
    ];
    const resolveFindingSources = (sourceIds: string[]) => sourceOptions.filter(source => sourceIds.includes(source.id));
    const resolveFindingPath = (paths: string[]) => paths.length === 1 ? paths[0] : null;
    const getRoleTitle = (roleId: string) => roleLookup.get(roleId) ?? roleId;
    const remediationSourceId = latestRemediationJob?.job.sourceId ?? job.job.sourceId;
    const remediationSourceOption = sourceOptions.find(source => source.id === remediationSourceId) ?? sourceOptions[0] ?? null;
    const sectionsEmptyState = getWorkspaceReportSectionsEmptyState({ totalFindings: report.summary.totalFindings });
    const findingsEmptyState = getWorkspaceReportFindingsEmptyState({
      releaseGateStatus: report.summary.releaseGateDecision?.status ?? null,
      sectionsCount: report.sections.length,
    });
    const remediationSummary = getWorkspaceReportRemediationSummary({
      changesetGenerated: Boolean(report.summary.changeset),
      latestRemediationJobId: report.summary.latestRemediationJobId,
      latestRemediationJobStatus: latestRemediationJob?.job.status ?? null,
    });
    const remediationBranchName = getChangesetBranchName({
      branchName: report.summary.changeset?.branchName ?? null,
      pullInstructions: report.summary.changeset?.pullInstructions ?? [],
    });
    const analysisJobHref = getWorkspaceRunHref(workspaceId, report.jobId);
    const gateStatus = report.summary.releaseGateDecision?.status ?? null;
    const blockingFindingIds = new Set(report.summary.releaseGateDecision?.blockingFindingIds ?? []);
    const sortedFindings = sortFindings(report.findings, blockingFindingIds);
    const blockingFindings = sortedFindings.filter(finding => blockingFindingIds.has(finding.id));
    const highlightedFindings = dedupeFindingsForDisplay(
      blockingFindings.length > 0 ? blockingFindings : sortedFindings.filter(finding => finding.severity === "high"),
      5,
    );
    const reportArtifactCount = report.artifacts.length + (latestRemediationJob?.artifacts.length ?? 0);
    const artifactViews = buildArtifactViews(report.artifacts, report.jobId);
    const visualArtifacts = artifactViews.filter(view => isImageArtifact(view.artifact)).slice(0, 8);
    const artifactGroups = groupArtifactViews(artifactViews);
    const qualityScorecard = report.summary.qualityScorecard;
    const artifactAnalysis = report.summary.artifactAnalysis;
    const executionCoverage = report.summary.executionCoverage;
    const executionSteps = sortExecutionSteps(report.summary.executionSteps);
    const executionStepGroups = groupExecutionSteps(executionSteps);
    const executorStepCount = executionSteps.filter(step => step.stepType === "executor").length;
    const roleScores = qualityScorecard?.roleScores ?? [];
    const readyRoles = roleScores.filter(role => role.status === "ready").length;
    const artifactSummary = formatArtifactSummary(reportArtifactCount, artifactAnalysis);
    const remediationCommand = buildRemediationCommandView({
      canMutate,
      latestRemediationJobId: report.summary.latestRemediationJobId,
      latestRemediationJobStatus: latestRemediationJob?.job.status ?? null,
      remediationBranchName,
      remediationSourceId,
      report,
      workspaceId,
    });
    const insightCards = buildInsightCards({
      analysisJobHref,
      artifactAnalysis,
      blockingFindings,
      highlightedFindings,
      latestRemediationJobId: report.summary.latestRemediationJobId,
      latestRemediationJobStatus: latestRemediationJob?.job.status ?? null,
      qualityScorecard,
      remediationBranchName,
      remediationSourceId,
      report,
      workspaceId,
    });
    const agentWorkflow = buildAgentWorkflowView(executionSteps);
    const findingTriage = buildFindingTriageView({
      blockingFindingIds,
      getRoleTitle,
      sortedFindings,
    });
    const findingActionQueue = buildFindingActionQueueView({
      blockingFindingIds,
      getRoleTitle,
      remediationPacks: report.summary.remediationPacks,
      sortedFindings,
    });
    const artifactTrust = buildArtifactTrustView({
      artifactAnalysis,
      artifactViews,
    });
    const roleHealth = buildRoleHealthView({
      blockingFindingIds,
      getRoleTitle,
      report,
      sortedFindings,
    });
    const reportDiagnostics = buildReportDiagnostics(report);
    const reviewPath = buildReviewPath({
      agentWorkflow,
      artifactTrust,
      findingTriage,
      remediationCommand,
      report,
      roleHealth,
    });

    return (
      <PortalShell
        eyebrow="Workspace report"
        title={report.title}
        pageTestId="workspace-report-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="reports"
      >
        <section className={`report-hero report-hero--${gateStatus ?? "unknown"}`} data-testid="report-hero">
          <div className="report-hero__copy">
            <div className="portal-inline-actions">
              <span className={getReleaseGateTagClass(gateStatus)}>Release gate {gateStatus ?? "n/a"}</span>
              <span className="tag tag--neutral">{report.runtimeMode}</span>
              <span className="tag tag--neutral">{formatTimestamp(report.createdAt)}</span>
            </div>
            <h2>{report.title}</h2>
            <p>
              {report.summary.releaseGateDecision?.reason
                ?? "Report output is ready for review."}
            </p>
          </div>
          <aside className="report-hero__score" data-testid="report-quality-overview">
            <span className="report-hero__score-label">Quality score</span>
            <strong>{qualityScorecard?.overallScore ?? "n/a"}</strong>
            <p>
              {qualityScorecard
                ? `${qualityScorecard.dimensions.length} scored dimension${qualityScorecard.dimensions.length === 1 ? "" : "s"} · ${readyRoles}/${roleScores.length} roles ready`
                : "No scorecard in this report."}
            </p>
          </aside>
        </section>

        {renderDecisionCockpit({
          agentWorkflow,
          artifactTrust,
          blockingFindingIds,
          findingTriage,
          highlightedFindings,
          jobStatus: job.job.status,
          remediationCommand,
          report,
          reportDiagnostics,
          roleHealth,
        })}

        <section className="report-grid report-grid--summary">
          <article className="report-summary-card" data-testid="report-summary-total">
            <span className="report-summary-card__label">Total findings</span>
            <strong className="report-summary-card__value">{report.summary.totalFindings}</strong>
            <span>{formatCategoryCounts(report.summary.categoryCounts)}</span>
          </article>
          <article className="report-summary-card report-summary-card--high" data-testid="report-summary-high">
            <span className="report-summary-card__label">High</span>
            <strong className="report-summary-card__value">{report.summary.high}</strong>
            <span>{blockingFindingIds.size} blocking</span>
          </article>
          <article className="report-summary-card report-summary-card--medium" data-testid="report-summary-medium">
            <span className="report-summary-card__label">Medium</span>
            <strong className="report-summary-card__value">{report.summary.medium}</strong>
            <span>Needs triage</span>
          </article>
          <article className="report-summary-card report-summary-card--low" data-testid="report-summary-low">
            <span className="report-summary-card__label">Low</span>
            <strong className="report-summary-card__value">{report.summary.low}</strong>
            <span>Opportunistic</span>
          </article>
        </section>

        {renderReviewPath(reviewPath)}

        {renderFindingActionQueue(findingActionQueue)}

        <details className="report-detail-drawer" data-testid="report-insight-drawer">
          <summary>
            <span>Open detailed insight cards</span>
            <span>{insightCards.length} cards</span>
          </summary>
          {renderInsightDeck(insightCards)}
        </details>

        {renderAgentWorkflowMap(agentWorkflow)}

        {renderRoleHealthBoard(roleHealth)}

        {renderFindingTriageBoard(findingTriage)}

        {renderArtifactTrustBoard(artifactTrust)}

        {highlightedFindings.length > 0 ? (
          <section className="portal-panel report-priority-panel" data-testid="report-priority-findings">
            <PortalSectionHeader
              badgeLabel="Priority"
              badgeClassName={getWorkspaceReportFindingsEmptyStateTagClass(gateStatus)}
              title={blockingFindings.length > 0 ? "Blocking findings" : "Highest severity findings"}
              description="The findings most likely to affect release readiness are pulled forward from the full report below."
            />
            <div className="report-priority-list">
              {highlightedFindings.map((finding, index) => (
                <article className="report-priority-row" key={`${finding.id}:${index}`}>
                  <span className={getTagTone(finding.severity)}>{finding.severity}</span>
                  <div>
                    <h3>{finding.title}</h3>
                    <p>{finding.message}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="portal-grid report-overview-grid">
          <article className="portal-panel" data-testid="report-quality-panel">
            <PortalSectionHeader
              badgeLabel="Scorecard"
              badgeClassName={qualityScorecard && qualityScorecard.overallScore >= 80 ? "tag tag--success" : "tag tag--warning"}
              title="Quality scorecard"
            />
            {qualityScorecard ? (
              <div className="report-score-stack">
                {qualityScorecard.dimensions.map(renderQualityDimension)}
                {qualityScorecard.warnings.length > 0 ? (
                  <div className="report-warning-box" data-testid="report-quality-warnings">
                    <strong>Warnings</strong>
                    <ul className="report-compact-list">
                      {qualityScorecard.warnings.map(warning => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : <p className="subtle-note">No quality scorecard was included in this report.</p>}
          </article>

          <article className="portal-panel" data-testid="report-execution-coverage">
            <PortalSectionHeader
              badgeLabel="Execution"
              badgeClassName={executionCoverage.skipped.length > 0 ? "tag tag--warning" : "tag tag--success"}
              title="Execution coverage"
            />
            <div className="report-coverage-grid">
              <div>
                <span className="report-summary-card__label">Attempted</span>
                <strong>{executionCoverage.attempted.length}</strong>
              </div>
              <div>
                <span className="report-summary-card__label">Skipped</span>
                <strong>{executionCoverage.skipped.length}</strong>
              </div>
            </div>
            {executionCoverage.attempted.length > 0 ? (
              <div className="report-coverage-list">
                {executionCoverage.attempted.map(item => (
                  <article className="report-coverage-row" key={item.id}>
                    <span className={getTagTone(item.status)}>{item.status}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="subtle-note">No attempted execution coverage was recorded.</p>}
          </article>

          <article className="portal-panel xl:col-span-2" data-testid="report-capability-panel">
            <PortalSectionHeader
              badgeLabel="Capability"
              badgeClassName={report.summary.capabilityGaps.length > 0 ? "tag tag--warning" : "tag tag--success"}
              title="Capability gaps"
            />
            {report.summary.capabilityGaps.length === 0 ? <p className="subtle-note">No capability gaps were recorded.</p> : null}
            {report.summary.capabilityGaps.length > 0 ? (
              <div className="report-gap-grid">
                {report.summary.capabilityGaps.map(renderCapabilityGap)}
              </div>
            ) : null}
          </article>
        </section>

        <section className="portal-grid" id="report-remediation-panel">
          <article className="portal-panel xl:col-span-2" data-testid="report-remediation-panel">
            <PortalSectionHeader
              badgeLabel="Remediation"
              badgeClassName="tag tag--warning"
              title="Fix readiness"
            />
            {renderRemediationCommandCenter(remediationCommand)}
            <PortalMetaList
              items={[
                {
                  label: "Release gate",
                  value: (
                    <span className={getReleaseGateTagClass(gateStatus)}>
                      {gateStatus ?? "n/a"}{report.summary.releaseGateDecision ? ` · ${report.summary.releaseGateDecision.reason}` : ""}
                    </span>
                  ),
                },
                { label: "Remediation packs", value: report.summary.remediationPacks.length },
                { label: "Fix handoff entries", value: report.summary.fixHandoff?.entries.length ?? 0 },
              ]}
            />
            {report.summary.remediationPacks.length > 0 ? (
              <div className="report-pack-grid">
                {report.summary.remediationPacks.map(renderRemediationPack)}
              </div>
            ) : null}
            {renderFixHandoff(report)}
            <ReportRemediationForm
              workspaceId={workspaceId}
              reportId={report.id}
              defaultSourceId={remediationSourceId}
              sourceOptions={sourceOptions}
              findingOptions={report.findings.map(finding => ({
                id: finding.id,
                title: finding.title,
                severity: finding.severity,
              }))}
              canMutate={canMutate}
            />
            {report.summary.changeset ? (
              <article className="portal-record-card" data-testid="report-remediation-changeset">
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <strong>Latest remediation output</strong>
                    <p><DataValue value={remediationBranchName ?? "Branch not created yet"} /></p>
                  </div>
                  <div className="portal-record-card__meta">
                    <span className="tag tag--info">
                      {report.summary.changeset.changedFiles.length} file{report.summary.changeset.changedFiles.length === 1 ? "" : "s"}
                    </span>
                    <span className={report.summary.changeset.validationPassed ? "tag tag--success" : "tag tag--warning"}>
                      {report.summary.changeset.validationPassed ? "validation passed" : "validation not green"}
                    </span>
                  </div>
                </div>
                <PortalMetaList
                  items={[
                    { label: "Branch", value: <DataValue value={remediationBranchName ?? "not created"} /> },
                    { label: "Source", value: remediationSourceOption?.displayName ?? "unknown" },
                    { label: "Stop reason", value: report.summary.changeset.stopReason },
                    ...(report.summary.changeset.validationCommands.length > 0
                      ? [{ label: "Validation", value: <DataCommandList commands={report.summary.changeset.validationCommands} /> }]
                      : []),
                  ]}
                />
                {report.summary.changeset.changedFiles.length > 0 ? (
                  <DataChipList items={report.summary.changeset.changedFiles} />
                ) : null}
                {report.summary.latestRemediationJobId ? (
                  <div className="portal-record-card__actions">
                    <Link className="button-ghost" data-testid="report-open-remediation-job" href={`/portal/workspaces/${workspaceId}/runs/${report.summary.latestRemediationJobId}` as Route}>Open remediation run</Link>
                  </div>
                ) : null}
                {report.summary.changeset.changedFiles.length > 0 ? (
                  <div className="portal-record-card__body">
                    <PortalLinkGrid testId="report-remediation-code-grid">
                      {report.summary.changeset.changedFiles.map(file => (
                        <PortalLinkCard
                          testId={`report-open-remediation-code-${toStableId(file)}`}
                          href={getWorkspaceReportRemediationCodeHref({
                            workspaceId,
                            sourceId: remediationSourceId,
                            reportId: report.id,
                            filePath: file,
                            branchName: remediationBranchName,
                            baseRef: report.summary.changeset?.baseRef ?? null,
                          })}
                          title={<DataPath value={file} />}
                          eyebrow="changed file"
                          key={file}
                          tone="info"
                        />
                      ))}
                    </PortalLinkGrid>
                  </div>
                ) : null}
              </article>
            ) : (
              <article className="portal-record-card" data-testid="report-remediation-changeset-empty">
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <strong>{remediationSummary.title}</strong>
                    <p>{remediationSummary.detail}</p>
                  </div>
                  <div className="portal-record-card__meta">
                    <span className={remediationSummary.tagClass}>Remediation status</span>
                  </div>
                </div>
                {remediationSummary.canOpenRun && report.summary.latestRemediationJobId ? (
                  <div className="portal-record-card__actions">
                    <Link className="button-ghost" data-testid="report-open-remediation-job" href={`/portal/workspaces/${workspaceId}/runs/${report.summary.latestRemediationJobId}` as Route}>Open remediation run</Link>
                  </div>
                ) : null}
              </article>
            )}
          </article>
        </section>

        <details className="report-detail-drawer" data-testid="report-sections-drawer" open={report.sections.length <= 8}>
          <summary>
            <span>Normalized sections</span>
            <span>{report.sections.length} section{report.sections.length === 1 ? "" : "s"}</span>
          </summary>
          <section className="portal-grid">
            <article className="portal-panel xl:col-span-2">
              <PortalSectionHeader
                badgeLabel="Sections"
                title="Normalized sections"
                description="Role output is grouped into readable summaries with structured payloads available inline."
              />
            </article>
            {report.sections.length === 0 ? (
              <article className="portal-panel xl:col-span-2" data-testid="report-sections-empty-state">
                <span className="tag tag--neutral">Sections</span>
                <h2>{sectionsEmptyState.title}</h2>
                <p>{sectionsEmptyState.detail}</p>
              </article>
            ) : null}
            {report.sections.map(section => (
              <article className="portal-panel report-section-card" data-testid={`report-section-${section.id}`} id={`section-${toStableId(section.id)}`} key={section.id}>
                <div className="report-section-card__header">
                  <span className={getTagTone(String(section.status).toLowerCase())}>{section.status}</span>
                  <span className="tag tag--neutral">{getRoleTitle(section.roleId)}</span>
                </div>
                <h2>{section.title}</h2>
                <p>{section.summary}</p>
                {renderStructuredData(section)}
              </article>
            ))}
          </section>
        </details>

        <details className="report-detail-drawer" data-testid="report-findings-drawer" id="report-findings-detail">
          <summary>
            <span>Full finding list</span>
            <span>{report.findings.length} finding{report.findings.length === 1 ? "" : "s"}</span>
          </summary>
          <section className="portal-grid">
            <article className="portal-panel xl:col-span-2">
              <PortalSectionHeader
                badgeLabel="Findings"
                badgeClassName={getWorkspaceReportFindingsEmptyStateTagClass(gateStatus)}
                title="Findings"
                description="The complete finding list is collapsed by default. Use the triage board first, then open this drawer when you need every record."
              />
            </article>
            {report.findings.length === 0 ? (
              <article className="portal-panel xl:col-span-2" data-testid="report-findings-empty-state">
                <span className={getWorkspaceReportFindingsEmptyStateTagClass(report.summary.releaseGateDecision?.status ?? null)}>Findings</span>
                <h2>{findingsEmptyState.title}</h2>
                <p>{findingsEmptyState.detail}</p>
              </article>
            ) : null}
            {sortedFindings.map((finding, index) => {
              const findingSources = resolveFindingSources(finding.sourceIds);
              const findingPath = resolveFindingPath(finding.paths);
              const findingDomId = getFindingDomId(finding, index);
              return (
                <article className={`portal-record-card report-finding-card report-finding-card--${finding.severity}`} data-testid={`report-finding-${findingDomId}`} id={findingDomId} key={`${finding.id}:${index}`}>
                  <div className="portal-record-card__header">
                    <div className="portal-record-card__title">
                      <h3>{finding.title}</h3>
                      <p>{finding.message}</p>
                    </div>
                    <div className="portal-record-card__meta">
                      {blockingFindingIds.has(finding.id) ? <span className="tag tag--danger">blocking</span> : null}
                      <span className={getTagTone(String(finding.severity).toLowerCase())}>{finding.severity}</span>
                      <span className="tag tag--neutral">{findingSources.length || 0} source{findingSources.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <PortalMetaList
                    items={[
                      { label: "Role", value: getRoleTitle(finding.roleId) },
                      { label: "Category", value: formatKeyLabel(finding.category) },
                      { label: "Suggestion", value: finding.suggestion },
                      ...(finding.paths.length > 0
                        ? [{ label: "Paths", value: <DataChipList items={finding.paths} /> }]
                        : []),
                    ]}
                  />
                  {finding.evidence.length > 0 ? (
                    <div className="report-evidence-block">
                      <strong>Evidence</strong>
                      <ul className="report-evidence-list">
                        {finding.evidence.map(evidence => <li key={evidence}>{evidence}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <div className="portal-record-card__actions">
                    {findingSources.length === 1 ? (
                      <Link
                        className="button-ghost"
                        data-testid={`report-open-code-finding-${findingDomId}`}
                        href={getWorkspaceReportFindingCodeHref({
                          workspaceId,
                          sourceId: findingSources[0]!.id,
                          reportId: report.id,
                          findingId: finding.id,
                          ...(findingPath ? { filePath: findingPath } : {}),
                          branchName: remediationBranchName,
                          baseRef: report.summary.changeset?.baseRef ?? null,
                        })}
                      >
                        Open in code review
                      </Link>
                    ) : findingSources.length > 1 ? findingSources.map(source => (
                      <Link
                        className="button-ghost"
                        data-testid={`report-open-code-finding-${findingDomId}-${source.id}`}
                        href={getWorkspaceReportFindingCodeHref({
                          workspaceId,
                          sourceId: source.id,
                          reportId: report.id,
                          findingId: finding.id,
                          ...(findingPath ? { filePath: findingPath } : {}),
                          branchName: remediationBranchName,
                          baseRef: report.summary.changeset?.baseRef ?? null,
                        })}
                        key={source.id}
                      >
                        Open in {source.displayName}
                      </Link>
                    )) : (
                      <>
                        <p className="subtle-note" data-testid={`report-finding-source-ambiguous-${findingDomId}`}>
                          Source ambiguous. Choose a workspace source to inspect this finding in context.
                        </p>
                        {sourceOptions.map(source => (
                          <Link
                            className="button-ghost"
                            data-testid={`report-open-code-finding-${findingDomId}-fallback-${source.id}`}
                            href={getWorkspaceReportFindingCodeHref({
                              workspaceId,
                              sourceId: source.id,
                              reportId: report.id,
                              findingId: finding.id,
                              ...(findingPath ? { filePath: findingPath } : {}),
                              branchName: remediationBranchName,
                              baseRef: report.summary.changeset?.baseRef ?? null,
                            })}
                            key={source.id}
                          >
                            Try {source.displayName}
                          </Link>
                        ))}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </details>

        {executionStepGroups.length > 0 ? (
          <details className="report-detail-drawer" data-testid="report-execution-timeline" open={executionStepGroups.some(group => group.step.status === "failed")}>
            <summary>
              <span>Execution checkpoints</span>
              <span>{executionStepGroups.length} checkpoint{executionStepGroups.length === 1 ? "" : "s"}</span>
            </summary>
            <section className="portal-panel">
              <PortalSectionHeader
                badgeLabel="Checkpoints"
                badgeClassName="tag tag--info"
                title="Execution checkpoints"
                description={`${executionStepGroups.length} primary checkpoint${executionStepGroups.length === 1 ? "" : "s"}${executorStepCount > 0 ? ` with ${executorStepCount} executor substep${executorStepCount === 1 ? "" : "s"}` : ""}.`}
              />
              <div className="report-timeline">
                {executionStepGroups.map(renderExecutionStep)}
              </div>
            </section>
          </details>
        ) : null}

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="report-artifacts-panel">
            <PortalSectionHeader
              badgeLabel="Artifacts"
              title="Run artifacts"
              actions={<ReportExportAction reportId={report.id} />}
            />
            {artifactAnalysis ? (
              <div className="report-artifact-analysis" data-testid="report-artifacts-analysis">
                <p>{artifactSummary}</p>
                <div className="report-artifact-kind-grid">
                  {artifactGroups.map(group => (
                    <span className="tag tag--neutral" key={group.kind}>{group.kind} {group.count}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {visualArtifacts.length > 0 ? (
              <div className="report-visual-strip" data-testid="report-visual-evidence">
                {visualArtifacts.map(view => (
                  <a className="report-visual-tile" href={view.href} key={`${view.artifact.key}:${view.index}`} target="_blank" rel="noreferrer">
                    <Image src={view.href} alt={view.name} width={320} height={180} loading="lazy" unoptimized />
                    <span>{view.name}</span>
                  </a>
                ))}
              </div>
            ) : null}
            {report.artifacts.length === 0 ? <p>No artifacts registered for this run.</p> : null}
            {artifactViews.length > 0 ? (
              <details className="report-detail-drawer report-detail-drawer--embedded" data-testid="report-artifact-records-drawer">
                <summary>
                  <span>Open every artifact record</span>
                  <span>{artifactViews.length} artifact{artifactViews.length === 1 ? "" : "s"}</span>
                </summary>
                <div className="portal-record-grid">
                  {artifactViews.map(view => (
                    <article className="portal-record-card report-artifact-card" data-testid={`report-artifact-${view.index}`} key={`${view.artifact.key}:${view.index}`}>
                      {isImageArtifact(view.artifact) ? (
                        <a className="report-artifact-card__preview" href={view.href} target="_blank" rel="noreferrer">
                          <Image src={view.href} alt={view.name} width={640} height={360} loading="lazy" unoptimized />
                        </a>
                      ) : null}
                      <div className="portal-record-card__header">
                        <div className="portal-record-card__title">
                          <strong>{view.name}</strong>
                          <p><DataPath value={view.artifact.key} /></p>
                        </div>
                        <div className="portal-record-card__meta">
                          <span className="tag tag--neutral">{view.kindLabel}</span>
                          <span className="tag tag--info">{view.artifact.mimeType}</span>
                          <span className="tag tag--neutral">{formatBytes(view.artifact.sizeBytes)}</span>
                        </div>
                      </div>
                      <div className="portal-record-card__actions">
                        <a
                          className="button-ghost"
                          data-testid={`report-download-artifact-${view.index}`}
                          href={view.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open artifact
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
            {latestRemediationJob ? (
              <>
                <h3>Latest remediation artifacts</h3>
                {latestRemediationJob.artifacts.length === 0 ? <p>No remediation artifacts registered yet.</p> : null}
                {latestRemediationJob.artifacts.length > 0 ? (
                  <div className="portal-record-grid">
                    {latestRemediationJob.artifacts.map((artifact, index) => {
                      const href = getArtifactHref(latestRemediationJob.job.id, index);
                      return (
                        <article
                          className="portal-record-card"
                          data-testid={`report-remediation-artifact-${index}`}
                          key={`${artifact.key}:${index}`}
                        >
                          <div className="portal-record-card__header">
                            <div className="portal-record-card__title">
                              <strong>{getArtifactName(artifact.key)}</strong>
                              <p><DataPath value={artifact.key} /></p>
                            </div>
                            <div className="portal-record-card__meta">
                              <span className="tag tag--neutral">{getArtifactKindLabel(artifact)}</span>
                              <span className="tag tag--info">{artifact.mimeType}</span>
                              <span className="tag tag--neutral">{formatBytes(artifact.sizeBytes)}</span>
                            </div>
                          </div>
                          <div className="portal-record-card__actions">
                            <a
                              className="button-ghost"
                              data-testid={`report-download-remediation-artifact-${index}`}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open artifact
                            </a>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </article>
        </section>

        <div className="portal-action-bar">
          <div className="portal-inline-actions">
            {analysisJobHref ? (
              <Link className="button-secondary" data-testid="report-open-analysis-job" href={analysisJobHref}>Open analysis job</Link>
            ) : null}
            <Link className="button-ghost" data-testid="report-back-to-reports" href={`/portal/workspaces/${workspaceId}/reports` as Route}>Back to reports</Link>
          </div>
        </div>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      const isMissing = error.status === 404;
      return (
        <WorkspaceRouteState
          backHref={`/portal/workspaces/${workspaceId}/reports` as Route}
          backLabel="Back to reports"
          deniedDescription="You do not have access to this report."
          eyebrow="Workspace report"
          isAdmin={isPortalAdminSession(session)}
          isMissing={isMissing}
          missingDescription="This report could not be found in the current workspace."
          missingTitle="Report not found"
          pageTestId="workspace-report-access-denied-page"
          descriptionTestId="report-access-denied"
        />
      );
    }
    throw error;
  }
}
