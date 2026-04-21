import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { JobLifecycleActions, JobLogConsole } from "../../../../../../components/portal-actions";
import { ApiResponseError, getHostedJob, getPortalAnalysisTasks, getSourceLearnables } from "../../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatJobExecutionMode,
  formatJobLabel,
  isWorkspaceScopedJobContext,
} from "../../../../../../lib/portal";

export default async function WorkspaceJobPage({
  params,
}: {
  params: Promise<{ workspaceId: string; jobId: string }>;
}) {
  const { workspaceId, jobId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/runs/${jobId}`);

  try {
    const [envelope, tasks] = await Promise.all([
      getHostedJob(jobId, "default"),
      getPortalAnalysisTasks(),
    ]);
    if (!isWorkspaceScopedJobContext(workspaceId, envelope.job, envelope.report)) {
      throw new ApiResponseError(404, `Job ${jobId} does not belong to workspace ${workspaceId}.`);
    }
    const sourceLearnables = await getSourceLearnables(envelope.job.workspaceId, envelope.job.sourceId);
    const executionLabel = formatJobLabel(envelope.job, tasks);

    return (
      <PortalShell
        eyebrow="Workspace run"
        title={envelope.job.id}
        lede="Live logs stay visible from the run route while report review remains a separate report surface."
        pageTestId="workspace-runs-job-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="runs"
      >
        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-job-console-panel">
            <span className="tag tag--neutral">Console</span>
            <h2>Job stream</h2>
            <p>Monitor the durable queue output here while the hosted sandbox job continues or settles.</p>
            <JobLogConsole
              jobId={envelope.job.id}
              initialLogs={envelope.logs}
              initialStatus={envelope.job.status}
              initialExecutionSteps={envelope.executionSteps}
              initialTiming={envelope.timing}
              testIdPrefix="workspace-runs-job"
            />
          </article>
          <article className="portal-panel" data-testid="workspace-runs-job-metadata">
            <span className="tag tag--info">Metadata</span>
            <h2>Run details</h2>
            <p data-testid="workspace-runs-job-task"><strong>AI task:</strong> {executionLabel}</p>
            {envelope.job.agentId ? <p data-testid="workspace-runs-job-agent-id"><strong>AI agent:</strong> {envelope.job.agentId}</p> : null}
            <p data-testid="workspace-runs-job-kind"><strong>Job kind:</strong> {envelope.job.jobKind}</p>
            <p data-testid="workspace-runs-job-execution"><strong>Execution:</strong> {formatJobExecutionMode(envelope.job)}</p>
            {envelope.job.claimedRunnerId ? <p data-testid="workspace-runs-job-worker"><strong>Worker:</strong> {envelope.job.claimedRunnerId}</p> : null}
            <p data-testid="workspace-runs-job-runtime"><strong>Runtime:</strong> {envelope.job.runtimeMode}</p>
            <p data-testid="workspace-runs-job-source"><strong>Source:</strong> {envelope.job.sourceLocation}</p>
            {envelope.job.companionSourceLocation ? <p data-testid="workspace-runs-job-companion"><strong>Companion:</strong> {envelope.job.companionSourceLocation}</p> : null}
            {envelope.job.parentReportId ? (
              <p data-testid="workspace-runs-job-parent-report">
                <strong>Parent report:</strong> {envelope.job.parentReportId}
              </p>
            ) : null}
            <JobLifecycleActions workspaceId={workspaceId} jobId={envelope.job.id} status={envelope.job.status} />
            {envelope.job.changeset ? (
              <div className="subtle-note" data-testid="workspace-runs-job-changeset-summary">
                <p><strong>Branch:</strong> {envelope.job.changeset.branchName ?? "not created"}</p>
                <p><strong>Stop reason:</strong> {envelope.job.changeset.stopReason}</p>
                <p><strong>Changed files:</strong> {envelope.job.changeset.changedFiles.length}</p>
                <p><strong>Validation:</strong> {envelope.job.changeset.validationPassed ? "passed" : "not green"}</p>
              </div>
            ) : null}
            <div className="stack-form">
              {envelope.report ? (
                <Link
                  className="button"
                  data-testid="workspace-runs-job-open-report"
                  href={`/portal/workspaces/${workspaceId}/reports/${envelope.report.id}` as Route}
                >
                  Open report
                </Link>
              ) : (
                <p className="subtle-note">The report link will appear here once the queued job reaches a terminal state.</p>
              )}
              {envelope.job.parentReportId ? (
                <Link
                  className="button-secondary"
                  data-testid="workspace-runs-job-open-parent-report"
                  href={`/portal/workspaces/${workspaceId}/reports/${envelope.job.parentReportId}` as Route}
                >
                  Open parent report
                </Link>
              ) : null}
              <Link
                className="button-ghost"
                data-testid="workspace-runs-job-open-code"
                href={`/portal/workspaces/${workspaceId}/code?sourceId=${encodeURIComponent(envelope.job.sourceId)}` as Route}
              >
                Open code review
              </Link>
              <Link className="button-ghost" data-testid="workspace-runs-job-back" href={`/portal/workspaces/${workspaceId}/runs` as Route}>Back to runs</Link>
            </div>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-runs-job-learnables">
          <span className="tag tag--success">Learnables</span>
          <h2>Active source learnables</h2>
          {sourceLearnables.length === 0 ? <p className="subtle-note" data-testid="workspace-runs-job-learnables-empty">No learnables stored for this source yet.</p> : null}
          {sourceLearnables.map(learnable => (
            <div className="list-row" data-testid={`workspace-runs-job-learnable-${learnable.id}`} key={learnable.id}>
              <div>
                <strong>{learnable.category}</strong>
                <p>{learnable.statement}</p>
                {learnable.evidence.length > 0 ? <p className="subtle-note">{learnable.evidence.join(" · ")}</p> : null}
              </div>
            </div>
          ))}
        </section>

        <section className="portal-panel" data-testid="workspace-runs-job-artifacts">
          <span className="tag tag--neutral">Artifacts</span>
          <h2>Job artifacts</h2>
          {envelope.artifacts.length === 0 ? <p className="subtle-note">No artifacts registered for this job yet.</p> : null}
          {envelope.artifacts.map((artifact, index) => (
            <div className="list-row" data-testid={`workspace-runs-job-artifact-${index}`} key={`${artifact.key}:${index}`}>
              <div>
                <strong>{artifact.kind}</strong>
                <p>{artifact.key}</p>
              </div>
              <div className="list-row__actions">
                <a
                  className="button-ghost"
                  data-testid={`workspace-runs-job-download-artifact-${index}`}
                  href={artifact.signedUrl ?? `/api/proxy/api/jobs/${envelope.job.id}/artifacts/${index}`}
                >
                  Download
                </a>
              </div>
            </div>
          ))}
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      return (
        <PortalShell
          eyebrow="Workspace run"
          title="Access denied"
          pageTestId="workspace-runs-job-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <p className="inline-error" data-testid="workspace-runs-job-access-denied">You do not have access to this job.</p>
          <Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/runs` as Route}>Back to runs</Link>
        </PortalShell>
      );
    }
    throw error;
  }
}
