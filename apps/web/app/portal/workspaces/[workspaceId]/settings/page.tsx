import { PortalShell } from "@speclens/ui";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import {
  BillingPortalButton,
  CheckoutButton,
  GithubInstallationUnlinkButton,
  GithubInstallButton,
} from "../../../../../components/portal-actions";
import {
  ApiResponseError,
  getCurrentUser,
  getGithubRepositoriesPage,
  getWorkspaceConsole,
} from "../../../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  isWorkspaceScopedGithubRepositoriesPage,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../lib/portal";

function renderWorkspaceBanner(githubState: string | null) {
  if (githubState === "connected") {
    return <p className="banner banner--success" data-testid="workspace-settings-github-connected">GitHub App installation linked to this workspace.</p>;
  }
  if (githubState === "updated") {
    return <p className="banner banner--success" data-testid="workspace-settings-github-updated">GitHub App installation updated for this workspace.</p>;
  }
  if (githubState === "unlinked") {
    return <p className="banner banner--success" data-testid="workspace-settings-github-unlinked">GitHub App installation unlinked from this workspace.</p>;
  }
  if (githubState === "link-failed") {
    return (
      <p className="banner banner--error" data-testid="workspace-settings-github-link-failed">
        GitHub linked back to the portal, but the installation could not be attached to this workspace.
      </p>
    );
  }
  return null;
}

