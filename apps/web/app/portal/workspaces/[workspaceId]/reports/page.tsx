import type { Route } from "next";
import Link from "next/link";
import { PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import { ApiResponseError, getPortalAnalysisTasks, getWorkspaceConsole, getWorkspaceJobsPage } from "../../../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  getWorkspaceRunHref,
  buildWorkspaceNav,
  formatJobLabel,
  getJobStatusTagClass,
  getWorkspaceReportHref,
  getWorkspaceReportsEmptyState,
  isWorkspaceScopedJobsPage,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../lib/portal";

export default async function WorkspaceReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const session = await requirePortalSession(buildPortalReturnTo(`/portal/workspaces/${workspaceId}/reports`, query));

  try {
    const reportQuery = {
      q: typeof query.q === "string" ? query.q : "",
      page: typeof query.page === "string" ? Number.parseInt(query.page, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, tasks, { items: jobsWithReports, pageInfo }] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getPortalAnalysisTasks(),
      getWorkspaceJobsPage({
        workspaceId,
        hasReport: true,
        page: reportQuery.page,
        pageSize: reportQuery.pageSize,
        ...(reportQuery.q ? { q: reportQuery.q } : {}),
      }),
    ]);

    const emptyState = getWorkspaceReportsEmptyState(reportQuery.q);
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)
      || !isWorkspaceScopedJobsPage(workspaceId, jobsWithReports)) {
      throw new ApiResponseError(404, `Workspace reports payload does not belong to workspace ${workspaceId}.`);
    }
    const totalReports = workspaceConsole.jobs.filter(entry => entry.report != null).length;
    const uniqueSourcesWithReports = new Set(workspaceConsole.jobs.filter(entry => entry.report != null).map(entry => entry.job.sourceId)).size;
    const inFlightRuns = workspaceConsole.jobs.filter(entry => ["pending", "queued", "running"].includes(entry.job.status)).length;

    return (
      <PortalShell
        eyebrow="Workspace reports"
        title={workspaceConsole.workspace.name}
        lede="Completed report output stays separate from run queueing so review flows and durable history are easier to test and navigate."
        pageTestId="workspace-reports-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="reports"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-reports-stat-total">
            <span className="portal-stat__label">Report-backed runs</span>
            <span className="portal-stat__value">{totalReports}</span>
            <p>Completed jobs with durable report output across the workspace.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-reports-stat-sources">
            <span className="portal-stat__label">Sources covered</span>
            <span className="portal-stat__value">{uniqueSourcesWithReports}</span>
            <p>Distinct sources that already have report history.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-reports-stat-visible">
            <span className="portal-stat__label">Visible now</span>
            <span className="portal-stat__value">{jobsWithReports.length}</span>
            <p>Reports on the current page after the active filter is applied.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-reports-stat-in-flight">
            <span className="portal-stat__label">Still running</span>
            <span className="portal-stat__value">{inFlightRuns}</span>
            <p>Open the runs view when you need logs before the report exists.</p>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-reports-list">
          <PortalSectionHeader
            badgeLabel="Reports"
            badgeClassName="tag tag--success"
            title="Available reports"
            description="Use the reports route for review and the runs route for execution-state troubleshooting."
          />
          <form className="stack-form form-shell" method="GET">
            <div className="form-grid">
              <label className="field field--full">
                <span>Search reports</span>
                <input
                  autoComplete="off"
                  data-testid="workspace-reports-search-input"
                  defaultValue={reportQuery.q}
                  name="q"
                  placeholder="Filter by report title, source, or job status…"
                />
              </label>
            </div>
            <button className="button-ghost" data-testid="workspace-reports-search-submit" type="submit">Apply report filter</button>
          </form>
          {jobsWithReports.length === 0 ? (
            <div className="subtle-note" data-testid="workspace-reports-empty-state">
              <p><strong>{emptyState.title}</strong></p>
              <p>{emptyState.detail}</p>
            </div>
          ) : null}
          {jobsWithReports.length > 0 ? (
            <div className="portal-record-grid">
              {jobsWithReports.map(job => {
                const reportHref = getWorkspaceReportHref(workspaceId, job.report?.id);
                const jobHref = getWorkspaceRunHref(workspaceId, job.job.id);
                return (
                  <article className="portal-record-card" data-testid={`workspace-reports-row-${job.report?.id ?? job.job.id}`} key={job.job.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{job.report?.title ?? "Generated report"}</strong>
                        <p>{job.job.sourceLocation}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getJobStatusTagClass(job.job.status)}>{job.job.status}</span>
                        <span className="tag tag--neutral">{formatJobLabel(job.job, tasks)}</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Runtime mode", value: job.job.runtimeMode },
                        { label: "Source", value: job.job.sourceLocation },
                        { label: "Review handoff", value: reportHref ? "Report detail is ready" : "Open the job for logs and artifacts" },
                      ]}
                    />
                    {!reportHref ? (
                      <p className="subtle-note" data-testid={`workspace-reports-missing-report-${job.job.id}`}>
                        Report details are temporarily unavailable. Open the job to review logs and artifacts.
                      </p>
                    ) : null}
                    <div className="portal-record-card__actions">
                      {reportHref ? (
                        <Link
                          className="button-secondary"
                          data-testid={`workspace-reports-open-${job.report?.id}`}
                          href={reportHref}
                        >
                          Open report
                        </Link>
                      ) : null}
                      <Link
                        className="button-ghost"
                        data-testid={`workspace-reports-open-job-${job.job.id}`}
                        href={jobHref ?? (`/portal/workspaces/${workspaceId}/runs/${job.job.id}` as Route)}
                      >
                        Open job
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
          <PaginationLinks
            pathname={`/portal/workspaces/${workspaceId}/reports`}
            searchParams={query}
            pageInfo={pageInfo}
            testIdPrefix="workspace-reports"
          />
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      return (
        <PortalShell
          eyebrow="Workspace reports"
          title="Access denied"
          pageTestId="workspace-reports-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <PortalNoticePanel
            actions={<Link className="button-secondary" href={`/portal/workspaces/${workspaceId}` as Route}>Back to workspace</Link>}
            description="You do not have access to this workspace."
            descriptionTestId="workspace-reports-access-denied"
            title="This report surface is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
