import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { ApiResponseError } from "../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatJobLabel,
  formatSourceType,
  getEntitlementTagClass,
  getJobStatusTagClass,
  getSourceVerificationTagClass,
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
        lede="The overview keeps summary state and next actions visible. Source intake, run queueing, access, and workspace-owned settings each live in their own route."
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
            <p>Controls private repository access, Git archive uploads, and billing state for this workspace.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-overview-stat-sources">
            <span className="portal-stat__label">Sources</span>
            <span className="portal-stat__value">{workspaceConsole.sources.length}</span>
            <p>Git-backed repository inputs connected to this workspace.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-overview-stat-jobs">
            <span className="portal-stat__label">Runs</span>
            <span className="portal-stat__value">{workspaceConsole.jobs.length}</span>
            <p>{completedJobs} completed runs have already produced report output.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-overview-stat-installations">
            <span className="portal-stat__label">GitHub installs</span>
            <span className="portal-stat__value">{workspaceConsole.installations.length}</span>
            <p>Workspace-owned GitHub App installations are managed in workspace settings.</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-overview-next-panel">
            <PortalSectionHeader
              badgeLabel={workspaceConsole.workspace.entitlement}
              badgeClassName={getEntitlementTagClass(workspaceConsole.workspace.entitlement)}
              title="Choose the area you need"
              description="Open the focused workspace areas instead of working from one mixed dashboard."
            />
            <PortalMetaList
              items={[
                { label: "Owner model", value: "Workspace-owned settings keep billing and GitHub installation state in one place" },
                { label: "Review flow", value: "Runs, reports, and code stay separated so operational state is easier to understand" },
              ]}
            />
            <PortalLinkGrid testId="workspace-overview-route-grid">
              <PortalLinkCard
                description="Add public Git repos, Git repo archives, or GitHub-backed sources from the dedicated intake area."
                eyebrow="Intake"
                href={`/portal/workspaces/${workspaceId}/sources`}
                testId="workspace-overview-open-sources"
                title="Sources"
                tone="info"
              />
              <PortalLinkCard
                description="Inspect the Git tree, open files, compare refs, and review PR and changeset metadata."
                eyebrow="Review"
                href={`/portal/workspaces/${workspaceId}/code`}
                testId="workspace-overview-open-code"
                title="Code"
              />
              <PortalLinkCard
                description="Queue AI tasks, pair companion sources, and review job state from the run area."
                eyebrow="Execution"
                href={`/portal/workspaces/${workspaceId}/runs`}
                testId="workspace-overview-open-runs"
                title="Runs"
                tone="success"
              />
              <PortalLinkCard
                description="Review findings, release-gate state, artifacts, and remediation history from the report area."
                eyebrow="Decisions"
                href={`/portal/workspaces/${workspaceId}/reports`}
                testId="workspace-overview-open-reports"
                title="Reports"
                tone="warning"
              />
              <PortalLinkCard
                description="Review members and authorization in the dedicated access surface."
                eyebrow="Collaboration"
                href={`/portal/workspaces/${workspaceId}/access`}
                testId="workspace-overview-open-access"
                title="Access"
              />
              <PortalLinkCard
                description="Billing and GitHub installation state are now workspace-owned settings, not overview content."
                eyebrow="Ownership"
                href={`/portal/workspaces/${workspaceId}/settings`}
                testId="workspace-overview-open-settings"
                title="Settings"
                tone="info"
              />
            </PortalLinkGrid>
          </article>

          <article className="portal-panel" data-testid="workspace-overview-recent-sources">
            <PortalSectionHeader
              badgeLabel="Recent sources"
              title="Latest inputs"
              description="Use source state here as a quick checkpoint before queueing more work."
            />
            {workspaceConsole.sources.length === 0 ? <p className="subtle-note">No sources yet.</p> : null}
            {workspaceConsole.sources.length > 0 ? (
              <div className="portal-record-stack">
                {workspaceConsole.sources.slice(0, 3).map(source => (
                  <article className="portal-record-card" key={source.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{source.displayName}</strong>
                        <p>{source.location}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getSourceVerificationTagClass(source.verificationStatus)}>{source.verificationStatus}</span>
                        <span className="tag tag--neutral">{formatSourceType(source.type)}</span>
                        <span className="tag tag--info">{source.visibility}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-overview-recent-runs">
            <PortalSectionHeader
              badgeLabel="Recent runs"
              badgeClassName="tag tag--info"
              title="Latest jobs"
              description="Jump into the run or the generated report depending on whether you need execution state or review output."
            />
            {workspaceConsole.jobs.length === 0 ? <p className="subtle-note">No jobs queued yet.</p> : null}
            {workspaceConsole.jobs.length > 0 ? (
              <div className="portal-record-grid">
                {workspaceConsole.jobs.slice(0, 5).map(job => (
                  <article className="portal-record-card" data-testid={`workspace-overview-job-${job.job.id}`} key={job.job.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{formatJobLabel(job.job, tasks)}</strong>
                        <p>{job.job.sourceLocation}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getJobStatusTagClass(job.job.status)}>{job.job.status}</span>
                        <span className="tag tag--info">{job.job.runtimeMode}</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Execution path", value: job.job.executionPath ?? "Hosted agent runtime" },
                        { label: "Report", value: job.report ? "Report ready" : "Open the job for logs and artifacts" },
                      ]}
                    />
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
                          className="button-secondary"
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
              badgeLabel="Access"
              badgeClassName="tag tag--success"
              title="Members"
              description="Shared access is visible here without collapsing membership into the run or billing surfaces."
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