function renderBillingBanner(billingState: string | null) {
  if (billingState === "managed") {
    return <p className="banner banner--success" data-testid="workspace-settings-billing-managed">Billing management opened for this workspace.</p>;
  }
  return null;
}

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/settings`);

  try {
    const query = await searchParams;
    const repositoryQuery = {
      installationId: typeof query.installationId === "string" ? query.installationId : "",
      q: typeof query.q === "string" ? query.q : "",
      page: typeof query.page === "string" ? Number.parseInt(query.page, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, { items: githubRepositories, pageInfo }, currentUser] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getGithubRepositoriesPage(workspaceId, {
        page: repositoryQuery.page,
        pageSize: repositoryQuery.pageSize,
        ...(repositoryQuery.installationId ? { installationId: repositoryQuery.installationId } : {}),
        ...(repositoryQuery.q ? { q: repositoryQuery.q } : {}),
      }),
      getCurrentUser(),
    ]);
    const canManageWorkspace = currentUser.id === workspaceConsole.workspace.ownerUserId;
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)
      || !isWorkspaceScopedGithubRepositoriesPage(workspaceConsole.installations, githubRepositories)) {
      throw new ApiResponseError(404, `Workspace settings payload does not belong to workspace ${workspaceId}.`);
    }
    const repositoriesByInstallation = workspaceConsole.installations.map(installation => ({
      installation,
      repositories: githubRepositories.filter(repository => repository.githubInstallationId === installation.githubInstallationId),
    }));

    return (
      <PortalShell
        eyebrow="Workspace settings"
        title={workspaceConsole.workspace.name}
        lede="Workspace entitlement, billing entrypoints, and GitHub installation state are owned by the workspace and live here."
        pageTestId="workspace-settings-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="settings"
      >
        {renderWorkspaceBanner(typeof query.github === "string" ? query.github : null)}
        {renderBillingBanner(typeof query.billing === "string" ? query.billing : null)}
        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-settings-entitlement-panel">
            <span className="tag tag--warning">Billing</span>
            <h2>Entitlement and billing</h2>
            <p data-testid="workspace-settings-entitlement"><strong>Current entitlement:</strong> {workspaceConsole.workspace.entitlement}</p>
            {canManageWorkspace ? (
              <div className="stack-form">
                <CheckoutButton
                  workspaceId={workspaceId}
                  label="Upgrade workspace owner to Pro"
                  testId="workspace-settings-checkout-button"
                />
                <BillingPortalButton workspaceId={workspaceId} />
              </div>
            ) : (
              <p className="subtle-note" data-testid="workspace-settings-billing-read-only">
                Only the workspace owner can change billing. Members can review entitlement state here.
              </p>
            )}
          </article>
          <article className="portal-panel" data-testid="workspace-settings-github-panel">
            <span className="tag tag--info">GitHub</span>
            <h2>GitHub App link</h2>
            <p>Request the real install URL from SpecLens and attach or update the workspace installation from here.</p>
            {canManageWorkspace ? (
              <GithubInstallButton
                workspaceId={workspaceId}
                label={workspaceConsole.installations.length > 0 ? "Reconnect GitHub App" : "Connect GitHub App"}
                testId="workspace-settings-github-install-button"
              />
            ) : (
              <p className="subtle-note" data-testid="workspace-settings-github-read-only">
                Only the workspace owner can link or unlink GitHub installations for this workspace.
              </p>
            )}
          </article>
          <article className="portal-panel" data-testid="workspace-settings-guide-panel">
            <span className="tag tag--neutral">Guide</span>
            <h2>Private repo readiness</h2>
            <p>After the installation is linked, the installation and repository lists below confirm what private repositories the workspace can add as sources.</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-settings-installations">
            <span className="tag tag--warning">Installations</span>
            <h2>GitHub installations</h2>
            {workspaceConsole.installations.length === 0 ? <p className="subtle-note">No installations registered yet.</p> : null}
            {workspaceConsole.installations.map(installation => (
              <div className="list-row" data-testid={`workspace-settings-installation-${installation.id}`} key={installation.id}>
                <div>
                  <strong>{installation.githubAccountLogin}</strong>
                  <p>Installation {installation.githubInstallationId}</p>
                </div>
                {canManageWorkspace ? (
                  <div className="list-row__actions">
                    <GithubInstallationUnlinkButton
                      workspaceId={workspaceId}
                      installationId={installation.id}
                      accountLogin={installation.githubAccountLogin}
                      testId={`workspace-settings-github-unlink-${installation.id}`}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </article>
          <article className="portal-panel xl:col-span-2" data-testid="workspace-settings-github-repositories">
            <span className="tag tag--success">Repositories</span>
            <h2>Available GitHub repositories</h2>
            <form className="stack-form" method="GET">
              <label className="field">
                <span>Search repositories</span>
                <input
                  data-testid="workspace-settings-github-search-input"
                  defaultValue={repositoryQuery.q}
                  name="q"
                  placeholder="Filter by repository name, account, or clone URL"
                />
              </label>
              <label className="field">
                <span>Installation</span>
                <select
                  data-testid="workspace-settings-github-installation-filter"
                  defaultValue={repositoryQuery.installationId}
                  name="installationId"
                >
                  <option value="">All linked installations</option>
                  {workspaceConsole.installations.map(installation => (
                    <option key={installation.id} value={installation.githubInstallationId}>
                      {installation.githubAccountLogin}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button-ghost" data-testid="workspace-settings-github-search-submit" type="submit">Apply repository filter</button>
            </form>
            {githubRepositories.length === 0 ? <p className="subtle-note">No installation repositories available yet.</p> : null}
            {repositoriesByInstallation.map(({ installation, repositories }) => (
              <div className="stack-form" key={installation.id}>
                <div>
                  <strong>{installation.githubAccountLogin}</strong>
                  <p className="subtle-note">Installation {installation.githubInstallationId} · {repositories.length} repositories</p>
                </div>
                {repositories.length === 0 ? <p className="subtle-note">No repositories visible for this installation yet.</p> : null}
                {repositories.map(repository => (
                  <div
                    className="list-row"
                    data-testid={`workspace-settings-repository-${installation.githubInstallationId}-${repository.id}`}
                    key={`${installation.githubInstallationId}:${repository.id}`}
                  >
                    <div>
                      <strong>{repository.fullName}</strong>
                      <p>{repository.private ? "private" : "public"} · default branch {repository.defaultBranch}</p>
                      <p>{repository.cloneUrl}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <PaginationLinks
              pathname={`/portal/workspaces/${workspaceId}/settings`}
              searchParams={query}
              pageInfo={pageInfo}
              testIdPrefix="workspace-settings-github"
            />
          </article>
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      return (
        <PortalShell
          eyebrow="Workspace settings"
          title="Access denied"
          pageTestId="workspace-settings-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <p className="inline-error" data-testid="workspace-settings-access-denied">You do not have access to this workspace.</p>
        </PortalShell>
      );
    }
    throw error;
  }
}
