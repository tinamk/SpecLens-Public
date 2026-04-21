import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
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
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
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
  const query = await searchParams;
  const session = await requirePortalSession(buildPortalReturnTo(`/portal/workspaces/${workspaceId}/settings`, query));

  try {
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
    const privateRepositories = githubRepositories.filter(repository => repository.private).length;
    const repositoriesByInstallation = workspaceConsole.installations.map(installation => {
      const repositories = githubRepositories.filter(
        repository => repository.githubInstallationId === installation.githubInstallationId,
      );
      const privateRepositoryCountByInstallation = repositories.filter(repository => repository.private).length;
      return {
        installation,
        repositories,
        privateRepositoryCount: privateRepositoryCountByInstallation,
      };
    });

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
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-settings-stat-entitlement">
            <span className="portal-stat__label">Entitlement</span>
            <span className="portal-stat__value">{workspaceConsole.workspace.entitlement}</span>
            <p>Controls private repository access, billing entrypoints, and archive upload rights.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-installations">
            <span className="portal-stat__label">GitHub installs</span>
            <span className="portal-stat__value">{workspaceConsole.installations.length}</span>
            <p>Linked installations attached to this workspace.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-repositories">
            <span className="portal-stat__label">Visible repos</span>
            <span className="portal-stat__value">{githubRepositories.length}</span>
            <p>{privateRepositories} private repos currently available for source intake.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-owner">
            <span className="portal-stat__label">Controls</span>
            <span className="portal-stat__value">{canManageWorkspace ? "Owner" : "Member"}</span>
            <p>Only the workspace owner can change billing or link GitHub installs.</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-settings-entitlement-panel">
            <PortalSectionHeader
              badgeLabel="Billing"
              badgeClassName="tag tag--warning"
              title="Entitlement and billing"
              description="Workspace-owned billing lives here so plan changes stay tied to the right repository scope."
            />
            <PortalMetaList
              items={[
                { label: "Current entitlement", value: <span data-testid="workspace-settings-entitlement">{workspaceConsole.workspace.entitlement}</span> },
                { label: "Billing authority", value: canManageWorkspace ? "This account can manage billing" : "Workspace owner only" },
              ]}
            />
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
            <PortalSectionHeader
              badgeLabel="GitHub"
              badgeClassName="tag tag--info"
              title="GitHub App link"
              description="Request the real install URL from SpecLens, then attach or refresh the workspace installation from this screen."
            />
            <PortalMetaList
              items={[
                { label: "Linked installations", value: workspaceConsole.installations.length },
                { label: "Visible repositories", value: githubRepositories.length },
              ]}
            />
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
            <PortalSectionHeader
              badgeLabel="Readiness"
              title="Private repo readiness"
              description="Use the installation and repository lists below to confirm what the workspace can actually add as private sources."
            />
            <PortalMetaList
              items={[
                { label: "Private repositories visible", value: privateRepositories },
                { label: "Grouped by install", value: "Repository inventory stays partitioned by linked installation" },
              ]}
            />
            <PortalLinkGrid>
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/sources`}
                title="Source intake"
                eyebrow="next step"
                description="Open the sources route to add a verified public, private, or archive-backed repository."
                tone="info"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/access`}
                title="Access controls"
                eyebrow="collaboration"
                description="Review who can see the private repositories and reports attached to this workspace."
              />
              <PortalLinkCard
                href="/portal/settings"
                title="Portal settings"
                eyebrow="global context"
                description="Move back to account-level settings when you need portal-wide context."
                tone="warning"
              />
            </PortalLinkGrid>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-settings-installations">
            <PortalSectionHeader
              badgeLabel="Installations"
              badgeClassName="tag tag--warning"
              title="GitHub installations"
              description="Each linked installation remains workspace-owned and can be detached here."
            />
            {workspaceConsole.installations.length === 0 ? <p className="subtle-note">No installations registered yet.</p> : null}
            {workspaceConsole.installations.length > 0 ? (
              <div className="portal-record-grid">
                {repositoriesByInstallation.map(({ installation, repositories, privateRepositoryCount }) => (
                  <article className="portal-record-card" data-testid={`workspace-settings-installation-${installation.id}`} key={installation.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{installation.githubAccountLogin}</strong>
                        <p>Workspace-owned GitHub App installation ready for private source intake.</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className="tag tag--success">linked</span>
                        <span className="tag tag--neutral">{repositories.length} repos</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Installation id", value: installation.githubInstallationId },
                        { label: "Visible repos", value: repositories.length },
                        { label: "Private repos", value: privateRepositoryCount },
                      ]}
                    />
                    {canManageWorkspace ? (
                      <div className="portal-record-card__actions">
                        <GithubInstallationUnlinkButton
                          workspaceId={workspaceId}
                          installationId={installation.id}
                          accountLogin={installation.githubAccountLogin}
                          testId={`workspace-settings-github-unlink-${installation.id}`}
                        />
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </article>
          <article className="portal-panel xl:col-span-2" data-testid="workspace-settings-github-repositories">
            <PortalSectionHeader
              badgeLabel="Repositories"
              badgeClassName="tag tag--success"
              title="Available GitHub repositories"
              description="Filter repository visibility by linked installation before adding a private source."
            />
            <form className="stack-form form-shell" method="GET">
              <div className="form-grid">
                <label className="field">
                  <span>Search repositories</span>
                  <input
                    autoComplete="off"
                    data-testid="workspace-settings-github-search-input"
                    defaultValue={repositoryQuery.q}
                    name="q"
                    placeholder="Filter by repository name, account, or clone URL…"
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
              </div>
              <button className="button-ghost" data-testid="workspace-settings-github-search-submit" type="submit">Apply repository filter</button>
            </form>
            {githubRepositories.length === 0 ? <p className="subtle-note">No installation repositories available yet.</p> : null}
            {repositoriesByInstallation.map(({ installation, repositories, privateRepositoryCount }) => (
              <div className="portal-record-stack" key={installation.id}>
                <div className="portal-record-card">
                  <div className="portal-record-card__header">
                    <div className="portal-record-card__title">
                      <strong>{installation.githubAccountLogin}</strong>
                      <p>Repository inventory available through installation {installation.githubInstallationId}.</p>
                    </div>
                    <div className="portal-record-card__meta">
                      <span className="tag tag--neutral">{repositories.length} visible</span>
                      <span className="tag tag--warning">{privateRepositoryCount} private</span>
                    </div>
                  </div>
                </div>
                {repositories.length === 0 ? <p className="subtle-note">No repositories visible for this installation yet.</p> : null}
                {repositories.length > 0 ? (
                  <div className="portal-record-grid">
                    {repositories.map(repository => (
                      <article
                        className="portal-record-card"
                        data-testid={`workspace-settings-repository-${installation.githubInstallationId}-${repository.id}`}
                        key={`${installation.githubInstallationId}:${repository.id}`}
                      >
                        <div className="portal-record-card__header">
                          <div className="portal-record-card__title">
                            <strong>{repository.fullName}</strong>
                            <p>{repository.cloneUrl}</p>
                          </div>
                          <div className="portal-record-card__meta">
                            <span className={repository.private ? "tag tag--warning" : "tag tag--neutral"}>{repository.private ? "private" : "public"}</span>
                            <span className="tag tag--info">default {repository.defaultBranch}</span>
                          </div>
                        </div>
                        <div className="portal-record-card__body">
                          <p>
                            {repository.private
                              ? "Available for private-source intake through this linked workspace installation."
                              : "Public repository visible through the linked GitHub App installation."}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
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
          <PortalNoticePanel
            actions={<Link className="button-secondary" href="/portal/workspaces">Back to workspaces</Link>}
            description="You do not have access to this workspace."
            descriptionTestId="workspace-settings-access-denied"
            title="This settings surface is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
