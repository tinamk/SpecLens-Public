import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { QueueAnalysisForm } from "../../../../../components/portal-actions";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import {
  ApiResponseError,
  getCurrentUser,
  getPortalAnalysisTasks,
  getWorkspaceCodexAuthSelection,
  getWorkspaceConsole,
  getWorkspaceJobsPage,
  getWorkspaceSecretsPage,
} from "../../../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatJobExecutionMode,
  formatJobLabel,
  getJobStatusTagClass,
  isWorkspaceScopedEntityPage,
  isWorkspaceScopedJobsPage,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../lib/portal";

export default async function WorkspaceRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const session = await requirePortalSession(buildPortalReturnTo(`/portal/workspaces/${workspaceId}/runs`, query));
  const isAdmin = isPortalAdminSession(session);

  try {
    const runQuery = {
      q: typeof query.q === "string" ? query.q : "",
      status: typeof query.status === "string" ? query.status : "",
      page: typeof query.page === "string" ? Number.parseInt(query.page, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, { items: jobs, pageInfo: jobsPageInfo }, tasks, { items: secrets }, currentUser, codexAuthSelection] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getWorkspaceJobsPage({
        workspaceId,
        page: runQuery.page,
        pageSize: runQuery.pageSize,
        ...(runQuery.q ? { q: runQuery.q } : {}),
        ...(runQuery.status ? { status: runQuery.status } : {}),
      }),
      getPortalAnalysisTasks(),
      getWorkspaceSecretsPage(workspaceId, {
        page: 1,
        pageSize: 100,
      }),
      getCurrentUser(),
      getWorkspaceCodexAuthSelection(workspaceId),
    ]);
    const canManageWorkspace = currentUser.id === workspaceConsole.workspace.ownerUserId;
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)
      || !isWorkspaceScopedJobsPage(workspaceId, jobs)
      || !isWorkspaceScopedEntityPage(workspaceId, secrets)) {
      throw new ApiResponseError(404, `Workspace runs payload does not belong to workspace ${workspaceId}.`);
    }
    const activeRuns = workspaceConsole.jobs.filter(entry => ["pending", "queued", "running"].includes(entry.job.status)).length;
    const completedRuns = workspaceConsole.jobs.filter(entry => entry.job.status === "succeeded").length;
    const reportBackedRuns = workspaceConsole.jobs.filter(entry => entry.report != null).length;

    return (
      <PortalShell
        eyebrow="Workspace runs"
        title={workspaceConsole.workspace.name}
        pageTestId="workspace-runs-page"
        primaryNav={buildPortalPrimaryNav(isAdmin)}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="runs"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-runs-stat-active">
            <span className="portal-stat__label">Active</span>
            <span className="portal-stat__value">{activeRuns}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-completed">
            <span className="portal-stat__label">Completed</span>
            <span className="portal-stat__value">{completedRuns}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-tasks">
            <span className="portal-stat__label">AI tasks</span>
            <span className="portal-stat__value">{tasks.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-secrets">
            <span className="portal-stat__label">Secrets</span>
            <span className="portal-stat__value">{secrets.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-reports">
            <span className="portal-stat__label">With reports</span>
            <span className="portal-stat__value">{reportBackedRuns}</span>
          </article>
        </section>

        {codexAuthSelection.options.every(option => !option.selectable) ? (
          <PortalNoticePanel
            badgeLabel="Codex auth required"
            description="No Codex auth source is connected for this workspace yet. Add your own account-level auth, ask the owner to connect workspace auth, or use the admin-managed global fallback if enabled."
            descriptionTestId="workspace-runs-codex-auth-notice"
            title="Connect Codex before queueing runs"
            actions={(
              <>
                <Link className="button-secondary" href={"/portal/settings" satisfies Route}>
                  My auth
                </Link>
                {canManageWorkspace ? (
                  <Link className="button-ghost" href={`/portal/workspaces/${workspaceId}/settings`}>
                    Workspace auth
                  </Link>
                ) : null}
                {isAdmin ? (
                  <Link className="button-ghost" href={"/portal/admin/ai/auth" satisfies Route}>
                    Global auth
                  </Link>
                ) : null}
              </>
            )}
          />
        ) : (
          <PortalNoticePanel
            badgeLabel="Scoped auth"
            description={`Queue each run against your own user auth, the shared workspace auth, or the admin global fallback. Auto currently selects ${codexAuthSelection.selectedScope ?? "no scope"}.`}
            descriptionTestId="workspace-runs-codex-auth-ready"
            title="Codex auth is scoped per run"
          />
        )}

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-queue-panel">
            <PortalSectionHeader
              badgeLabel="Queue"
              badgeClassName="tag tag--info"
              title="Queue AI task"
            />
            <QueueAnalysisForm
              workspaceId={workspaceId}
              tasks={tasks}
              codexAuthSelection={codexAuthSelection}
              secrets={secrets}
              canUseSecrets={canManageWorkspace}
              sources={workspaceConsole.sources.map(source => ({
                id: source.id,
                displayName: source.displayName,
                visibility: source.visibility,
                type: source.type,
                location: source.location,
                verificationStatus: source.verificationStatus,
                verificationError: source.verificationError,
              }))}
              jobPathTemplate="/portal/workspaces/{workspaceId}/runs/{jobId}"
              testIdPrefix="workspace-runs"
            />
          </article>
          <article className="portal-panel" data-testid="workspace-runs-guide-panel">
            <PortalSectionHeader
              badgeLabel="Jump to"
              title="Related"
            />
            <PortalLinkGrid testId="workspace-runs-guide-grid">
              <PortalLinkCard
                eyebrow="Sources"
                href={`/portal/workspaces/${workspaceId}/sources`}
                testId="workspace-runs-open-sources"
                title="Sources"
                tone="info"
              />
              <PortalLinkCard
                eyebrow="Review"
                href={`/portal/workspaces/${workspaceId}/reports`}
                title="Reports"
                tone="success"
              />
              <PortalLinkCard
                eyebrow="Secrets"
                href={`/portal/workspaces/${workspaceId}/settings`}
                testId="workspace-runs-open-settings"
                title="Settings"
                tone="warning"
              />
              {isPortalAdminSession(session) ? (
                <PortalLinkCard
                  eyebrow="Admin"
                  href="/portal/admin/ai/agents"
                  testId="workspace-runs-open-admin"
                  title="Admin agents"
                  tone="warning"
                />
              ) : null}
            </PortalLinkGrid>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-runs-list">
          <PortalSectionHeader
            badgeLabel="History"
            badgeClassName="tag tag--info"
            title="Recent runs"
          />
          <form className="stack-form form-shell" method="GET">
            <div className="form-grid">
              <label className="field">
                <span>Search runs</span>
                <input
                  autoComplete="off"
                  data-testid="workspace-runs-search-input"
                  defaultValue={runQuery.q}
                  name="q"
                  placeholder="Filter by source, status, agent, or report title…"
                />
              </label>
              <label className="field">
                <span>Status</span>
                <select data-testid="workspace-runs-status-select" defaultValue={runQuery.status} name="status">
                  <option value="">All statuses</option>
                  <option value="pending">pending</option>
                  <option value="queued">queued</option>
                  <option value="running">running</option>
                  <option value="succeeded">succeeded</option>
                  <option value="failed">failed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </label>
            </div>
            <button className="button-ghost" data-testid="workspace-runs-search-submit" type="submit">Apply run filter</button>
          </form>
          {jobs.length === 0 ? <p className="subtle-note">No jobs matched this filter yet.</p> : null}
          {jobs.length > 0 ? (
            <div className="portal-record-grid">
              {jobs.map(job => (
                <article className="portal-record-card" data-testid={`workspace-runs-row-${job.job.id}`} key={job.job.id}>
                  <div className="portal-record-card__header">
                    <div className="portal-record-card__title">
                      <strong>{formatJobLabel(job.job, tasks)}</strong>
                      <p>{job.job.sourceLocation}</p>
                    </div>
                    <div className="portal-record-card__meta">
                      <span className={getJobStatusTagClass(job.job.status)}>{job.job.status}</span>
                      <span className="tag tag--neutral">{formatJobExecutionMode(job.job)}</span>
                      <span className="tag tag--info">{job.job.runtimeMode}</span>
                    </div>
                  </div>
                  {job.job.companionSourceLocation ? (
                    <PortalMetaList
                      items={[
                        { label: "Companion source", value: job.job.companionSourceLocation },
                      ]}
                    />
                  ) : null}
                  <div className="portal-record-card__actions">
                    <Link
                      className="button-ghost"
                      data-testid={`workspace-runs-open-job-${job.job.id}`}
                      href={`/portal/workspaces/${workspaceId}/runs/${job.job.id}` as Route}
                    >
                      Open job
                    </Link>
                    {job.report ? (
                      <Link
                        className="button-secondary"
                        data-testid={`workspace-runs-open-report-${job.report.id}`}
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
          <PaginationLinks
            pathname={`/portal/workspaces/${workspaceId}/runs`}
            searchParams={query}
            pageInfo={jobsPageInfo}
            testIdPrefix="workspace-runs"
          />
        </section>
      </PortalShell>
      );
    } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      return (
        <PortalShell
          eyebrow="Workspace runs"
          title="Access denied"
          pageTestId="workspace-runs-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <PortalNoticePanel
            actions={<Link className="button-secondary" href={"/portal/workspaces" as Route}>Back to workspaces</Link>}
            description="You do not have access to this workspace."
            descriptionTestId="workspace-runs-access-denied"
            title="Access denied"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
