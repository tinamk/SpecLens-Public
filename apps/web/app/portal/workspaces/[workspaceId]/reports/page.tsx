import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import { ApiResponseError, getPortalAnalysisTasks, getWorkspaceConsole, getWorkspaceJobsPage } from "../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  getWorkspaceRunHref,
  buildWorkspaceNav,
  formatJobLabel,
  getWorkspaceReportHref,
  getWorkspaceReportsEmptyState,
} from "../../../../../lib/portal";

export default async function WorkspaceReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/reports`);

  try {
    const query = await searchParams;
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
        <section className="portal-panel" data-testid="workspace-reports-list">
          <div className="auth-status">
            <div>
              <span className="tag tag--success">Reports</span>
              <h2>Available reports</h2>
            </div>
          </div>
          <form className="stack-form" method="GET">
            <label className="field">
              <span>Search reports</span>
              <input
                data-testid="workspace-reports-search-input"
                defaultValue={reportQuery.q}
                name="q"
                placeholder="Filter by report title, source, or job status"
              />
            </label>
            <button className="button-ghost" data-testid="workspace-reports-search-submit" type="submit">Apply report filter</button>
          </form>
          {jobsWithReports.length === 0 ? (
            <div className="subtle-note" data-testid="workspace-reports-empty-state">
              <p><strong>{emptyState.title}</strong></p>
              <p>{emptyState.detail}</p>
            </div>
          ) : null}
          {jobsWithReports.map(job => {
            const reportHref = getWorkspaceReportHref(workspaceId, job.report?.id);
            const jobHref = getWorkspaceRunHref(workspaceId, job.job.id);
            return (
              <div className="list-row" data-testid={`workspace-reports-row-${job.report?.id ?? job.job.id}`} key={job.job.id}>
                <div>
                  <strong>{job.report?.title ?? "Generated report"}</strong>
                  <p>{formatJobLabel(job.job, tasks)} · {job.job.status}</p>
                  <p>{job.job.sourceLocation}</p>
                  {reportHref ? null : (
                    <p className="subtle-note" data-testid={`workspace-reports-missing-report-${job.job.id}`}>
                      Report details are temporarily unavailable. Open the job to review logs and artifacts.
                    </p>
                  )}
                </div>
                <div className="list-row__actions">
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
              </div>
            );
          })}
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
          <p className="inline-error" data-testid="workspace-reports-access-denied">You do not have access to this workspace.</p>
        </PortalShell>
      );
    }
    throw error;
  }
}
