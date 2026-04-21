import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { ApiResponseError } from "../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatJobLabel,
  formatSourceType,
  getEntitlementTagClass,
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
            <span className={getEntitlementTagClass(workspaceConsole.workspace.entitlement)}>{workspaceConsole.workspace.entitlement}</span>
            <h2>Next actions</h2>
            <p>Open the focused workspace areas instead of working from one mixed dashboard.</p>
            <div className="list-row">
              <div>
                <strong>Sources</strong>
                <p>Add public Git repos, Git repo archives, or GitHub-backed sources from the dedicated intake area.</p>
              </div>
              <div className="list-row__actions">
                <Link className="button-secondary" data-testid="workspace-overview-open-sources" href={`/portal/workspaces/${workspaceId}/sources` as Route}>Open sources</Link>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>Code</strong>
                <p>Inspect the Git tree, open files, compare refs, and review PR and changeset metadata.</p>
              </div>
              <div className="list-row__actions">
                <Link className="button-secondary" data-testid="workspace-overview-open-code" href={`/portal/workspaces/${workspaceId}/code` as Route}>Open code</Link>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>Runs</strong>
                <p>Queue AI tasks, pair companion sources, and review job state from the run area.</p>
              </div>
              <div className="list-row__actions">
                <Link className="button-secondary" data-testid="workspace-overview-open-runs" href={`/portal/workspaces/${workspaceId}/runs` as Route}>Open runs</Link>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>Settings</strong>
                <p>Billing and GitHub installation state are now workspace-owned settings, not overview content.</p>
              </div>
              <div className="list-row__actions">
                <Link className="button-secondary" data-testid="workspace-overview-open-settings" href={`/portal/workspaces/${workspaceId}/settings` as Route}>Open settings</Link>
              </div>
            </div>
          </article>

          <article className="portal-panel" data-testid="workspace-overview-recent-sources">
            <span className="tag tag--neutral">Recent sources</span>
            <h2>Latest inputs</h2>
            {workspaceConsole.sources.length === 0 ? <p className="subtle-note">No sources yet.</p> : null}
            {workspaceConsole.sources.slice(0, 3).map(source => (
              <div className="list-row" key={source.id}>
                <div>
                  <strong>{source.displayName}</strong>
                  <p>{formatSourceType(source.type)} · {source.visibility}</p>
                </div>
              </div>
            ))}
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-overview-recent-runs">
            <span className="tag tag--info">Recent runs</span>
            <h2>Latest jobs</h2>
            {workspaceConsole.jobs.length === 0 ? <p className="subtle-note">No jobs queued yet.</p> : null}
            {workspaceConsole.jobs.slice(0, 5).map(job => (
              <div className="list-row" data-testid={`workspace-overview-job-${job.job.id}`} key={job.job.id}>
                <div>
                  <strong>{formatJobLabel(job.job, tasks)}</strong>
                  <p>{job.job.status} · {job.job.runtimeMode}</p>
                </div>
                <div className="list-row__actions">
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
              </div>
            ))}
          </article>

          <article className="portal-panel" data-testid="workspace-overview-access-summary">
            <span className="tag tag--success">Access</span>
            <h2>Members</h2>
            {workspaceConsole.members.length === 0 ? <p className="subtle-note">No members yet.</p> : null}
            {workspaceConsole.members.slice(0, 4).map(member => (
              <div className="list-row" key={member.id}>
                <div>
                  <strong>{member.displayName}</strong>
                  <p>{member.email}</p>
                  <p className="subtle-note">{member.role}</p>
                </div>
              </div>
            ))}
            <Link className="button-ghost" data-testid="workspace-overview-open-access" href={`/portal/workspaces/${workspaceId}/access` as Route}>Open access</Link>
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
          <p className="inline-error" data-testid="workspace-overview-access-denied">You do not have access to this workspace.</p>
          <Link className="button-secondary" href={"/portal/workspaces" as Route}>Back to workspaces</Link>
        </PortalShell>
      );
    }
    throw error;
  }
}
