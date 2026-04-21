import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
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
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatJobExecutionMode,
  formatJobLabel,
} from "../../../../../lib/portal";

export default async function WorkspaceRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/runs`);

  try {
    const query = await searchParams;
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
        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-queue-panel">
            <span className="tag tag--info">Queue</span>
            <h2>Queue AI task</h2>
            <p>Choose a DB-backed AI task and optionally pair a primary source with a companion source.</p>
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
            <span className="tag tag--neutral">Guide</span>
            <h2>Run readiness</h2>
            <p>You need at least one source and one AI task. Add sources in the source area and manage tasks in admin when needed.</p>
            <div className="stack-form">
              <Link className="button-ghost" data-testid="workspace-runs-open-sources" href={`/portal/workspaces/${workspaceId}/sources` as Route}>Open sources</Link>
              {isPortalAdminSession(session) ? (
                <Link className="button-ghost" data-testid="workspace-runs-open-admin" href="/portal/admin/ai/agents">Open admin agents</Link>
              ) : null}
            </div>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-runs-secrets-panel">
            <span className="tag tag--warning">Secrets</span>
            <h2>Workspace run secrets</h2>
            <p>Secret metadata is visible to workspace members so they can select the right runtime inputs, but only the workspace owner can create or delete them.</p>
            <form className="stack-form" method="GET">
              <label className="field">
                <span>Search secrets</span>
                <input
                  data-testid="workspace-runs-secrets-search-input"
                  defaultValue={secretQuery.q}
                  name="secretQ"
                  placeholder="Filter by name, kind, or preview"
                />
              </label>
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
            {secrets.map(secret => (
              <div className="list-row" data-testid={`workspace-runs-secret-row-${secret.id}`} key={secret.id}>
                <div>
                  <strong>{secret.name}</strong>
                  <p>{secret.kind} · {secret.valuePreview}</p>
                </div>
                {canManageWorkspace ? (
                  <div className="list-row__actions">
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
              </div>
            ))}
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
          <div className="auth-status">
            <div>
              <span className="tag tag--info">History</span>
              <h2>Recent runs</h2>
            </div>
          </div>
          <form className="stack-form" method="GET">
            <label className="field">
              <span>Search runs</span>
              <input
                data-testid="workspace-runs-search-input"
                defaultValue={runQuery.q}
                name="q"
                placeholder="Filter by source, status, agent, or report title"
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
            <input name="secretQ" type="hidden" value={secretQuery.q} />
            <input name="secretPage" type="hidden" value={String(secretQuery.page)} />
            <button className="button-ghost" data-testid="workspace-runs-search-submit" type="submit">Apply run filter</button>
          </form>
          {jobs.length === 0 ? <p className="subtle-note">No jobs matched this filter yet.</p> : null}
          {jobs.map(job => (
            <div className="list-row" data-testid={`workspace-runs-row-${job.job.id}`} key={job.job.id}>
              <div>
                <strong>{formatJobLabel(job.job, tasks)}</strong>
                <p>{job.job.status} · {formatJobExecutionMode(job.job)} · {job.job.runtimeMode}</p>
                <p>{job.job.sourceLocation}</p>
              </div>
              <div className="list-row__actions">
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
            </div>
          ))}
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
          <p className="inline-error" data-testid="workspace-runs-access-denied">You do not have access to this workspace.</p>
          <Link className="button-secondary" href={"/portal/workspaces" as Route}>Back to workspaces</Link>
        </PortalShell>
      );
    }
    throw error;
  }
}
