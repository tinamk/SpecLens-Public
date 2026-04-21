import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { ReportExportAction, ReportRemediationForm } from "../../../../../../components/portal-actions";
import { ApiResponseError, getCurrentUser, getHostedJob, getHostedReport, getWorkspaceConsole } from "../../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  getWorkspaceReportFindingsEmptyState,
  getWorkspaceReportFindingsEmptyStateTagClass,
  getWorkspaceReportRemediationCodeHref,
  getWorkspaceReportRemediationSummary,
  getWorkspaceReportSectionsEmptyState,
  getWorkspaceRunHref,
  isWorkspaceScopedReportContext,
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
    if (!isWorkspaceScopedReportContext(workspaceId, report, job.job, latestRemediationJob?.job)) {
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
    const analysisJobHref = getWorkspaceRunHref(workspaceId, report.jobId);

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
          <section className="portal-grid">
            <article className="portal-panel xl:col-span-2" data-testid="report-remediation-panel">
              <span className="tag tag--warning">Remediation</span>
              <h2>Fix readiness</h2>
              <p><strong>Release gate:</strong> {report.summary.releaseGateDecision?.status ?? "n/a"}{report.summary.releaseGateDecision ? ` - ${report.summary.releaseGateDecision.reason}` : ""}</p>
              <p><strong>Remediation packs:</strong> {report.summary.remediationPacks.length}</p>
              <p><strong>Fix handoff entries:</strong> {report.summary.fixHandoff?.entries.length ?? 0}</p>
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
                <div className="subtle-note" data-testid="report-remediation-changeset">
                  <p><strong>Changeset branch:</strong> {report.summary.changeset.branchName ?? "not created"}</p>
                  <p><strong>Source:</strong> {remediationSourceOption?.displayName ?? "unknown"}</p>
                  <p><strong>Stop reason:</strong> {report.summary.changeset.stopReason}</p>
                  <p><strong>Changed files:</strong> {report.summary.changeset.changedFiles.length}</p>
                  <p><strong>Validation:</strong> {report.summary.changeset.validationPassed ? "passed" : "not green"}</p>
                  {report.summary.changeset.validationCommands.length > 0 ? (
                    <p><strong>Validation commands:</strong> {report.summary.changeset.validationCommands.join(", ")}</p>
                  ) : null}
                  {report.summary.changeset.pullInstructions.length > 0 ? (
                    <div>
                      <strong>Pull/apply instructions:</strong>
                      <ul>
                        {report.summary.changeset.pullInstructions.map(instruction => (
                          <li key={instruction}>{instruction}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {report.summary.latestRemediationJobId ? (
                    <p>
                      <Link className="button-ghost" data-testid="report-open-remediation-job" href={`/portal/workspaces/${workspaceId}/runs/${report.summary.latestRemediationJobId}` as Route}>Open remediation run</Link>
                    </p>
                  ) : null}
                  <div className="stack-form">
                    {report.summary.changeset.changedFiles.map(file => (
                      <Link
                        className="button-ghost"
                        data-testid={`report-open-code-${file.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                        href={getWorkspaceReportRemediationCodeHref({
                          workspaceId,
                          sourceId: remediationSourceId,
                          reportId: report.id,
                          filePath: file,
                          branchName: report.summary.changeset?.branchName ?? null,
                          baseRef: report.summary.changeset?.baseRef ?? null,
                        })}
                        key={file}
                      >
                        Open {file}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="subtle-note" data-testid="report-remediation-changeset-empty">
                  <p className={remediationSummary.tagClass}>Remediation status</p>
                  <p><strong>{remediationSummary.title}</strong></p>
                  <p>{remediationSummary.detail}</p>
                  {remediationSummary.canOpenRun && report.summary.latestRemediationJobId ? (
                    <p>
                      <Link className="button-ghost" data-testid="report-open-remediation-job" href={`/portal/workspaces/${workspaceId}/runs/${report.summary.latestRemediationJobId}` as Route}>Open remediation run</Link>
                    </p>
                  ) : null}
                </div>
              )}
            </article>
          </section>
          <section className="portal-grid">
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
            {report.findings.length === 0 ? (
              <article className="portal-panel xl:col-span-2" data-testid="report-findings-empty-state">
                <span className={getWorkspaceReportFindingsEmptyStateTagClass(report.summary.releaseGateDecision?.status ?? null)}>Findings</span>
                <h2>{findingsEmptyState.title}</h2>
                <p>{findingsEmptyState.detail}</p>
              </article>
            ) : null}
            {report.findings.map(finding => (
              <article className="portal-panel" data-testid={`report-finding-${finding.id}`} key={finding.id}>
                <p className={getTagTone(String(finding.severity).toLowerCase())}>{finding.severity.toUpperCase()}</p>
                <h2>{finding.title}</h2>
                <p><strong>Role:</strong> {roleLookup.get(finding.roleId) ?? finding.roleId}</p>
                <p>{finding.message}</p>
                <p><strong>Suggestion:</strong> {finding.suggestion}</p>
                {finding.evidence.length > 0 ? <p><strong>Evidence:</strong> {finding.evidence.join(", ")}</p> : null}
                <div className="list-row__actions">
                  {resolveFindingSources(finding.sourceIds).length === 1 ? (
                    <Link
                      className="button-ghost"
                      data-testid={`report-open-code-finding-${finding.id}`}
                      href={`/portal/workspaces/${workspaceId}/code?sourceId=${encodeURIComponent(resolveFindingSources(finding.sourceIds)[0]!.id)}&reportId=${encodeURIComponent(report.id)}&findingId=${encodeURIComponent(finding.id)}${resolveFindingPath(finding.paths) ? `&path=${encodeURIComponent(resolveFindingPath(finding.paths) ?? "")}` : ""}` as Route}
                    >
                      Open in code review
                    </Link>
                  ) : resolveFindingSources(finding.sourceIds).length > 1 ? resolveFindingSources(finding.sourceIds).map(source => (
                    <Link
                      className="button-ghost"
                      data-testid={`report-open-code-finding-${finding.id}-${source.id}`}
                      href={`/portal/workspaces/${workspaceId}/code?sourceId=${encodeURIComponent(source.id)}&reportId=${encodeURIComponent(report.id)}&findingId=${encodeURIComponent(finding.id)}${resolveFindingPath(finding.paths) ? `&path=${encodeURIComponent(resolveFindingPath(finding.paths) ?? "")}` : ""}` as Route}
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
              <span className="tag tag--neutral">Artifacts</span>
              <h2>Run artifacts</h2>
              <ReportExportAction reportId={report.id} />
              {report.artifacts.length === 0 ? <p>No artifacts registered for this run.</p> : null}
              {report.artifacts.map((artifact, index) => (
                <div className="list-row" data-testid={`report-artifact-${index}`} key={`${artifact.key}:${index}`}>
                  <div>
                    <strong>{artifact.key}</strong>
                    <p>{artifact.mimeType} · {formatBytes(artifact.sizeBytes)}</p>
                  </div>
                  <div className="list-row__actions">
                    <a
                      className="button-ghost"
                      data-testid={`report-download-artifact-${index}`}
                      href={artifact.signedUrl ?? `/api/proxy/api/jobs/${report.jobId}/artifacts/${index}`}
                    >
                      Download
                    </a>
                  </div>
                </div>
              ))}
              {latestRemediationJob ? (
                <>
                  <h3>Latest remediation artifacts</h3>
                  {latestRemediationJob.artifacts.length === 0 ? <p>No remediation artifacts registered yet.</p> : null}
                  {latestRemediationJob.artifacts.map((artifact, index) => (
                    <div
                      className="list-row"
                      data-testid={`report-remediation-artifact-${index}`}
                      key={`${artifact.key}:${index}`}
                    >
                      <div>
                        <strong>{artifact.key}</strong>
                        <p>{artifact.mimeType} · {formatBytes(artifact.sizeBytes)}</p>
                      </div>
                      <div className="list-row__actions">
                        <a
                          className="button-ghost"
                          data-testid={`report-download-remediation-artifact-${index}`}
                          href={artifact.signedUrl ?? `/api/proxy/api/jobs/${latestRemediationJob.job.id}/artifacts/${index}`}
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </article>
          </section>
        </div>

        <div className="list-row">
          <div />
          <div className="list-row__actions">
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
          <p className="inline-error" data-testid="report-access-denied">You do not have access to this report.</p>
          <Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/reports` as Route}>Back to reports</Link>
        </PortalShell>
      );
    }
    throw error;
  }
}
