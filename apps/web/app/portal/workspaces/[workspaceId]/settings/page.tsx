import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { CodexAuthCard } from "../../../../../components/codex-auth-card";
import { DataPath, DataValue } from "../../../../../components/data-visuals";
import { buildSearchHref, PaginationLinks } from "@speclens/ui";
import {
  BillingPortalButton,
  CheckoutButton,
  CreateWorkspaceSecretForm,
  DeleteWorkspaceSecretButton,
  GithubInstallationUnlinkButton,
  GithubInstallButton,
  UpdateWorkspaceSecretForm,
} from "../../../../../components/portal-actions";
import { WorkspaceRouteState } from "../../../../../components/workspace-route-state";
import {
  ApiResponseError,
  getCurrentUser,
  getGithubRepositoriesPage,
  getWorkspaceCodexAuthStatus,
  getWorkspaceConsole,
  getWorkspaceSecretsPage,
} from "../../../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  isWorkspaceScopedEntityPage,
  isWorkspaceScopedGithubRepositoriesPage,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../lib/portal";

function renderWorkspaceBanner(workspaceId: string, githubState: string | null) {
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
      <div className="banner banner--error" data-testid="workspace-settings-github-link-failed" role="alert">
        <p>GitHub linked back to the portal, but the installation could not be attached to this workspace.</p>
        <Link className="button-ghost" href={`/portal/workspaces/${workspaceId}/settings#github-app-link`}>
          Retry GitHub install
        </Link>
      </div>
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
    const secretQuery = {
      q: typeof query.secretQ === "string" ? query.secretQ : "",
      page: typeof query.secretPage === "string" ? Number.parseInt(query.secretPage, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, { items: githubRepositories, pageInfo }, { items: secrets, pageInfo: secretsPageInfo }, currentUser] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getGithubRepositoriesPage(workspaceId, {
        page: repositoryQuery.page,
        pageSize: repositoryQuery.pageSize,
        ...(repositoryQuery.installationId ? { installationId: repositoryQuery.installationId } : {}),
        ...(repositoryQuery.q ? { q: repositoryQuery.q } : {}),
      }),
      getWorkspaceSecretsPage(workspaceId, {
        page: secretQuery.page,
        pageSize: secretQuery.pageSize,
        ...(secretQuery.q ? { q: secretQuery.q } : {}),
      }),
      getCurrentUser(),
    ]);
    const canManageWorkspace = currentUser.id === workspaceConsole.workspace.ownerUserId;
    const workspaceCodexAuth = canManageWorkspace
      ? await getWorkspaceCodexAuthStatus(workspaceId)
      : null;
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)
      || !isWorkspaceScopedGithubRepositoriesPage(workspaceConsole.installations, githubRepositories)
      || !isWorkspaceScopedEntityPage(workspaceId, secrets)) {
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
        pageTestId="workspace-settings-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="settings"
      >
        {renderWorkspaceBanner(workspaceId, typeof query.github === "string" ? query.github : null)}
        {renderBillingBanner(typeof query.billing === "string" ? query.billing : null)}
        <section className="portal-stat-grid" aria-label="Workspace settings summary">
          <article className="portal-stat" data-testid="workspace-settings-stat-entitlement">
            <span className="portal-stat__label">Entitlement</span>
            <span className="portal-stat__value">{workspaceConsole.workspace.entitlement}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-installations">
            <span className="portal-stat__label">GitHub installs</span>
            <span className="portal-stat__value">{workspaceConsole.installations.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-repositories">
            <span className="portal-stat__label">Visible repos</span>
            <span className="portal-stat__value">{githubRepositories.length}</span>
            <p>{privateRepositories} private</p>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-secrets">
            <span className="portal-stat__label">Run secrets</span>
            <span className="portal-stat__value">{secretsPageInfo.total}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-settings-stat-owner">
            <span className="portal-stat__label">Controls</span>
            <span className="portal-stat__value">{canManageWorkspace ? "Owner" : "Member"}</span>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-settings-entitlement-panel">
            <PortalSectionHeader
              badgeLabel="Billing"
              badgeClassName="tag tag--warning"
              title="Entitlement and billing"
            />
            <PortalMetaList
              items={[
                { label: "Current entitlement", value: <span data-testid="workspace-settings-entitlement">{workspaceConsole.workspace.entitlement}</span> },
              ]}
            />
            {canManageWorkspace ? (
              <div className="stack-form">
                <CheckoutButton
                  workspaceId={workspaceId}
                  label="Upgrade workspace to Pro"
                  testId="workspace-settings-checkout-button"
                />
                <BillingPortalButton workspaceId={workspaceId} />
              </div>
            ) : (
              <p className="subtle-note" data-testid="workspace-settings-billing-read-only">
                Workspace billing is owner-managed. Ask the workspace owner to change entitlement or billing details.
              </p>
            )}
          </article>
          <article className="portal-panel" data-testid="workspace-settings-github-panel" id="github-app-link">
            <PortalSectionHeader
              badgeLabel="GitHub"
              badgeClassName="tag tag--info"
              title="GitHub App link"
            />
            {canManageWorkspace ? (
              <GithubInstallButton
                workspaceId={workspaceId}
                label={workspaceConsole.installations.length > 0 ? "Reconnect GitHub App" : "Connect GitHub App"}
                testId="workspace-settings-github-install-button"
              />
            ) : (
              <p className="subtle-note" data-testid="workspace-settings-github-read-only">
                GitHub installation links are owner-managed. Ask the workspace owner to connect or rotate the app link.
              </p>
            )}
          </article>
          <article className="portal-panel" data-testid="workspace-settings-guide-panel">
            <PortalSectionHeader
              badgeLabel="Jump to"
              title="Related"
            />
            <PortalLinkGrid>
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/sources`}
                title="Sources"
                eyebrow="intake"
                tone="info"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/access`}
                title="Access"
                eyebrow="members"
              />
              <PortalLinkCard
                href="/portal/settings"
                title="Portal settings"
                eyebrow="global"
                tone="warning"
              />
            </PortalLinkGrid>
          </article>
        </section>

        <section className="portal-grid">
          <div className="xl:col-span-2">
            {workspaceCodexAuth ? (
              <CodexAuthCard
                title="Workspace Codex auth"
                description="Register a shared Codex session for this workspace. Members can choose it when queueing runs, but it remains isolated to this workspace."
                initialAuth={workspaceCodexAuth}
                devicePath={`/api/workspaces/${workspaceId}/ai/auth/device`}
                verifyPath={`/api/workspaces/${workspaceId}/ai/auth/verify`}
                logoutPath={`/api/workspaces/${workspaceId}/ai/auth/logout`}
                importLocalPath={`/api/workspaces/${workspaceId}/ai/auth/import-local`}
                testId="workspace-settings-codex-auth"
              />
            ) : (
              <PortalNoticePanel
                badgeLabel="Owner only"
                title="Workspace Codex auth"
                description="Only the workspace owner can register or replace the shared workspace-level Codex session."
                descriptionTestId="workspace-settings-codex-auth-read-only"
              />
            )}
          </div>
        </section>

        <section className="portal-grid">
          <article className="portal-panel xl:col-span-2" data-testid="workspace-settings-secrets-panel">
            <PortalSectionHeader
              badgeLabel="Secrets"
              badgeClassName="tag tag--warning"
              title="Workspace run secrets"
              description="Store reusable credentials for queued analysis runs. Values are masked after save and remain scoped to this workspace."
            />
            <form aria-label="Search workspace secrets" className="stack-form form-shell" method="GET" role="search">
              <div className="form-grid">
                <label className="field field--full">
                  <span>Search secrets</span>
                  <input
                    autoComplete="off"
                    data-testid="workspace-settings-secrets-search-input"
                    defaultValue={secretQuery.q}
                    name="secretQ"
                    placeholder="Filter by name, kind, or preview..."
                  />
                </label>
              </div>
              <div className="portal-inline-actions">
                <button className="button-ghost" data-testid="workspace-settings-secrets-search-submit" type="submit">Apply secret filter</button>
                {secretQuery.q ? (
                  <Link
                    className="button-secondary"
                    data-testid="workspace-settings-secrets-clear-filters"
                    href={buildSearchHref(`/portal/workspaces/${workspaceId}/settings`, query, {
                      secretPage: undefined,
                      secretQ: undefined,
                    })}
                  >
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </form>
            {canManageWorkspace ? (
              <CreateWorkspaceSecretForm workspaceId={workspaceId} testIdPrefix="workspace-settings-secrets" />
            ) : (
              <p className="subtle-note" data-testid="workspace-settings-secrets-read-only">
                Workspace secrets are owner-managed. Ask the workspace owner to add or rotate secrets for authenticated runs.
              </p>
            )}
            {secrets.length === 0 ? <p className="subtle-note">No workspace secrets stored yet.</p> : null}
            {secrets.length > 0 ? (
              <div className="portal-record-grid">
                {secrets.map(secret => (
                  <article className="portal-record-card" data-testid={`workspace-settings-secret-row-${secret.id}`} key={secret.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <h3>{secret.name}</h3>
                        <p>{secret.valuePreview}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className="tag tag--neutral">{secret.kind}</span>
                      </div>
                    </div>
                    {canManageWorkspace ? (
                      <div className="portal-record-card__actions">
                        <UpdateWorkspaceSecretForm
                          workspaceId={workspaceId}
                          secret={secret}
                          testIdPrefix="workspace-settings-secrets"
                        />
                        <DeleteWorkspaceSecretButton
                          workspaceId={workspaceId}
                          secretId={secret.id}
                          secretName={secret.name}
                          testId={`workspace-settings-secret-delete-${secret.id}`}
                        />
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
            <PaginationLinks
              pathname={`/portal/workspaces/${workspaceId}/settings`}
              searchParams={query}
              pageInfo={secretsPageInfo}
              pageParamKey="secretPage"
              testIdPrefix="workspace-settings-secrets"
            />
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-settings-installations">
            <PortalSectionHeader
              badgeLabel="Installations"
              badgeClassName="tag tag--warning"
              title="GitHub installations"
            />
            {workspaceConsole.installations.length === 0 ? <p className="subtle-note">No installations registered yet.</p> : null}
            {workspaceConsole.installations.length > 0 ? (
              <div className="portal-record-grid">
                {repositoriesByInstallation.map(({ installation, repositories }) => (
                  <article className="portal-record-card" data-testid={`workspace-settings-installation-${installation.id}`} key={installation.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <h3>{installation.githubAccountLogin}</h3>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className="tag tag--success">linked</span>
                        <span className="tag tag--neutral">{repositories.length} repos</span>
                      </div>
                    </div>
                    <PortalMetaList
                      items={[
                        { label: "Installation id", value: <DataValue value={installation.githubInstallationId} tone="id" /> },
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
            />
            <form aria-label="Search GitHub repositories" className="stack-form form-shell" method="GET" role="search">
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
              <div className="portal-inline-actions">
                <button className="button-ghost" data-testid="workspace-settings-github-search-submit" type="submit">Apply repository filter</button>
                {repositoryQuery.q || repositoryQuery.installationId ? (
                  <Link
                    className="button-secondary"
                    data-testid="workspace-settings-github-clear-filters"
                    href={buildSearchHref(`/portal/workspaces/${workspaceId}/settings`, query, {
                      installationId: undefined,
                      page: undefined,
                      q: undefined,
                    })}
                  >
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </form>
            {githubRepositories.length === 0 ? <p className="subtle-note">No installation repositories available yet.</p> : null}
            {repositoriesByInstallation.map(({ installation, repositories, privateRepositoryCount }) => (
              <div className="portal-record-stack" key={installation.id}>
                <div className="portal-record-card">
                  <div className="portal-record-card__header">
	                    <div className="portal-record-card__title">
	                      <strong>{installation.githubAccountLogin}</strong>
	                      <p>Installation <DataValue value={installation.githubInstallationId} tone="id" /></p>
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
	                            <p><DataPath value={repository.cloneUrl} /></p>
	                          </div>
                          <div className="portal-record-card__meta">
                            <span className={repository.private ? "tag tag--warning" : "tag tag--neutral"}>{repository.private ? "private" : "public"}</span>
                            <span className="tag tag--info">default {repository.defaultBranch}</span>
                          </div>
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
      const isMissing = error.status === 404;
      return (
        <WorkspaceRouteState
          eyebrow="Workspace settings"
          isAdmin={isPortalAdminSession(session)}
          isMissing={isMissing}
          pageTestId="workspace-settings-access-denied-page"
          descriptionTestId="workspace-settings-access-denied"
        />
      );
    }
    throw error;
  }
}
