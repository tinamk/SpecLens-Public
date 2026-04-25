import type { Route } from "next";
import Link from "next/link";
import { PortalSectionHeader, PortalShell } from "@speclens/ui";
import { DataPath } from "../../../../../components/data-visuals";
import { buildSearchHref, PaginationLinks } from "@speclens/ui";
import { WorkspaceRouteState } from "../../../../../components/workspace-route-state";
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
    const totalReports = workspaceConsole.stats.reportBackedJobs;
    const uniqueSourcesWithReports = workspaceConsole.stats.sourcesWithReports;
    const inFlightRuns = workspaceConsole.stats.activeJobs;

    return (
      <PortalShell
        eyebrow="Workspace reports"
        title={workspaceConsole.workspace.name}
        pageTestId="workspace-reports-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="reports"
      >
        <section className="portal-stat-grid" aria-label="Workspace reports summary">
          <article className="portal-stat" data-testid="workspace-reports-stat-total">
            <span className="portal-stat__label">Reports</span>
            <span className="portal-stat__value">{totalReports}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-reports-stat-sources">
            <span className="portal-stat__label">Sources covered</span>
            <span className="portal-stat__value">{uniqueSourcesWithReports}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-reports-stat-visible">
            <span className="portal-stat__label">Visible</span>
            <span className="portal-stat__value">{jobsWithReports.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-reports-stat-in-flight">
            <span className="portal-stat__label">Running</span>
            <span className="portal-stat__value">{inFlightRuns}</span>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-reports-list">
          <PortalSectionHeader
            title="Reports"
            description="Each report is the durable review artifact for a completed run. Open the report for release gate, findings, evidence, and remediation handoff; open the run for logs and sandbox artifacts."
          />
          <form aria-label="Search reports" className="stack-form form-shell" method="GET" role="search">
            <div className="form-grid">
              <label className="field field--full">
                <span>Search reports</span>
                <input
                  autoComplete="off"
                  data-testid="workspace-reports-search-input"
                  defaultValue={reportQuery.q}
                  name="q"
                  placeholder="Filter by report title, source, or run status…"
                />
              </label>
            </div>
            <div className="portal-inline-actions">
              <button className="button-ghost" data-testid="workspace-reports-search-submit" type="submit">Apply report filter</button>
              {reportQuery.q ? (
                <Link
                  className="button-secondary"
                  data-testid="workspace-reports-clear-filters"
                  href={buildSearchHref(`/portal/workspaces/${workspaceId}/reports`, query, {
                    page: undefined,
                    q: undefined,
                  })}
                >
                  Clear filters
                </Link>
              ) : null}
            </div>
          </form>
          {jobsWithReports.length === 0 ? (
            <div className="subtle-note" data-testid="workspace-reports-empty-state">
              <p><strong>{emptyState.title}</strong></p>
              <p>{emptyState.detail}</p>
              <p>
                <Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/runs` as Route}>
                  Open runs
                </Link>
              </p>
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
                        <h3>{job.report?.title ?? "Generated report"}</h3>
                        <p><DataPath value={job.job.sourceLocation} /></p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getJobStatusTagClass(job.job.status)}>{job.job.status}</span>
                        {job.report?.status ? <span className="tag tag--info">report {job.report.status}</span> : null}
                        <span className="tag tag--neutral">{formatJobLabel(job.job, tasks)}</span>
                      </div>
                    </div>
                    {!reportHref ? (
                      <p className="subtle-note" data-testid={`workspace-reports-missing-report-${job.job.id}`}>
                        Report details unavailable.
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
                        Open run
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
      const isMissing = error.status === 404;
      return (
        <WorkspaceRouteState
          backHref={isMissing ? "/portal/workspaces" as Route : `/portal/workspaces/${workspaceId}` as Route}
          backLabel={isMissing ? "Back to workspaces" : "Back to workspace"}
          eyebrow="Workspace reports"
          isAdmin={isPortalAdminSession(session)}
          isMissing={isMissing}
          pageTestId="workspace-reports-access-denied-page"
          descriptionTestId="workspace-reports-access-denied"
        />
      );
    }
    throw error;
  }
}
