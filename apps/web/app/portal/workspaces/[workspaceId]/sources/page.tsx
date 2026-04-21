import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import { CreateSourceForm, ManageSourceActions, SourceVerificationAction } from "../../../../../components/portal-actions";
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
    const verifiedSources = sources.filter(source => source.verificationStatus === "verified").length;
    const pendingSources = sources.filter(source => source.verificationStatus === "pending").length;
    const failedSources = sources.filter(source => source.verificationStatus === "failed").length;
    const totalLearnables = Array.from(sourceLearnablesById.values()).reduce((sum, learnables) => sum + learnables.length, 0);

    return (
      <PortalShell
        eyebrow="Workspace sources"
        title={workspaceConsole.workspace.name}
        lede="All source intake lives here: public Git repositories, Git-backed archive uploads, and GitHub-backed private repositories."
        pageTestId="workspace-sources-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="sources"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-sources-stat-total">
            <span className="portal-stat__label">Sources</span>
            <span className="portal-stat__value">{sources.length}</span>
            <p>Repository inputs currently matching this filter.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-sources-stat-verified">
            <span className="portal-stat__label">Ready</span>
            <span className="portal-stat__value">{verifiedSources}</span>
            <p>Sources already verified and ready for queueing.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-sources-stat-pending">
            <span className="portal-stat__label">Checks running</span>
            <span className="portal-stat__value">{pendingSources}</span>
            <p>{failedSources} source{failedSources === 1 ? "" : "s"} currently need repair.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-sources-stat-learnables">
            <span className="portal-stat__label">Learnables</span>
            <span className="portal-stat__value">{totalLearnables}</span>
            <p>Stored source-specific learnables available for future runs.</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-sources-create-panel">
            <PortalSectionHeader
              badgeLabel={workspaceConsole.workspace.entitlement}
              badgeClassName={getEntitlementTagClass(workspaceConsole.workspace.entitlement)}
              title="Add a source"
              description="Keep repository intake here so source scope stays explicit before runs, reports, and billing decisions."
            />
            <ul className="bullet-list">
              <li>Use `public git` for direct hosted Git repository URLs over `https`.</li>
              <li>Use `git repo archive upload` only for archives that retain `.git` metadata.</li>
              <li>Use `private GitHub` after the workspace installation is linked in settings.</li>
            </ul>
            {canManageWorkspace ? (
              <CreateSourceForm
                workspaceId={workspaceId}
                entitlement={workspaceConsole.workspace.entitlement}
                githubRepositories={githubRepositories}
                testIdPrefix="workspace-sources"
              />
            ) : (
              <p className="subtle-note" data-testid="workspace-sources-read-only">
                This account can inspect sources and learnables, but only the workspace owner can add, rename, verify, or delete sources.
              </p>
            )}
          </article>
          <article className="portal-panel" data-testid="workspace-sources-guide-panel">
            <PortalSectionHeader
              badgeLabel="Readiness"
              badgeClassName="tag tag--info"
              title="Use the right source type"
              description="Source verification is the first guardrail for the rest of the workspace workflow."
            />
            <PortalMetaList
              items={[
                { label: "Owner controls", value: canManageWorkspace ? "Enabled for this account" : "Workspace owner only" },
                { label: "Visible private repositories", value: githubRepositories.length },
                { label: "Attention needed", value: failedSources === 0 ? "No failed checks right now" : `${failedSources} source(s) need repair` },
              ]}
            />
            <PortalLinkGrid testId="workspace-sources-guide-grid">
              <PortalLinkCard
                description="Review entitlement, billing, and GitHub installation inventory before changing private-source scope."
                eyebrow="Owner controls"
                href={`/portal/workspaces/${workspaceId}/settings`}
                testId="workspace-sources-open-settings"
                title="Open workspace settings"
                tone="warning"
              />
              <PortalLinkCard
                description="Move into the run surface once the sources here are verified and ready for queueing."
                eyebrow="Execution"
                href={`/portal/workspaces/${workspaceId}/runs`}
                title="Open runs"
                tone="success"
              />
              <PortalLinkCard
                description="Return to the overview for a workspace-wide summary of source, run, report, and access state."
                eyebrow="Overview"
                href={`/portal/workspaces/${workspaceId}`}
                title="Open workspace overview"
              />
            </PortalLinkGrid>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-sources-list">
          <PortalSectionHeader
            badgeLabel="Inventory"
            title="Workspace sources"
            description="Review verification state, source location, and learnables before queueing analysis."
          />
          <form className="stack-form form-shell" method="GET">
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
                  <option value="git-public">public git</option>
                  <option value="github-private">private GitHub</option>
                  <option value="upload-archive">git repo archive</option>
                </select>
              </label>
            </div>
            <button className="button-ghost" data-testid="workspace-sources-search-submit" type="submit">Apply source filter</button>
          </form>
          {sources.length === 0 ? <p className="subtle-note">No sources matched this filter yet.</p> : null}
          {sources.length > 0 ? (
            <div className="portal-record-grid">
              {sources.map(source => {
                const learnables = sourceLearnablesById.get(source.id) ?? [];
                return (
                  <article className="portal-record-card" data-testid={`workspace-sources-row-${source.id}`} key={source.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{source.displayName}</strong>
                        <p>{source.location}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={getSourceVerificationTagClass(source.verificationStatus)}>{source.verificationStatus}</span>
                        <span className="tag tag--neutral">{formatSourceType(source.type)}</span>
                        <span className="tag tag--info">{source.visibility}</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Provider state", value: source.githubInstallationId ? "Linked GitHub installation" : "Direct source connection" },
                        { label: "Learnables", value: learnables.length },
                        {
                          label: "Verification notes",
                          value: source.verificationError ?? "No blocking verification errors recorded",
                        },
                      ]}
                    />
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
      return (
        <PortalShell
          eyebrow="Workspace sources"
          title="Access denied"
          pageTestId="workspace-sources-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <PortalNoticePanel
            actions={<Link className="button-secondary" href={"/portal/workspaces" as Route}>Back to workspaces</Link>}
            description="You do not have access to this workspace."
            descriptionTestId="workspace-sources-access-denied"
            title="This source workspace is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
