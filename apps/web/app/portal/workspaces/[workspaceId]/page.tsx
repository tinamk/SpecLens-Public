import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { ApiResponseError } from "../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatJobLabel,
  getJobStatusTagClass,
  getWorkspacePageData,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../lib/portal";

export default async function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}`);

  try {
    const { workspaceConsole, tasks } = await getWorkspacePageData(workspaceId);
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)) {
      throw new ApiResponseError(404, `Workspace overview payload does not belong to workspace ${workspaceId}.`);
    }
    const completedJobs = workspaceConsole.jobs.filter(job => job.job.status === "succeeded").length;

    return (
      <PortalShell
        eyebrow="Workspace"
        title={workspaceConsole.workspace.name}
        {...(workspaceConsole.workspace.description ? { lede: workspaceConsole.workspace.description } : {})}
        pageTestId="workspace-overview-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="overview"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-overview-stat-entitlement">
            <span className="portal-stat__label">Entitlement</span>
            <span className="portal-stat__value">{workspaceConsole.workspace.entitlement}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-overview-stat-sources">
            <span className="portal-stat__label">Sources</span>
            <span className="portal-stat__value">{workspaceConsole.sources.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-overview-stat-jobs">
            <span className="portal-stat__label">Runs</span>
            <span className="portal-stat__value">{workspaceConsole.jobs.length}</span>
            <p>{completedJobs} completed</p>
          </article>
          <article className="portal-stat" data-testid="workspace-overview-stat-installations">
            <span className="portal-stat__label">GitHub installs</span>
            <span className="portal-stat__value">{workspaceConsole.installations.length}</span>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-overview-next-panel">
          <PortalSectionHeader title="Jump to" />
          <PortalLinkGrid testId="workspace-overview-route-grid">
            <PortalLinkCard
              eyebrow="Intake"
              href={`/portal/workspaces/${workspaceId}/sources`}
              testId="workspace-overview-open-sources"
              title="Sources"
              tone="info"
            />
            <PortalLinkCard
              eyebrow="Review"
              href={`/portal/workspaces/${workspaceId}/code`}
              testId="workspace-overview-open-code"
              title="Code"
            />
            <PortalLinkCard
              eyebrow="Execution"
              href={`/portal/workspaces/${workspaceId}/runs`}
              testId="workspace-overview-open-runs"
              title="Runs"
              tone="success"
            />
            <PortalLinkCard
              eyebrow="Decisions"
              href={`/portal/workspaces/${workspaceId}/reports`}
              testId="workspace-overview-open-reports"
              title="Reports"
              tone="warning"
            />
            <PortalLinkCard
              eyebrow="Collaboration"
              href={`/portal/workspaces/${workspaceId}/access`}
              testId="workspace-overview-open-access"
              title="Access"
            />
            <PortalLinkCard
              eyebrow="Ownership"
              href={`/portal/workspaces/${workspaceId}/settings`}
              testId="workspace-overview-open-settings"
              title="Settings"
              tone="info"
            />
          </PortalLinkGrid>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-overview-recent-runs">
            <PortalSectionHeader
              title="Recent runs"
            />
            {workspaceConsole.jobs.length === 0 ? <p className="subtle-note">No jobs queued yet.</p> : null}
            {workspaceConsole.jobs.length > 0 ? (
              <div className="portal-record-grid">
                {workspaceConsole.jobs.slice(0, 4).map(job => (
                  <article className="portal-record-card" data-testid={`workspace-overview-job-${job.job.id}`} key={job.job.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{formatJobLabel(job.job, tasks)}</strong>
                        <p>{job.job.sourceLocation}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getJobStatusTagClass(job.job.status)}>{job.job.status}</span>
                      </div>
                    </div>
                    <div className="portal-record-card__actions">
                      <Link
                        className="button-ghost"
                        data-testid={`workspace-overview-open-job-${job.job.id}`}
                        href={`/portal/workspaces/${workspaceId}/runs/${job.job.id}` as Route}
                      >
                        Open job
                      </Link>
                      {job.report ? (
                        <Link
                          className="button"
                          data-testid={`workspace-overview-open-report-${job.report.id}`}
                          href={`/portal/workspaces/${workspaceId}/reports/${job.report.id}` as Route}
                        >
                          Open report
                        </Link>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </article>

          <article className="portal-panel" data-testid="workspace-overview-access-summary">
            <PortalSectionHeader
              title="Members"
            />
            {workspaceConsole.members.length === 0 ? <p className="subtle-note">No members yet.</p> : null}
            {workspaceConsole.members.length > 0 ? (
              <div className="portal-record-stack">
                {workspaceConsole.members.slice(0, 4).map(member => (
                  <article className="portal-record-card" key={member.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{member.displayName}</strong>
                        <p>{member.email}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={member.role === "owner" ? "tag tag--success" : "tag tag--neutral"}>{member.role}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            <Link className="button-ghost" data-testid="workspace-overview-open-access-summary" href={`/portal/workspaces/${workspaceId}/access` as Route}>Open access</Link>
          </article>
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      return (
        <PortalShell
          eyebrow="Workspace"
          title="Access denied"
          pageTestId="workspace-overview-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <PortalNoticePanel
            actions={<Link className="button-secondary" href={"/portal/workspaces" as Route}>Back to workspaces</Link>}
            description="You do not have access to this workspace."
            descriptionTestId="workspace-overview-access-denied"
            title="This workspace is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
