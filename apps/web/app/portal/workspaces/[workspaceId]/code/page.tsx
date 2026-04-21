import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { WorkspaceCodePrPanel } from "../../../../../components/workspace-code-pr-panel";
import { ApiResponseError, getCurrentUser, getWorkspaceCodeReview, getWorkspaceConsole } from "../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatSourceType,
  isWorkspaceScopedCodePageContext,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../lib/portal";

function buildCodeHref(workspaceId: string, query: {
  sourceId: string;
  ref?: string | null;
  path?: string | null;
  compare?: string | null;
  reportId?: string | null;
  findingId?: string | null;
  pr?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("sourceId", query.sourceId);
  if (query.ref) params.set("ref", query.ref);
  if (query.path) params.set("path", query.path);
  if (query.compare) params.set("compare", query.compare);
  if (query.reportId) params.set("reportId", query.reportId);
  if (query.findingId) params.set("findingId", query.findingId);
  if (query.pr) params.set("pr", query.pr);
  return `/portal/workspaces/${workspaceId}/code?${params.toString()}`;
}

export default async function WorkspaceCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/code`);

  try {
    const [workspaceConsole, user] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getCurrentUser(),
    ]);
    const sourceId = typeof query.sourceId === "string" ? query.sourceId : undefined;
    const ref = typeof query.ref === "string" ? query.ref : undefined;
    const filePath = typeof query.path === "string" ? query.path : undefined;
    const compare = typeof query.compare === "string" ? query.compare : undefined;
    const reportId = typeof query.reportId === "string" ? query.reportId : undefined;
    const findingId = typeof query.findingId === "string" ? query.findingId : undefined;
    const pr = typeof query.pr === "string" ? query.pr : undefined;
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)) {
      throw new ApiResponseError(404, `Workspace code payload does not belong to workspace ${workspaceId}.`);
    }
    const canMutate = user.id === workspaceConsole.workspace.ownerUserId || isPortalAdminSession(session);
    if (!sourceId && workspaceConsole.sources.length > 1) {
      return (
        <PortalShell
          eyebrow="Workspace code"
          title={workspaceConsole.workspace.name}
          lede="Select a Git source before reviewing files, diffs, changesets, or pull requests."
          pageTestId="workspace-code-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
          secondaryNav={buildWorkspaceNav(workspaceId)}
          activeSecondaryNavKey="code"
        >
          <section className="portal-grid">
            <article className="portal-panel" data-testid="workspace-code-source-panel">
              <span className="tag tag--info">Source</span>
              <h2>Select a repository</h2>
              <div className="stack-form">
                {workspaceConsole.sources.map(source => (
                  <Link
                    key={source.id}
                    className="button"
                    data-testid={`workspace-code-source-${source.id}`}
                    href={buildCodeHref(workspaceId, { sourceId: source.id }) as Route}
                  >
                    {source.displayName}
                  </Link>
                ))}
              </div>
            </article>
            <article className="portal-panel" data-testid="workspace-code-permissions">
              <span className="tag tag--warning">Permissions</span>
              <h2>Mutation policy</h2>
              <p>{canMutate ? "This account can launch remediation and remote publish workflows." : "This account is read-only for code review and remediation."}</p>
            </article>
          </section>
        </PortalShell>
      );
    }
    const reviewQuery: {
      sourceId?: string;
      ref?: string;
      path?: string;
      compare?: string;
      reportId?: string;
      findingId?: string;
      pr?: string;
    } = {};
    if (sourceId) reviewQuery.sourceId = sourceId;
    if (ref) reviewQuery.ref = ref;
    if (filePath) reviewQuery.path = filePath;
    if (compare) reviewQuery.compare = compare;
    if (reportId) reviewQuery.reportId = reportId;
    if (findingId) reviewQuery.findingId = findingId;
    if (pr) reviewQuery.pr = pr;
    const review = await getWorkspaceCodeReview(workspaceId, reviewQuery);
    if (!isWorkspaceScopedCodePageContext(workspaceId, review, workspaceConsole)) {
      throw new ApiResponseError(404, `Code review payload does not belong to workspace ${workspaceId}.`);
    }
    const findings = review.activeFindingId
      ? [
          ...review.findings.filter(finding => finding.id === review.activeFindingId),
          ...review.findings.filter(finding => finding.id !== review.activeFindingId),
        ]
      : review.findings;
    const unattributedFindings = review.unattributedFindings;

    return (
      <PortalShell
        eyebrow="Workspace code"
        title={workspaceConsole.workspace.name}
        lede="Browse the source tree, inspect file content or diffs, and review PR and remediation context without leaving the workspace."
        pageTestId="workspace-code-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="code"
      >
        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-code-source-panel">
            <span className="tag tag--info">Source</span>
            <h2>{review.source.displayName}</h2>
            <p>{formatSourceType(review.source.type)} · {review.source.location}</p>
            <div className="stack-form">
              {workspaceConsole.sources.map(source => (
                <Link
                  key={source.id}
                  className={source.id === review.source.id ? "button" : "button-ghost"}
                  data-testid={`workspace-code-source-${source.id}`}
                  href={buildCodeHref(workspaceId, { sourceId: source.id }) as Route}
                >
                  {source.displayName}
                </Link>
              ))}
            </div>
          </article>
          <article className="portal-panel" data-testid="workspace-code-ref-panel">
            <span className="tag tag--neutral">Ref</span>
            <h2>Branches and refs</h2>
            <div className="stack-form">
              {review.refs.map(gitRef => (
                <Link
                  key={gitRef.name}
                  className={gitRef.name === review.selectedRef ? "button" : "button-ghost"}
                  data-testid={`workspace-code-ref-${gitRef.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                  href={buildCodeHref(workspaceId, {
                    sourceId: review.source.id,
                    ref: gitRef.name,
                    path: review.selectedPath,
                    reportId: review.activeReportId,
                    findingId: review.activeFindingId,
                  }) as Route}
                >
                  {gitRef.name}{gitRef.isHead ? " (HEAD)" : ""}
                </Link>
              ))}
            </div>
          </article>
          <article className="portal-panel" data-testid="workspace-code-permissions">
            <span className="tag tag--warning">Permissions</span>
            <h2>Mutation policy</h2>
            <p>{canMutate ? "This account can launch remediation and remote publish workflows." : "This account is read-only for code review and remediation."}</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-code-tree-panel">
            <span className="tag tag--neutral">Tree</span>
            <h2>Repository tree</h2>
            <div className="stack-form">
              {review.tree.map(entry => (
                <Link
                  key={entry.path}
                  className="button-ghost"
                  data-testid={`workspace-code-tree-entry-${entry.path.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                  href={buildCodeHref(workspaceId, {
                    sourceId: review.source.id,
                    ref: review.selectedRef,
                    path: entry.path,
                    compare: review.compareRef,
                    reportId: review.activeReportId,
                    findingId: review.activeFindingId,
                  }) as Route}
                >
                  {entry.kind === "directory" ? "Dir" : "File"} · {entry.path}{entry.changed ? " · changed" : ""}{entry.hasFindings ? " · findings" : ""}
                </Link>
              ))}
              {review.tree.length === 0 ? <p className="subtle-note">No entries found for this ref/path.</p> : null}
            </div>
          </article>

          <article className="portal-panel xl:col-span-2" data-testid="workspace-code-viewer-panel">
            <span className="tag tag--success">Viewer</span>
            <h2>{review.selectedPath ?? "Select a file to inspect"}</h2>
            {review.compareRef ? <p data-testid="workspace-code-diff-header"><strong>Diff:</strong> {review.compareRef} {"->"} {review.selectedRef}</p> : null}
            {review.diff ? <pre className="data-preview" data-testid="workspace-code-diff">{review.diff}</pre> : null}
            {!review.diff && review.fileContent ? <pre className="data-preview" data-testid="workspace-code-file">{review.fileContent}</pre> : null}
            {!review.diff && !review.fileContent ? <p className="subtle-note">Select a file or compare a PR to inspect code here.</p> : null}
          </article>
        </section>

        <section className="portal-grid">
          <WorkspaceCodePrPanel
            workspaceId={workspaceId}
            sourceId={review.source.id}
            prSupport={review.prSupport}
            activeReportId={review.activeReportId}
            selectedPr={pr ?? null}
            initialPullRequest={review.selectedPullRequest}
          />

          <article className="portal-panel" data-testid="workspace-code-changeset-panel">
            <span className="tag tag--warning">Changesets</span>
            <h2>Latest remediation jobs</h2>
            {review.changesets.length === 0 ? <p className="subtle-note">No remediation changesets are available for this source yet.</p> : null}
            {review.changesets.map(changeset => (
              <div className="list-row" data-testid={`workspace-code-changeset-${changeset.jobId}`} key={changeset.jobId}>
                <div>
                  <strong>{changeset.branchName ?? "No branch created"}</strong>
                  <p>{changeset.changedFiles.length} changed file(s) · {changeset.stopReason}</p>
                  <p>{changeset.validationPassed ? "Validation passed" : "Validation not green"}</p>
                  {changeset.validationCommands.length > 0 ? (
                    <p>Validation commands: {changeset.validationCommands.join(", ")}</p>
                  ) : null}
                  {changeset.pullInstructions.length > 0 ? (
                    <p>Pull/apply: {changeset.pullInstructions.join(" | ")}</p>
                  ) : null}
                </div>
                <div className="list-row__actions">
                  <Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/runs/${changeset.jobId}` as Route}>Open run</Link>
                  {changeset.prUrl ? <a className="button-ghost" href={changeset.prUrl} target="_blank" rel="noreferrer">Open PR</a> : null}
                </div>
              </div>
            ))}
          </article>

          <article className="portal-panel xl:col-span-2" data-testid="workspace-code-findings-panel">
            <span className="tag tag--neutral">Audit context</span>
            <h2>Findings and fix guidance</h2>
            <p><strong>Active report:</strong> {review.activeReportId ?? "none selected"}</p>
            <p><strong>Remediation packs:</strong> {review.remediationPacks.length}</p>
            <p><strong>Fix handoff entries:</strong> {review.fixHandoff?.entries.length ?? 0}</p>
            {findings.map(finding => (
              <div className="list-row" data-testid={`workspace-code-finding-${finding.id}`} key={finding.id}>
                <div>
                  <strong>{finding.title}</strong>
                  <p>{finding.severity} · {finding.message}</p>
                  {finding.id === review.activeFindingId ? <p className="subtle-note">Focused finding</p> : null}
                </div>
                <div className="list-row__actions">
                  <Link
                    className="button-ghost"
                    href={buildCodeHref(workspaceId, {
                      sourceId: review.source.id,
                      ref: review.selectedRef,
                      ...(finding.paths.length === 1
                        ? { path: finding.paths[0] }
                        : review.selectedPath
                          ? { path: review.selectedPath }
                          : {}),
                      reportId: review.activeReportId,
                      findingId: finding.id,
                    }) as Route}
                  >
                    Focus finding
                  </Link>
                </div>
              </div>
            ))}
            {findings.length === 0 ? <p className="subtle-note">No findings are mapped to this source yet.</p> : null}
            {unattributedFindings.length > 0 ? (
              <>
                <p><strong>Unattributed findings:</strong> {unattributedFindings.length}</p>
                {unattributedFindings.map(finding => (
                  <div className="list-row" data-testid={`workspace-code-unattributed-finding-${finding.id}`} key={finding.id}>
                    <div>
                      <strong>{finding.title}</strong>
                      <p>{finding.severity} · {finding.message}</p>
                      {finding.id === review.activeFindingId ? <p className="subtle-note">Focused finding</p> : null}
                      <p className="subtle-note">This finding is not mapped to a specific source yet.</p>
                    </div>
                    <div className="list-row__actions">
                      <Link
                        className="button-ghost"
                        href={buildCodeHref(workspaceId, {
                          sourceId: review.source.id,
                          ref: review.selectedRef,
                          ...(finding.paths.length === 1
                            ? { path: finding.paths[0] }
                            : review.selectedPath
                              ? { path: review.selectedPath }
                              : {}),
                          reportId: review.activeReportId,
                          findingId: finding.id,
                        }) as Route}
                      >
                        Focus finding
                      </Link>
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </article>
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 400 || error.status === 403 || error.status === 404 || error.status === 409)) {
      const retryHref = (() => {
        const sourceId = typeof query.sourceId === "string" ? query.sourceId : null;
        if (!sourceId) {
          return `/portal/workspaces/${workspaceId}/code`;
        }
        return buildCodeHref(workspaceId, {
          sourceId,
          ref: typeof query.ref === "string" ? query.ref : null,
          path: typeof query.path === "string" ? query.path : null,
          compare: typeof query.compare === "string" ? query.compare : null,
          reportId: typeof query.reportId === "string" ? query.reportId : null,
          findingId: typeof query.findingId === "string" ? query.findingId : null,
          pr: typeof query.pr === "string" ? query.pr : null,
        });
      })();
      return (
        <PortalShell
          eyebrow="Workspace code"
          title={
            error.status === 409
              ? "Code review warming"
              : error.status === 400
                ? "Code review unavailable"
                : error.status === 404
                  ? "Code review target not found"
                  : "Access denied"
          }
          pageTestId="workspace-code-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <p className="inline-error" data-testid="workspace-code-access-denied">
            {error.status === 409
              ? error.message
              : error.status === 400
              ? error.message
              : error.status === 404
                ? "The requested source, report, or finding is not available for this code review surface."
                : "You do not have access to this workspace code review surface."}
          </p>
          {error.status === 409 ? (
            <Link className="button-secondary" href={retryHref as Route}>Retry code review</Link>
          ) : null}
          <Link className="button-secondary" href={`/portal/workspaces/${workspaceId}` as Route}>Back to workspace</Link>
        </PortalShell>
      );
    }
    throw error;
  }
}
