import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { WorkspaceCodePrPanel } from "../../../../../components/workspace-code-pr-panel";
import { ApiResponseError, getCurrentUser, getWorkspaceCodeReview, getWorkspaceConsole } from "../../../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  canManageWorkspaceRemediation,
  formatSourceType,
  getChangesetBranchName,
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
  const session = await requirePortalSession(buildPortalReturnTo(`/portal/workspaces/${workspaceId}/code`, query));

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
    const canMutate = canManageWorkspaceRemediation(user.id === workspaceConsole.workspace.ownerUserId);
    if (!sourceId && workspaceConsole.sources.length > 1) {
      const privateSources = workspaceConsole.sources.filter(source => source.type === "github-private").length;
      const archiveSources = workspaceConsole.sources.filter(source => source.type === "upload-archive").length;
      return (
        <PortalShell
          eyebrow="Workspace code"
          title={workspaceConsole.workspace.name}
          pageTestId="workspace-code-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
          secondaryNav={buildWorkspaceNav(workspaceId)}
          activeSecondaryNavKey="code"
        >
          <section className="portal-stat-grid">
            <article className="portal-stat" data-testid="workspace-code-stat-sources">
              <span className="portal-stat__label">Sources</span>
              <span className="portal-stat__value">{workspaceConsole.sources.length}</span>
            </article>
            <article className="portal-stat" data-testid="workspace-code-stat-private-sources">
              <span className="portal-stat__label">GitHub-backed</span>
              <span className="portal-stat__value">{privateSources}</span>
            </article>
            <article className="portal-stat" data-testid="workspace-code-stat-archives">
              <span className="portal-stat__label">Archives</span>
              <span className="portal-stat__value">{archiveSources}</span>
            </article>
          </section>

          <section className="portal-grid">
            <article className="portal-panel" data-testid="workspace-code-source-panel">
              <PortalSectionHeader
                badgeLabel="Source"
                badgeClassName="tag tag--info"
                title="Select a repository"
              />
              <PortalLinkGrid>
                {workspaceConsole.sources.map(source => (
                  <PortalLinkCard
                    key={source.id}
                    href={buildCodeHref(workspaceId, { sourceId: source.id }) as Route}
                    title={source.displayName}
                    eyebrow={formatSourceType(source.type)}
                    description={source.location}
                    testId={`workspace-code-source-${source.id}`}
                    tone="info"
                  />
                ))}
              </PortalLinkGrid>
            </article>
            <article className="portal-panel" data-testid="workspace-code-permissions">
              <PortalSectionHeader
                badgeLabel="Permissions"
                badgeClassName="tag tag--warning"
                title="Mutation policy"
              />
              <PortalMetaList
                items={[
                  { label: "Mode", value: canMutate ? "Owner" : "read-only" },
                ]}
              />
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
    const totalFindings = findings.length + unattributedFindings.length;

    return (
      <PortalShell
        eyebrow="Workspace code"
        title={workspaceConsole.workspace.name}
        pageTestId="workspace-code-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="code"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-code-stat-refs">
            <span className="portal-stat__label">Refs</span>
            <span className="portal-stat__value">{review.refs.length}</span>
            <p>{review.compareRef ? `${review.compareRef} vs ${review.selectedRef}` : review.selectedRef}</p>
          </article>
          <article className="portal-stat" data-testid="workspace-code-stat-tree">
            <span className="portal-stat__label">Entries</span>
            <span className="portal-stat__value">{review.tree.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-code-stat-findings">
            <span className="portal-stat__label">Findings</span>
            <span className="portal-stat__value">{totalFindings}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-code-stat-changesets">
            <span className="portal-stat__label">Changesets</span>
            <span className="portal-stat__value">{review.changesets.length}</span>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-code-source-panel">
            <PortalSectionHeader
              badgeLabel="Source"
              badgeClassName="tag tag--info"
              title={review.source.displayName}
            />
            <PortalLinkGrid>
              {workspaceConsole.sources.map(source => (
                <PortalLinkCard
                  key={source.id}
                  href={buildCodeHref(workspaceId, { sourceId: source.id }) as Route}
                  title={source.displayName}
                  eyebrow={formatSourceType(source.type)}
                  description={source.location}
                  active={source.id === review.source.id}
                  testId={`workspace-code-source-${source.id}`}
                  tone="info"
                />
              ))}
            </PortalLinkGrid>
          </article>
          <article className="portal-panel" data-testid="workspace-code-ref-panel">
            <PortalSectionHeader
              badgeLabel="Ref"
              title="Branches and refs"
            />
            <PortalMetaList
              items={[
                { label: "Selected ref", value: review.selectedRef },
                ...(review.compareRef ? [{ label: "Diff base", value: review.compareRef }] : []),
                ...(review.activeReportId ? [{ label: "Report context", value: review.activeReportId }] : []),
              ]}
            />
            <PortalLinkGrid>
              {review.refs.map(gitRef => (
                <PortalLinkCard
                  key={gitRef.name}
                  href={buildCodeHref(workspaceId, {
                    sourceId: review.source.id,
                    ref: gitRef.name,
                    path: review.selectedPath,
                    reportId: review.activeReportId,
                    findingId: review.activeFindingId,
                  }) as Route}
                  title={gitRef.name}
                  eyebrow={gitRef.isHead ? "head ref" : "available ref"}
                  {...(review.compareRef === gitRef.name ? { description: "current diff base" } : {})}
                  active={gitRef.name === review.selectedRef}
                  testId={`workspace-code-ref-${gitRef.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                  tone={gitRef.name === review.selectedRef ? "success" : "neutral"}
                />
              ))}
            </PortalLinkGrid>
          </article>
          <article className="portal-panel" data-testid="workspace-code-permissions">
            <PortalSectionHeader
              badgeLabel="Permissions"
              badgeClassName="tag tag--warning"
              title="Mutation policy"
            />
            <PortalMetaList
              items={[
                { label: "Mode", value: canMutate ? "Owner" : "read-only" },
                ...(review.selectedPath ? [{ label: "Selected path", value: review.selectedPath }] : []),
              ]}
            />
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-code-tree-panel">
            <PortalSectionHeader
              badgeLabel="Tree"
              title="Repository tree"
            />
            <PortalLinkGrid>
              {review.tree.map(entry => (
                <PortalLinkCard
                  key={entry.path}
                  href={buildCodeHref(workspaceId, {
                    sourceId: review.source.id,
                    ref: review.selectedRef,
                    path: entry.path,
                    compare: review.compareRef,
                    reportId: review.activeReportId,
                    findingId: review.activeFindingId,
                  }) as Route}
                  title={entry.path}
                  eyebrow={entry.kind === "directory" ? "directory" : "file"}
                  {...(entry.changed && entry.hasFindings
                    ? { description: "changed · has findings" }
                    : entry.changed
                      ? { description: "changed" }
                      : entry.hasFindings
                        ? { description: "has findings" }
                        : {})}
                  active={entry.path === review.selectedPath}
                  testId={`workspace-code-tree-entry-${entry.path.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                  tone={entry.hasFindings ? "warning" : entry.changed ? "info" : "neutral"}
                />
              ))}
              {review.tree.length === 0 ? <p className="subtle-note">No entries found for this ref/path.</p> : null}
            </PortalLinkGrid>
          </article>

          <article className="portal-panel xl:col-span-2" data-testid="workspace-code-viewer-panel">
            <PortalSectionHeader
              badgeLabel="Viewer"
              badgeClassName="tag tag--success"
              title={review.selectedPath ?? "Select a file to inspect"}
            />
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
            <PortalSectionHeader
              badgeLabel="Changesets"
              badgeClassName="tag tag--warning"
              title="Latest remediation jobs"
            />
            {review.changesets.length === 0 ? <p className="subtle-note">No remediation changesets are available for this source yet.</p> : null}
            {review.changesets.length > 0 ? (
              <div className="portal-record-grid">
                {review.changesets.map(changeset => (
                  <article className="portal-record-card" data-testid={`workspace-code-changeset-${changeset.jobId}`} key={changeset.jobId}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{getChangesetBranchName({
                          branchName: changeset.branchName,
                          pullInstructions: changeset.pullInstructions,
                        }) ?? "No branch created"}</strong>
                        <p>Run {changeset.jobId.slice(0, 8)}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={changeset.validationPassed ? "tag tag--success" : "tag tag--warning"}>
                          {changeset.validationPassed ? "validation passed" : "validation not green"}
                        </span>
                        <span className="tag tag--neutral">{changeset.stopReason}</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Changed files", value: changeset.changedFiles.length },
                        ...(changeset.validationCommands.length > 0
                          ? [{ label: "Validation", value: changeset.validationCommands.join(", ") }]
                          : []),
                      ]}
                    />
                    <div className="portal-record-card__actions">
                      <Link className="button-secondary" href={`/portal/workspaces/${workspaceId}/runs/${changeset.jobId}` as Route}>Open run</Link>
                      {changeset.prUrl ? <a className="button-ghost" href={changeset.prUrl} target="_blank" rel="noreferrer">Open PR</a> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </article>

          <article className="portal-panel xl:col-span-2" data-testid="workspace-code-findings-panel">
            <PortalSectionHeader
              badgeLabel="Audit context"
              title="Findings and fix guidance"
            />
            <PortalMetaList
              items={[
                { label: "Active report", value: review.activeReportId ?? "none selected" },
                { label: "Remediation packs", value: review.remediationPacks.length },
                { label: "Fix handoff entries", value: review.fixHandoff?.entries.length ?? 0 },
              ]}
            />
            {findings.length > 0 ? (
              <div className="portal-record-grid">
                {findings.map(finding => (
                  <article className="portal-record-card" data-testid={`workspace-code-finding-${finding.id}`} key={finding.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{finding.title}</strong>
                        <p>{finding.message}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={finding.severity === "high" ? "tag tag--danger" : finding.severity === "medium" ? "tag tag--warning" : "tag tag--success"}>
                          {finding.severity}
                        </span>
                        <span className="tag tag--neutral">{finding.paths.length} path{finding.paths.length === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                    {finding.id === review.activeFindingId ? <p className="subtle-note">Focused finding</p> : null}
                    <div className="portal-record-card__actions">
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
                  </article>
                ))}
              </div>
            ) : null}
            {findings.length === 0 ? <p className="subtle-note">No findings are mapped to this source yet.</p> : null}
            {unattributedFindings.length > 0 ? (
              <>
                <p><strong>Unattributed findings:</strong> {unattributedFindings.length}</p>
                <div className="portal-record-grid">
                  {unattributedFindings.map(finding => (
                    <article className="portal-record-card" data-testid={`workspace-code-unattributed-finding-${finding.id}`} key={finding.id}>
                      <div className="portal-record-card__header">
                        <div className="portal-record-card__title">
                          <strong>{finding.title}</strong>
                          <p>{finding.message}</p>
                        </div>
                        <div className="portal-record-card__meta">
                          <span className={finding.severity === "high" ? "tag tag--danger" : finding.severity === "medium" ? "tag tag--warning" : "tag tag--success"}>
                            {finding.severity}
                          </span>
                          <span className="tag tag--neutral">source attribution pending</span>
                        </div>
                      </div>
                      {finding.id === review.activeFindingId ? <p className="subtle-note">Focused finding</p> : null}
                      <div className="portal-record-card__actions">
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
                    </article>
                  ))}
                </div>
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
          <PortalNoticePanel
            actions={(
              <>
                {error.status === 409 ? (
                  <Link className="button-secondary" href={retryHref as Route}>Retry code review</Link>
                ) : null}
                <Link className={error.status === 409 ? "button-ghost" : "button-secondary"} href={`/portal/workspaces/${workspaceId}` as Route}>
                  Back to workspace
                </Link>
              </>
            )}
            badgeClassName={error.status === 409 ? "tag tag--info" : error.status === 400 || error.status === 404 ? "tag tag--warning" : "tag tag--warning"}
            badgeLabel={error.status === 409 ? "Warming" : error.status === 400 || error.status === 404 ? "Unavailable" : "Restricted"}
            description={
              error.status === 409
                ? error.message
                : error.status === 400
                ? error.message
                : error.status === 404
                  ? "The requested target is unavailable."
                  : "You do not have access to this code review surface."
            }
            descriptionTestId="workspace-code-access-denied"
            title={
              error.status === 409
                ? "Refresh code review"
                : error.status === 400
                  ? "Cannot open target"
                  : error.status === 404
                    ? "Target not found"
                    : "Access denied"
            }
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
