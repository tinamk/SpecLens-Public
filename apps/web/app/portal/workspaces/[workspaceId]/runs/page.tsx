import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import {
  CreateWorkspaceSecretForm,
  DeleteWorkspaceSecretButton,
  QueueAnalysisForm,
  UpdateWorkspaceSecretForm,
} from "../../../../../components/portal-actions";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import {
  ApiResponseError,
  getCurrentUser,
  getPortalAnalysisTasks,
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

  try {
    const runQuery = {
      q: typeof query.q === "string" ? query.q : "",
      status: typeof query.status === "string" ? query.status : "",
      page: typeof query.page === "string" ? Number.parseInt(query.page, 10) || 1 : 1,
      pageSize: 25,
    };
    const secretQuery = {
      q: typeof query.secretQ === "string" ? query.secretQ : "",
      page: typeof query.secretPage === "string" ? Number.parseInt(query.secretPage, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, { items: jobs, pageInfo: jobsPageInfo }, tasks, { items: secrets, pageInfo: secretsPageInfo }, currentUser] = await Promise.all([
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
        page: secretQuery.page,
        pageSize: secretQuery.pageSize,
        ...(secretQuery.q ? { q: secretQuery.q } : {}),
      }),
      getCurrentUser(),
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
        lede="Queue AI tasks, pair companion sources, and review durable run history from one focused run surface."
        pageTestId="workspace-runs-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="runs"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-runs-stat-active">
            <span className="portal-stat__label">Live runs</span>
            <span className="portal-stat__value">{activeRuns}</span>
            <p>Pending, queued, and running jobs that still need attention.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-completed">
            <span className="portal-stat__label">Completed</span>
            <span className="portal-stat__value">{completedRuns}</span>
            <p>Succeeded runs that already finished their hosted execution.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-tasks">
            <span className="portal-stat__label">AI tasks</span>
            <span className="portal-stat__value">{tasks.length}</span>
            <p>DB-backed task definitions currently available for queueing.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-runs-stat-secrets">
            <span className="portal-stat__label">Run secrets</span>
            <span className="portal-stat__value">{secrets.length}</span>
            <p>{reportBackedRuns} run{reportBackedRuns === 1 ? "" : "s"} already produced durable report output.</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-queue-panel">
            <PortalSectionHeader
              badgeLabel="Queue"
              badgeClassName="tag tag--info"
              title="Queue AI task"
              description="Choose the primary source, optionally pair a companion source, then launch the hosted run from here."
            />
            <PortalMetaList
              items={[
                { label: "Connected sources", value: workspaceConsole.sources.length },
                { label: "Available AI tasks", value: tasks.length },
                { label: "Secret attachment", value: canManageWorkspace ? "Owner can attach secrets to new runs" : "Read-only for this account" },
              ]}
            />
            <QueueAnalysisForm
              workspaceId={workspaceId}
              tasks={tasks}
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
              badgeLabel="Readiness"
              title="Run readiness"
              description="Keep this route focused on queueing and history instead of mixing source setup or admin-state work into the same screen."
            />
            <PortalMetaList
              items={[
                { label: "Source prerequisite", value: workspaceConsole.sources.length > 0 ? "At least one source is available" : "Add a source before queueing" },
                { label: "Admin support", value: isPortalAdminSession(session) ? "Admin agents available from this session" : "Admin-only agent controls stay separate" },
              ]}
            />
            <PortalLinkGrid testId="workspace-runs-guide-grid">
              <PortalLinkCard
                description="Open the sources route to add or repair repository inputs before queueing more analysis."
                eyebrow="Sources"
                href={`/portal/workspaces/${workspaceId}/sources`}
                testId="workspace-runs-open-sources"
                title="Open sources"
                tone="info"
              />
              <PortalLinkCard
                description="Review completed output and remediation history once queued runs settle into report state."
                eyebrow="Review"
                href={`/portal/workspaces/${workspaceId}/reports`}
                title="Open reports"
                tone="success"
              />
              {isPortalAdminSession(session) ? (
                <PortalLinkCard
                  description="Open the admin agents route when this run surface needs admin-triggered agent troubleshooting."
                  eyebrow="Admin"
                  href="/portal/admin/ai/agents"
                  testId="workspace-runs-open-admin"
                  title="Open admin agents"
                  tone="warning"
                />
              ) : null}
            </PortalLinkGrid>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-secrets-panel">
            <PortalSectionHeader
              badgeLabel="Secrets"
              badgeClassName="tag tag--warning"
              title="Workspace run secrets"
              description="Secret metadata stays reviewable so collaborators can choose the right runtime inputs without exposing write-only values."
            />
            <form className="stack-form form-shell" method="GET">
              <div className="form-grid">
                <label className="field field--full">
                  <span>Search secrets</span>
                  <input
                    autoComplete="off"
                    data-testid="workspace-runs-secrets-search-input"
                    defaultValue={secretQuery.q}
                    name="secretQ"
                    placeholder="Filter by name, kind, or preview…"
                  />
                </label>
              </div>
              <input name="page" type="hidden" value={String(runQuery.page)} />
              <input name="status" type="hidden" value={runQuery.status} />
              <input name="q" type="hidden" value={runQuery.q} />
              <button className="button-ghost" data-testid="workspace-runs-secrets-search-submit" type="submit">Apply secret filter</button>
            </form>
            {canManageWorkspace ? (
              <CreateWorkspaceSecretForm workspaceId={workspaceId} />
            ) : (
              <p className="subtle-note" data-testid="workspace-runs-secrets-read-only">
                Secret values remain write-only. This account can review stored secret metadata, but only the workspace owner can attach those secrets to new runs or modify them.
              </p>
            )}
            {secrets.length === 0 ? <p className="subtle-note">No workspace secrets stored yet.</p> : null}
            {secrets.length > 0 ? (
              <div className="portal-record-grid">
                {secrets.map(secret => (
                  <article className="portal-record-card" data-testid={`workspace-runs-secret-row-${secret.id}`} key={secret.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{secret.name}</strong>
                        <p>{secret.valuePreview}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className="tag tag--neutral">{secret.kind}</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Kind", value: secret.kind },
                        { label: "Preview", value: secret.valuePreview },
                        { label: "Mutation", value: canManageWorkspace ? "Owner can update or remove" : "Read-only metadata only" },
                      ]}
                    />
                    {canManageWorkspace ? (
                      <div className="portal-record-card__actions">
                        <UpdateWorkspaceSecretForm
                          workspaceId={workspaceId}
                          secret={secret}
                        />
                        <DeleteWorkspaceSecretButton
                          workspaceId={workspaceId}
                          secretId={secret.id}
                          secretName={secret.name}
                          testId={`workspace-runs-secret-delete-${secret.id}`}
                        />
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
            <PaginationLinks
              pathname={`/portal/workspaces/${workspaceId}/runs`}
              searchParams={query}
              pageInfo={secretsPageInfo}
              pageParamKey="secretPage"
              testIdPrefix="workspace-runs-secrets"
            />
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-runs-list">
          <PortalSectionHeader
            badgeLabel="History"
            badgeClassName="tag tag--info"
            title="Recent runs"
            description="Review job state here first, then jump into the exact run or report you need."
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
            <input name="secretQ" type="hidden" value={secretQuery.q} />
            <input name="secretPage" type="hidden" value={String(secretQuery.page)} />
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
                  <PortalMetaList
                    items={[
                      { label: "Run kind", value: job.job.jobKind },
                      { label: "Companion source", value: job.job.companionSourceLocation ?? "No companion source" },
                      { label: "Report state", value: job.report ? "Durable report is ready" : "Open the job for logs and artifacts" },
                    ]}
                  />
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
            title="This run surface is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
