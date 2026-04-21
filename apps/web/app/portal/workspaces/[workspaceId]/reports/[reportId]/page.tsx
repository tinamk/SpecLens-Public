import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { ReportExportAction, ReportRemediationForm } from "../../../../../../components/portal-actions";
import { ApiResponseError, getCurrentUser, getHostedJob, getHostedReport, getWorkspaceConsole } from "../../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  getReleaseGateTagClass,
  getChangesetBranchName,
  getWorkspaceReportFindingCodeHref,
  getWorkspaceReportFindingsEmptyState,
  getWorkspaceReportFindingsEmptyStateTagClass,
  getWorkspaceReportRemediationCodeHref,
  getWorkspaceReportRemediationSummary,
  getWorkspaceReportSectionsEmptyState,
  getWorkspaceRunHref,
  isWorkspaceScopedReportPageContext,
} from "../../../../../../lib/portal";

function getTagTone(tone: string): string {
  if (tone === "high" || tone === "failed" || tone === "error") return "tag tag--danger";
  if (tone === "medium" || tone === "warning" || tone === "degraded") return "tag tag--warning";
  if (tone === "low" || tone === "ok" || tone === "pass" || tone === "ready") return "tag tag--success";
  return "tag tag--neutral";
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} bytes`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
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
    const canMutate = currentUser.id === workspaceConsole.workspace.ownerUserId || isPortalAdminSession(session);
    if (!isWorkspaceScopedReportPageContext(
      workspaceId,
      [report, job.job, latestRemediationJob?.job],
      workspaceConsole,
    )) {
      throw new ApiResponseError(404, `Report ${reportId} does not belong to workspace ${workspaceId}.`);
    }
    const sourceOptions = [
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
    const resolveFindingSources = (sourceIds: string[]) => {
      const matched = sourceOptions.filter(source => sourceIds.includes(source.id));
      return matched;
    };
    const resolveFindingPath = (paths: string[]) => paths.length === 1 ? paths[0] : null;
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
    const reportArtifactCount = report.artifacts.length + (latestRemediationJob?.artifacts.length ?? 0);

    return (
      <PortalShell
        eyebrow="Workspace report"
        title={report.title}
        lede="Report review stays separate from queueing and settings so report assertions remain durable across local and production environments."
        pageTestId="workspace-report-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="reports"
      >
        <section className="report-hero" data-testid="report-hero">
          <span className="tag tag--info">Hosted report</span>
          <h2 className="mt-4 text-white">{report.title}</h2>
          <p>This hosted report view renders normalized parity sections, findings, and export-ready run metadata.</p>
          <div className="report-grid">
            <div className="report-summary-card" data-testid="report-summary-total"><strong>Total</strong><br />{report.summary.totalFindings}</div>
            <div className="report-summary-card" data-testid="report-summary-high"><strong>High</strong><br />{report.summary.high}</div>
            <div className="report-summary-card" data-testid="report-summary-medium"><strong>Medium</strong><br />{report.summary.medium}</div>
            <div className="report-summary-card" data-testid="report-summary-low"><strong>Low</strong><br />{report.summary.low}</div>
          </div>
        </section>

        <div className="space-y-6">
          <section className="portal-stat-grid">
            <article className="portal-stat" data-testid="report-stat-gate">
              <span className="portal-stat__label">Release gate</span>
              <span className="portal-stat__value">{gateStatus ?? "n/a"}</span>
              <p>{report.summary.releaseGateDecision?.reason ?? "No release-gate decision was recorded for this report."}</p>
            </article>
            <article className="portal-stat" data-testid="report-stat-sections">
              <span className="portal-stat__label">Sections</span>
              <span className="portal-stat__value">{report.sections.length}</span>
              <p>Normalized sections rendered from the hosted report payload.</p>
            </article>
            <article className="portal-stat" data-testid="report-stat-artifacts">
              <span className="portal-stat__label">Artifacts</span>
              <span className="portal-stat__value">{reportArtifactCount}</span>
              <p>Analysis plus remediation artifacts currently available for download.</p>
            </article>
            <article className="portal-stat" data-testid="report-stat-remediation">
              <span className="portal-stat__label">Remediation</span>
              <span className="portal-stat__value">{report.summary.remediationPacks.length}</span>
              <p>{latestRemediationJob ? `Latest remediation run is ${latestRemediationJob.job.status}.` : "No remediation run has been launched from this report yet."}</p>
            </article>
          </section>

          <section className="portal-grid">
            <article className="portal-panel xl:col-span-2" data-testid="report-remediation-panel">
              <PortalSectionHeader
                badgeLabel="Remediation"
                badgeClassName="tag tag--warning"
                title="Fix readiness"
                description="Launch remediation from the report once you have enough evidence to turn findings into a scoped code change."
              />
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
                      <p>{remediationBranchName ?? "Branch not created yet"}</p>
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
                      { label: "Changeset branch", value: remediationBranchName ?? "not created" },
                      { label: "Source", value: remediationSourceOption?.displayName ?? "unknown" },
                      { label: "Stop reason", value: report.summary.changeset.stopReason },
                      {
                        label: "Validation commands",
                        value: report.summary.changeset.validationCommands.length > 0
                          ? report.summary.changeset.validationCommands.join(", ")
                          : "No validation commands recorded",
                      },
                      {
                        label: "Pull/apply instructions",
                        value: report.summary.changeset.pullInstructions.length > 0
                          ? report.summary.changeset.pullInstructions.join(" · ")
                          : "No pull/apply instructions recorded",
                      },
                    ]}
                  />
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
                            testId={`report-open-code-${file.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                            href={getWorkspaceReportRemediationCodeHref({
                              workspaceId,
                              sourceId: remediationSourceId,
                              reportId: report.id,
                              filePath: file,
                              branchName: remediationBranchName,
                              baseRef: report.summary.changeset?.baseRef ?? null,
                            })}
                            title={file}
                            eyebrow="changed file"
                            description="Open this remediation result directly in the code review surface."
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
                description="Review the structured section narrative before dropping into raw artifacts or code."
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
              <article className="portal-panel" data-testid={`report-section-${section.id}`} key={section.id}>
                <p className={getTagTone(String(section.status).toLowerCase())}>{section.status.toUpperCase()}</p>
                <h2>{section.title}</h2>
                <p><strong>Role:</strong> {roleLookup.get(section.roleId) ?? section.roleId}</p>
                <p>{section.summary}</p>
                <pre className="data-preview">{JSON.stringify(section.data, null, 2)}</pre>
              </article>
            ))}
          </section>
          <section className="portal-grid">
            <article className="portal-panel xl:col-span-2">
              <PortalSectionHeader
                badgeLabel="Findings"
                badgeClassName={getWorkspaceReportFindingsEmptyStateTagClass(gateStatus)}
                title="Findings and code follow-up"
                description="Use report findings as the handoff point into code review and remediation."
              />
            </article>
            {report.findings.length === 0 ? (
              <article className="portal-panel xl:col-span-2" data-testid="report-findings-empty-state">
                <span className={getWorkspaceReportFindingsEmptyStateTagClass(report.summary.releaseGateDecision?.status ?? null)}>Findings</span>
                <h2>{findingsEmptyState.title}</h2>
                <p>{findingsEmptyState.detail}</p>
              </article>
            ) : null}
            {report.findings.map(finding => (
              <article className="portal-record-card" data-testid={`report-finding-${finding.id}`} key={finding.id}>
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <strong>{finding.title}</strong>
                    <p>{finding.message}</p>
                  </div>
                  <div className="portal-record-card__meta">
                    <span className={getTagTone(String(finding.severity).toLowerCase())}>{finding.severity.toUpperCase()}</span>
                    <span className="tag tag--neutral">{resolveFindingSources(finding.sourceIds).length || 0} source{resolveFindingSources(finding.sourceIds).length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <PortalMetaList
                  items={[
                    { label: "Role", value: roleLookup.get(finding.roleId) ?? finding.roleId },
                    { label: "Suggestion", value: finding.suggestion },
                    { label: "Evidence", value: finding.evidence.length > 0 ? finding.evidence.join(", ") : "No explicit evidence links recorded" },
                  ]}
                />
                <div className="portal-record-card__actions">
                  {resolveFindingSources(finding.sourceIds).length === 1 ? (
                    <Link
                      className="button-ghost"
                      data-testid={`report-open-code-finding-${finding.id}`}
                      href={getWorkspaceReportFindingCodeHref({
                        workspaceId,
                        sourceId: resolveFindingSources(finding.sourceIds)[0]!.id,
                        reportId: report.id,
                        findingId: finding.id,
                        ...(resolveFindingPath(finding.paths) ? { filePath: resolveFindingPath(finding.paths) } : {}),
                        branchName: remediationBranchName,
                        baseRef: report.summary.changeset?.baseRef ?? null,
                      })}
                    >
                      Open in code review
                    </Link>
                  ) : resolveFindingSources(finding.sourceIds).length > 1 ? resolveFindingSources(finding.sourceIds).map(source => (
                    <Link
                      className="button-ghost"
                      data-testid={`report-open-code-finding-${finding.id}-${source.id}`}
                      href={getWorkspaceReportFindingCodeHref({
                        workspaceId,
                        sourceId: source.id,
                        reportId: report.id,
                        findingId: finding.id,
                        ...(resolveFindingPath(finding.paths) ? { filePath: resolveFindingPath(finding.paths) } : {}),
                        branchName: remediationBranchName,
                        baseRef: report.summary.changeset?.baseRef ?? null,
                      })}
                      key={source.id}
                    >
                      Open in {source.displayName}
                    </Link>
                  )) : (
                    <p className="subtle-note" data-testid={`report-finding-source-ambiguous-${finding.id}`}>
                      Source attribution is ambiguous for this finding.
                    </p>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="portal-grid">
            <article className="portal-panel xl:col-span-2" data-testid="report-artifacts-panel">
              <PortalSectionHeader
                badgeLabel="Artifacts"
                title="Run artifacts"
                description="Download the durable evidence bundle when you need the raw files behind the rendered report."
              />
              <ReportExportAction reportId={report.id} />
              {report.artifacts.length === 0 ? <p>No artifacts registered for this run.</p> : null}
              {report.artifacts.length > 0 ? (
                <div className="portal-record-grid">
                  {report.artifacts.map((artifact, index) => (
                    <article className="portal-record-card" data-testid={`report-artifact-${index}`} key={`${artifact.key}:${index}`}>
                      <div className="portal-record-card__header">
                        <div className="portal-record-card__title">
                          <strong>{artifact.key}</strong>
                          <p>{artifact.mimeType}</p>
                        </div>
                        <div className="portal-record-card__meta">
                          <span className="tag tag--neutral">{formatBytes(artifact.sizeBytes)}</span>
                        </div>
                      </div>
                      <div className="portal-record-card__actions">
                        <a
                          className="button-ghost"
                          data-testid={`report-download-artifact-${index}`}
                          href={artifact.signedUrl ?? `/api/proxy/api/jobs/${report.jobId}/artifacts/${index}`}
                        >
                          Download
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
                      {latestRemediationJob.artifacts.map((artifact, index) => (
                        <article
                          className="portal-record-card"
                          data-testid={`report-remediation-artifact-${index}`}
                          key={`${artifact.key}:${index}`}
                        >
                          <div className="portal-record-card__header">
                            <div className="portal-record-card__title">
                              <strong>{artifact.key}</strong>
                              <p>{artifact.mimeType}</p>
                            </div>
                            <div className="portal-record-card__meta">
                              <span className="tag tag--neutral">{formatBytes(artifact.sizeBytes)}</span>
                            </div>
                          </div>
                          <div className="portal-record-card__actions">
                            <a
                              className="button-ghost"
                              data-testid={`report-download-remediation-artifact-${index}`}
                              href={artifact.signedUrl ?? `/api/proxy/api/jobs/${latestRemediationJob.job.id}/artifacts/${index}`}
                            >
                              Download
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          </section>
        </div>

        <div className="portal-action-bar">
          <div className="portal-action-copy">
            <strong>Keep the review thread moving</strong>
            <p>Open the originating analysis run for logs and artifacts, or return to report history to compare adjacent runs in the same workspace.</p>
          </div>
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
            title="This report is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
