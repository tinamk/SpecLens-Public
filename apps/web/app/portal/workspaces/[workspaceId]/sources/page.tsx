import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { DataPath } from "../../../../../components/data-visuals";
import { buildSearchHref, PaginationLinks } from "@speclens/ui";
import { CreateSourceForm, ManageSourceActions, SourceVerificationAction } from "../../../../../components/portal-actions";
import { WorkspaceRouteState } from "../../../../../components/workspace-route-state";
import {
  ApiResponseError,
  getCurrentUser,
  getGithubRepositoriesPage,
  getSourceLearnables,
  getWorkspaceConsole,
  getWorkspaceSourcesPage,
} from "../../../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatSourceType,
  getEntitlementTagClass,
  getSourceVerificationTagClass,
  getWorkspaceSourcesEmptyState,
  isWorkspaceScopedSourcesPageContext,
} from "../../../../../lib/portal";

export default async function WorkspaceSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const session = await requirePortalSession(buildPortalReturnTo(`/portal/workspaces/${workspaceId}/sources`, query));

  try {
    const sourceQuery = {
      q: typeof query.q === "string" ? query.q : "",
      type: typeof query.type === "string" ? query.type : "",
      page: typeof query.page === "string" ? Number.parseInt(query.page, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, { items: sources, pageInfo }, { items: githubRepositories }, currentUser] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getWorkspaceSourcesPage(workspaceId, {
        page: sourceQuery.page,
        pageSize: sourceQuery.pageSize,
        ...(sourceQuery.q ? { q: sourceQuery.q } : {}),
        ...(sourceQuery.type ? { type: sourceQuery.type } : {}),
      }),
      getGithubRepositoriesPage(workspaceId, {
        page: 1,
        pageSize: 100,
      }),
      getCurrentUser(),
    ]);
    const canManageWorkspace = currentUser.id === workspaceConsole.workspace.ownerUserId;
    if (!isWorkspaceScopedSourcesPageContext(workspaceId, workspaceConsole, sources, githubRepositories)) {
      throw new ApiResponseError(404, `Workspace sources payload does not belong to workspace ${workspaceId}.`);
    }
    const sourceLearnableEntries = await Promise.all(
      sources.map(async source => [source.id, await getSourceLearnables(workspaceId, source.id)] as const),
    );
    const sourceLearnablesById = new Map(sourceLearnableEntries);
    const verifiedSources = workspaceConsole.sources.filter(source => source.verificationStatus === "verified").length;
    const pendingSources = workspaceConsole.sources.filter(source => source.verificationStatus === "pending").length;
    const failedSources = workspaceConsole.sources.filter(source => source.verificationStatus === "failed").length;
    const totalLearnables = Array.from(sourceLearnablesById.values()).reduce((sum, learnables) => sum + learnables.length, 0);
    const sourcesEmptyState = getWorkspaceSourcesEmptyState({
      query: sourceQuery.q,
      type: sourceQuery.type,
    });

    return (
      <PortalShell
        eyebrow="Sources"
        title={workspaceConsole.workspace.name}
        pageTestId="workspace-sources-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="sources"
      >
        <section className="portal-stat-grid" aria-label="Workspace sources summary">
          <article className="portal-stat" data-testid="workspace-sources-stat-total">
            <span className="portal-stat__label">Sources</span>
            <span className="portal-stat__value">{workspaceConsole.sources.length}</span>
            {sources.length !== workspaceConsole.sources.length ? <p>{sources.length} visible</p> : null}
          </article>
          <article className="portal-stat" data-testid="workspace-sources-stat-verified">
            <span className="portal-stat__label">Verified</span>
            <span className="portal-stat__value">{verifiedSources}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-sources-stat-pending">
            <span className="portal-stat__label">Pending</span>
            <span className="portal-stat__value">{pendingSources}</span>
            {failedSources > 0 ? <p>{failedSources} need repair</p> : null}
          </article>
          <article className="portal-stat" data-testid="workspace-sources-stat-learnables">
            <span className="portal-stat__label">Learnables</span>
            <span className="portal-stat__value">{totalLearnables}</span>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-sources-create-panel">
            <PortalSectionHeader
              badgeLabel={workspaceConsole.workspace.entitlement}
              badgeClassName={getEntitlementTagClass(workspaceConsole.workspace.entitlement)}
              title="Add a source"
            />
            {canManageWorkspace ? (
              <CreateSourceForm
                workspaceId={workspaceId}
                entitlement={workspaceConsole.workspace.entitlement}
                githubRepositories={githubRepositories}
                testIdPrefix="workspace-sources"
              />
            ) : (
              <p className="subtle-note" data-testid="workspace-sources-read-only">
                Workspace owners manage sources. Ask the owner to add or repair a source before queueing new runs.
              </p>
            )}
          </article>
          <article className="portal-panel" data-testid="workspace-sources-guide-panel">
            <PortalSectionHeader
              badgeLabel="Readiness"
              badgeClassName="tag tag--info"
              title="Status"
              description={verifiedSources > 0
                ? "Verified sources are ready for AI runs. Failed sources should be repaired before they become queueable again."
                : "At least one verified source is required before the run queue can start work."}
            />
            {workspaceConsole.sources.length === 0 ? (
              <p className="subtle-note">Start by adding a source. Public Git repositories, private GitHub sources, and uploaded Git archives all run through the same verification gate.</p>
            ) : null}
            {workspaceConsole.sources.length > 0 && verifiedSources === 0 ? (
              <p className="inline-error" role="alert">No verified sources are queueable yet. Use the repair or readiness check action on a source below.</p>
            ) : null}
            {failedSources > 0 ? (
              <PortalMetaList
                items={[
                  { label: "Attention needed", value: `${failedSources} source(s) need repair` },
                ]}
              />
            ) : null}
            <PortalLinkGrid testId="workspace-sources-guide-grid">
              <PortalLinkCard
                eyebrow="Owner"
                href={`/portal/workspaces/${workspaceId}/settings`}
                testId="workspace-sources-open-settings"
                title="Workspace settings"
                tone="warning"
              />
              <PortalLinkCard
                eyebrow="Execution"
                href={`/portal/workspaces/${workspaceId}/runs`}
                title="Runs"
                tone="success"
              />
              <PortalLinkCard
                eyebrow="Overview"
                href={`/portal/workspaces/${workspaceId}`}
                title="Workspace"
              />
            </PortalLinkGrid>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-sources-list">
          <PortalSectionHeader
            badgeLabel="Inventory"
            title="Sources"
          />
          <form aria-label="Search sources" className="stack-form form-shell" method="GET" role="search">
            <div className="form-grid">
              <label className="field">
                <span>Search sources</span>
                <input
                  autoComplete="off"
                  data-testid="workspace-sources-search-input"
                  defaultValue={sourceQuery.q}
                  name="q"
                  placeholder="Filter by name, location, or readiness…"
                />
              </label>
              <label className="field">
                <span>Source type</span>
                <select data-testid="workspace-sources-type-filter" defaultValue={sourceQuery.type} name="type">
                  <option value="">All types</option>
                  <option value="git-public">public Git repository</option>
                  <option value="github-private">private GitHub</option>
                  <option value="upload-archive">Git archive upload</option>
                </select>
              </label>
            </div>
            <div className="portal-inline-actions">
              <button className="button-ghost" data-testid="workspace-sources-search-submit" type="submit">Apply source filter</button>
              {sourceQuery.q || sourceQuery.type ? (
                <Link
                  className="button-secondary"
                  data-testid="workspace-sources-clear-filters"
                  href={buildSearchHref(`/portal/workspaces/${workspaceId}/sources`, query, {
                    page: undefined,
                    q: undefined,
                    type: undefined,
                  })}
                >
                  Clear filters
                </Link>
              ) : null}
            </div>
          </form>
          {sources.length === 0 ? (
            <div className="subtle-note" data-testid="workspace-sources-empty-state">
              <p><strong>{sourcesEmptyState.title}</strong></p>
              <p>{sourcesEmptyState.detail}</p>
            </div>
          ) : null}
          {sources.length > 0 ? (
            <div className="portal-record-grid">
              {sources.map(source => {
                const learnables = sourceLearnablesById.get(source.id) ?? [];
                return (
                  <article className="portal-record-card" data-testid={`workspace-sources-row-${source.id}`} key={source.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <h3>{source.displayName}</h3>
                        <p><DataPath value={source.location} /></p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getSourceVerificationTagClass(source.verificationStatus)}>{source.verificationStatus}</span>
                        <span className="tag tag--neutral">{formatSourceType(source.type)}</span>
                        <span className="tag tag--info">{source.visibility}</span>
                      </div>
                    </div>
                    {source.verificationError ? (
                      <PortalMetaList
                        items={[
                          { label: "Verification error", value: source.verificationError },
                        ]}
                      />
                    ) : null}
                    {canManageWorkspace ? <SourceVerificationAction workspaceId={workspaceId} source={source} /> : null}
                    {learnables.length > 0 ? (
                      <p className="subtle-note">
                        Learnables: {learnables.slice(0, 3).map(learnable => learnable.statement).join(" · ")}
                      </p>
                    ) : null}
                    {canManageWorkspace ? (
                      <div className="portal-record-card__actions">
                        <ManageSourceActions workspaceId={workspaceId} source={source} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
          <PaginationLinks
            pathname={`/portal/workspaces/${workspaceId}/sources`}
            searchParams={query}
            pageInfo={pageInfo}
            testIdPrefix="workspace-sources"
          />
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      const isMissing = error.status === 404;
      return (
        <WorkspaceRouteState
          eyebrow="Workspace sources"
          isAdmin={isPortalAdminSession(session)}
          isMissing={isMissing}
          pageTestId="workspace-sources-access-denied-page"
          descriptionTestId="workspace-sources-access-denied"
        />
      );
    }
    throw error;
  }
}
