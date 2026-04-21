import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
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
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  formatSourceType,
  getEntitlementTagClass,
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
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/sources`);

  try {
    const query = await searchParams;
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
        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-sources-create-panel">
            <span className={getEntitlementTagClass(workspaceConsole.workspace.entitlement)}>{workspaceConsole.workspace.entitlement}</span>
            <h2>Add a source</h2>
            <p>Use the dedicated source area instead of mixing source intake into queueing or billing surfaces.</p>
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
            <span className="tag tag--info">Guide</span>
            <h2>Use the right source type</h2>
            <p>Choose `public git` for repository URLs, `git repo archive upload` for uploaded archives that retain `.git` metadata, and `private GitHub` only after linking the workspace installation in settings.</p>
            <Link className="button-ghost" data-testid="workspace-sources-open-settings" href={`/portal/workspaces/${workspaceId}/settings` as Route}>Open workspace settings</Link>
          </article>
        </section>

        <section className="portal-panel" data-testid="workspace-sources-list">
          <div className="auth-status">
            <div>
              <span className="tag tag--neutral">Inventory</span>
              <h2>Workspace sources</h2>
            </div>
          </div>
          <form className="stack-form" method="GET">
            <label className="field">
              <span>Search sources</span>
              <input
                data-testid="workspace-sources-search-input"
                defaultValue={sourceQuery.q}
                name="q"
                placeholder="Filter by name, location, or readiness"
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
            <button className="button-ghost" data-testid="workspace-sources-search-submit" type="submit">Apply source filter</button>
          </form>
          {sources.length === 0 ? <p className="subtle-note">No sources matched this filter yet.</p> : null}
          {sources.map(source => (
            <div className="list-row" data-testid={`workspace-sources-row-${source.id}`} key={source.id}>
              <div>
                <strong>{source.displayName}</strong>
                <p>{formatSourceType(source.type)} · {source.visibility} · {source.verificationStatus}</p>
                <p>{source.location}</p>
                {source.verificationError ? <p className="inline-error">{source.verificationError}</p> : null}
                {canManageWorkspace ? <SourceVerificationAction workspaceId={workspaceId} source={source} /> : null}
                {(sourceLearnablesById.get(source.id)?.length ?? 0) > 0 ? (
                  <p className="subtle-note">
                    Learnables: {sourceLearnablesById.get(source.id)?.slice(0, 3).map(learnable => learnable.statement).join(" · ")}
                  </p>
                ) : null}
              </div>
              {canManageWorkspace ? (
                <div className="list-row__actions">
                  <ManageSourceActions workspaceId={workspaceId} source={source} />
                </div>
              ) : null}
            </div>
          ))}
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
          <p className="inline-error" data-testid="workspace-sources-access-denied">You do not have access to this workspace.</p>
          <Link className="button-secondary" href={"/portal/workspaces" as Route}>Back to workspaces</Link>
        </PortalShell>
      );
    }
    throw error;
  }
}
