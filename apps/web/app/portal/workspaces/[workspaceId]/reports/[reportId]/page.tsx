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
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { DataChipList, DataCommandList, DataPath, DataValue } from "../../../../../../components/data-visuals";
import { ReportExportAction, ReportRemediationForm } from "../../../../../../components/portal-actions";
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

function renderStructuredData(section: AnalysisReportSection): ReactNode {
  const entries = Object.entries(section.data);
  if (entries.length === 0) {
    return null;
  }

  return (
    <>
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
    <article className="report-gap-row" data-testid={`report-capability-gap-${toStableId(gap.title)}`} key={gap.title}>
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

function getRemediationStatusTone(status: string | null): RemediationStageView["tone"] {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "pending" || status === "queued" || status === "running") return "warning";
  if (status === "cancelled") return "neutral";
  return "neutral";
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
    const highlightedFindings = (blockingFindings.length > 0 ? blockingFindings : sortedFindings.filter(finding => finding.severity === "high")).slice(0, 5);
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
            <h1>{report.title}</h1>
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

        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="report-stat-gate">
            <span className="portal-stat__label">Release gate</span>
            <span className="portal-stat__value">{gateStatus ?? "n/a"}</span>
            {report.summary.releaseGateDecision?.reason ? <p>{report.summary.releaseGateDecision.reason}</p> : null}
          </article>
          <article className="portal-stat" data-testid="report-stat-sections">
            <span className="portal-stat__label">Sections</span>
            <span className="portal-stat__value">{report.sections.length}</span>
            <p>{report.roles.length} role{report.roles.length === 1 ? "" : "s"} contributed output.</p>
          </article>
          <article className="portal-stat" data-testid="report-stat-artifacts">
            <span className="portal-stat__label">Artifacts</span>
            <span className="portal-stat__value">{reportArtifactCount}</span>
            <p>{artifactSummary}</p>
          </article>
          <article className="portal-stat" data-testid="report-stat-remediation">
            <span className="portal-stat__label">Remediation</span>
            <span className="portal-stat__value">{report.summary.remediationPacks.length}</span>
            {latestRemediationJob ? <p>Latest: {latestRemediationJob.job.status}</p> : <p>No remediation run queued.</p>}
          </article>
        </section>

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
                    <strong>{finding.title}</strong>
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

        <section className="portal-grid">
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
                          testId={`report-open-code-${toStableId(file)}`}
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
            <article className="portal-panel report-section-card" data-testid={`report-section-${section.id}`} key={section.id}>
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

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2">
            <PortalSectionHeader
              badgeLabel="Findings"
              badgeClassName={getWorkspaceReportFindingsEmptyStateTagClass(gateStatus)}
              title="Findings"
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
              <article className={`portal-record-card report-finding-card report-finding-card--${finding.severity}`} data-testid={`report-finding-${findingDomId}`} key={`${finding.id}:${index}`}>
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <strong>{finding.title}</strong>
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
                    <p className="subtle-note" data-testid={`report-finding-source-ambiguous-${findingDomId}`}>
                      Source ambiguous.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        {executionStepGroups.length > 0 ? (
          <section className="portal-panel" data-testid="report-execution-timeline">
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
      return (
        <PortalShell
          eyebrow="Workspace report"
          title="Access denied"
          pageTestId="workspace-report-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <PortalNoticePanel
            actions={<Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/reports` as Route}>Back to reports</Link>}
            description="You do not have access to this report."
            descriptionTestId="report-access-denied"
            title="Access denied"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
