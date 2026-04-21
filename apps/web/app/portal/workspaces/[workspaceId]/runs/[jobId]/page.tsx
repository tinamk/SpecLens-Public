import type { Route } from "next";
import Link from "next/link";
import { PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { JobLifecycleActions, JobLogConsole } from "../../../../../../components/portal-actions";
import {
  ApiResponseError,
  getCurrentUser,
  getHostedJob,
  getPortalAnalysisTasks,
  getSourceLearnables,
  getWorkspaceConsole,
} from "../../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  canManageWorkspaceJobLifecycle,
  formatJobExecutionMode,
  formatJobLabel,
  getChangesetBranchName,
  getJobStatusTagClass,
  isWorkspaceScopedJobContext,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../../lib/portal";

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} bytes`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function WorkspaceJobPage({
  params,
}: {
  params: Promise<{ workspaceId: string; jobId: string }>;
}) {
  const { workspaceId, jobId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/runs/${jobId}`);

  try {
    const [envelope, tasks, currentUser] = await Promise.all([
      getHostedJob(jobId, "default"),
      getPortalAnalysisTasks(),
      getCurrentUser(),
    ]);
    if (!isWorkspaceScopedJobContext(workspaceId, envelope.job, envelope.report)) {
      throw new ApiResponseError(404, `Job ${jobId} does not belong to workspace ${workspaceId}.`);
    }
    const workspaceConsole = await getWorkspaceConsole(workspaceId);
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)) {
      throw new ApiResponseError(404, `Workspace run payload does not belong to workspace ${workspaceId}.`);
    }
    const canMutateWorkspace = isPortalAdminSession(session) || currentUser.id === workspaceConsole.workspace.ownerUserId;
    const canManageLifecycle = canManageWorkspaceJobLifecycle(envelope.job.jobKind, canMutateWorkspace);
    const sourceLearnables = await getSourceLearnables(envelope.job.workspaceId, envelope.job.sourceId);
    const executionLabel = formatJobLabel(envelope.job, tasks);
    const changesetBranchName = envelope.job.changeset ? getChangesetBranchName({
      branchName: envelope.job.changeset.branchName,
      pullInstructions: envelope.job.changeset.pullInstructions,
    }) : null;
    const codeReviewParams = new URLSearchParams({
      sourceId: envelope.job.sourceId,
    });
    if (changesetBranchName) {
      codeReviewParams.set("ref", changesetBranchName);
      codeReviewParams.set("compare", envelope.job.changeset?.baseRef?.trim() ? envelope.job.changeset.baseRef : "HEAD");
    }
    const codeReviewHref = `/portal/workspaces/${workspaceId}/code?${codeReviewParams.toString()}` as Route;
    const artifactCount = envelope.artifacts.length;
    const learnableCount = sourceLearnables.length;

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
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-runs-job-stat-status">
            <span className="portal-stat__label">Status</span>
            <span className="portal-stat__value">{envelope.job.status}</span>
            <p>{envelope.report ? "Report output is available for this run." : "Stay on the run surface until the report is written."}</p>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-job-stat-artifacts">
            <span className="portal-stat__label">Artifacts</span>
            <span className="portal-stat__value">{artifactCount}</span>
            <p>Durable files stored for this job so far.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-job-stat-learnables">
            <span className="portal-stat__label">Learnables</span>
            <span className="portal-stat__value">{learnableCount}</span>
            <p>Source-specific learnables available while reviewing this run.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-job-stat-lifecycle">
            <span className="portal-stat__label">Lifecycle</span>
            <span className="portal-stat__value">{canManageLifecycle ? "Owner" : "Read-only"}</span>
            <p>{canManageLifecycle ? "This session can cancel or retry this job when allowed." : "Only the workspace owner can manage this job lifecycle."}</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-job-console-panel">
            <PortalSectionHeader
              badgeLabel="Console"
              title="Job stream"
              description="Monitor the durable queue output here while the hosted sandbox job continues or settles."
            />
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
            <PortalSectionHeader
              badgeLabel="Metadata"
              badgeClassName="tag tag--info"
              title="Run details"
              description="Use this panel to understand execution mode, ownership, and where to go next."
            />
            <div className="status-cluster">
              <span className={getJobStatusTagClass(envelope.job.status)}>{envelope.job.status}</span>
              <span className="tag tag--neutral">{envelope.job.jobKind}</span>
              <span className="tag tag--info">{envelope.job.runtimeMode}</span>
            </div>
            <PortalMetaList
              items={[
                { label: "AI task", value: <span data-testid="workspace-runs-job-task">{executionLabel}</span> },
                ...(envelope.job.agentId
                  ? [{ label: "AI agent", value: <span data-testid="workspace-runs-job-agent-id">{envelope.job.agentId}</span> }]
                  : []),
                { label: "Job kind", value: <span data-testid="workspace-runs-job-kind">{envelope.job.jobKind}</span> },
                { label: "Execution", value: <span data-testid="workspace-runs-job-execution">{formatJobExecutionMode(envelope.job)}</span> },
                ...(envelope.job.claimedRunnerId
                  ? [{ label: "Worker", value: <span data-testid="workspace-runs-job-worker">{envelope.job.claimedRunnerId}</span> }]
                  : []),
                { label: "Runtime", value: <span data-testid="workspace-runs-job-runtime">{envelope.job.runtimeMode}</span> },
                { label: "Source", value: <span data-testid="workspace-runs-job-source">{envelope.job.sourceLocation}</span> },
                ...(envelope.job.companionSourceLocation
                  ? [{ label: "Companion", value: <span data-testid="workspace-runs-job-companion">{envelope.job.companionSourceLocation}</span> }]
                  : []),
                ...(envelope.job.parentReportId
                  ? [{ label: "Parent report", value: <span data-testid="workspace-runs-job-parent-report">{envelope.job.parentReportId}</span> }]
                  : []),
              ]}
            />
            {!canManageLifecycle ? (
              <p className="subtle-note" data-testid="workspace-runs-job-lifecycle-read-only">
                This account can review remediation logs and artifacts, but only the workspace owner can cancel or retry remediation runs.
              </p>
            ) : null}
            <JobLifecycleActions
              workspaceId={workspaceId}
              jobId={envelope.job.id}
              status={envelope.job.status}
              canManageLifecycle={canManageLifecycle}
            />
            {envelope.job.changeset ? (
              <article className="portal-record-card" data-testid="workspace-runs-job-changeset-summary">
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <strong>Latest remediation changeset</strong>
                    <p>{changesetBranchName ?? "Branch not created yet"}</p>
                  </div>
                  <div className="portal-record-card__meta">
                    <span className="tag tag--info">
                      {envelope.job.changeset.changedFiles.length} file{envelope.job.changeset.changedFiles.length === 1 ? "" : "s"}
                    </span>
                    <span className={envelope.job.changeset.validationPassed ? "tag tag--success" : "tag tag--warning"}>
                      {envelope.job.changeset.validationPassed ? "validation passed" : "validation not green"}
                    </span>
                  </div>
                </div>
                <PortalMetaList
                  items={[
                    { label: "Branch", value: changesetBranchName ?? "not created" },
                    { label: "Compare base", value: envelope.job.changeset.baseRef?.trim() ? envelope.job.changeset.baseRef : "No base ref recorded" },
                    { label: "Stop reason", value: envelope.job.changeset.stopReason },
                    {
                      label: "Validation commands",
                      value: envelope.job.changeset.validationCommands.length > 0
                        ? envelope.job.changeset.validationCommands.join(", ")
                        : "No validation commands recorded",
                    },
                  ]}
                />
              </article>
            ) : null}
            <div className="portal-action-bar">
              <div className="portal-action-copy">
                <strong>Move from execution to review</strong>
                <p>
                  {envelope.report
                    ? "Open the generated report for normalized findings and release-gate review, or jump straight into code review when you already know the branch context you need."
                    : "The report link appears here once this queued job reaches a terminal state. Until then, use code review or the parent report to keep the remediation thread moving."}
                </p>
              </div>
              <div className="portal-inline-actions">
                {envelope.report ? (
                  <Link
                    className="button"
                    data-testid="workspace-runs-job-open-report"
                    href={`/portal/workspaces/${workspaceId}/reports/${envelope.report.id}` as Route}
                  >
                    Open report
                  </Link>
                ) : null}
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
                  className={envelope.report ? "button-ghost" : "button-secondary"}
                  data-testid="workspace-runs-job-open-code"
                  href={codeReviewHref}
                >
                  Open code review
                </Link>
                <Link className="button-ghost" data-testid="workspace-runs-job-back" href={`/portal/workspaces/${workspaceId}/runs` as Route}>Back to runs</Link>
              </div>
            </div>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-runs-job-learnables">
          <PortalSectionHeader
            badgeLabel="Learnables"
            badgeClassName="tag tag--success"
            title="Active source learnables"
            description="Use source learnables as the current repository context while you interpret this job."
          />
          {sourceLearnables.length === 0 ? <p className="subtle-note" data-testid="workspace-runs-job-learnables-empty">No learnables stored for this source yet.</p> : null}
          {sourceLearnables.length > 0 ? (
            <div className="portal-record-grid">
              {sourceLearnables.map(learnable => (
                <article className="portal-record-card" data-testid={`workspace-runs-job-learnable-${learnable.id}`} key={learnable.id}>
                  <div className="portal-record-card__header">
                    <div className="portal-record-card__title">
                      <strong>{learnable.category}</strong>
                      <p>{learnable.statement}</p>
                    </div>
                    <div className="portal-record-card__meta">
                      <span className="tag tag--success">{learnable.category}</span>
                      <span className="tag tag--info">{learnable.evidence.length} evidence note{learnable.evidence.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {learnable.evidence.length > 0 ? (
                    <div className="portal-record-card__body">
                      <p>{learnable.evidence.join(" · ")}</p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="portal-panel" data-testid="workspace-runs-job-artifacts">
          <PortalSectionHeader
            badgeLabel="Artifacts"
            title="Job artifacts"
            description="Download the durable files captured by the hosted run when you need raw evidence outside the browser."
          />
          {envelope.artifacts.length === 0 ? <p className="subtle-note">No artifacts registered for this job yet.</p> : null}
          {envelope.artifacts.length > 0 ? (
            <div className="portal-record-grid">
              {envelope.artifacts.map((artifact, index) => (
                <article className="portal-record-card" data-testid={`workspace-runs-job-artifact-${index}`} key={`${artifact.key}:${index}`}>
                  <div className="portal-record-card__header">
                    <div className="portal-record-card__title">
                      <strong>{artifact.kind}</strong>
                      <p>{artifact.key}</p>
                    </div>
                    <div className="portal-record-card__meta">
                      <span className="tag tag--neutral">{artifact.kind}</span>
                      <span className="tag tag--info">{artifact.mimeType}</span>
                      <span className="tag tag--neutral">{formatBytes(artifact.sizeBytes)}</span>
                    </div>
                  </div>
                  <PortalMetaList
                    items={[
                      { label: "Delivery", value: artifact.signedUrl ? "Signed download URL" : "Portal proxy download" },
                      { label: "Evidence size", value: formatBytes(artifact.sizeBytes) },
                    ]}
                  />
                  <div className="portal-record-card__actions">
                    <a
                      className="button-ghost"
                      data-testid={`workspace-runs-job-download-artifact-${index}`}
                      href={artifact.signedUrl ?? `/api/proxy/api/jobs/${envelope.job.id}/artifacts/${index}`}
                    >
                      Download
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
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
          <PortalNoticePanel
            actions={<Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/runs` as Route}>Back to runs</Link>}
            description="You do not have access to this job."
            descriptionTestId="workspace-runs-job-access-denied"
            title="This job is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
