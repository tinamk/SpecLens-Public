import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { CreateWorkspaceForm } from "../../../components/portal-actions";
import { buildSearchHref, PaginationLinks } from "@speclens/ui";
import { getPortalWorkspacesPage } from "../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../lib/auth";
import { buildPortalPrimaryNav, getEntitlementTagClass } from "../../../lib/portal";

function renderBanner(params: Record<string, string | string[] | undefined>) {
  const access = typeof params.access === "string" ? params.access : null;
  const admin = typeof params.admin === "string" ? params.admin : null;
  const auth = typeof params.auth === "string" ? params.auth : null;
  const billing = typeof params.billing === "string" ? params.billing : null;
  const github = typeof params.github === "string" ? params.github : null;

  if (access === "denied") {
    return <p className="banner banner--error" data-testid="workspace-index-access-denied">You do not have access to that workspace.</p>;
  }
  if (admin === "denied") {
    return <p className="banner banner--error" data-testid="workspace-index-admin-denied">Administrator access is required for that area.</p>;
  }
  if (auth === "callback-invalid") {
    return (
      <div className="banner banner--warning" data-testid="workspace-index-auth-callback-invalid" role="status">
        <p>Your sign-in callback expired or could not be verified. Start a new sign-in session before opening protected portal pages.</p>
        <Link className="button-ghost" href="/api/auth/login?returnTo=/portal/workspaces">Restart sign-in</Link>
      </div>
    );
  }
  if (auth === "auth-config-required") {
    return (
      <div className="banner banner--error" data-testid="workspace-index-auth-config-required" role="alert">
        <p>Hosted portal sign-in is not configured yet. Configure Keycloak or enable local-dev auth for trusted local environments, then retry sign-in.</p>
        <Link className="button-ghost" href="/api/auth/login?returnTo=/portal/workspaces">Retry sign-in</Link>
      </div>
    );
  }
  if (billing === "success") {
    return (
      <p className="banner banner--success" data-testid="workspace-index-billing-success">
        Billing completed. Refresh the workspace settings if the entitlement has not updated yet.
      </p>
    );
  }
  if (github === "missing-callback-data") {
    return (
      <div className="banner banner--error" data-testid="workspace-index-github-missing-callback-data" role="alert">
        <p>GitHub did not return the installation details needed to link the app. Restart the GitHub install flow from workspace settings.</p>
        <Link className="button-ghost" href="/portal/workspaces">Choose a workspace</Link>
      </div>
    );
  }
  if (github === "link-failed") {
    return (
      <div className="banner banner--error" data-testid="workspace-index-github-link-failed" role="alert">
        <p>SpecLens could not link that GitHub App installation. Open the intended workspace settings page, confirm you are the owner, then restart the GitHub install flow.</p>
        <Link className="button-ghost" href="/portal/workspaces">Choose a workspace</Link>
      </div>
    );
  }
  return null;
}

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await requirePortalSession(buildPortalReturnTo("/portal/workspaces", params));
  const workspaceQuery = {
    q: typeof params.q === "string" ? params.q : "",
    page: typeof params.page === "string" ? Number.parseInt(params.page, 10) || 1 : 1,
    pageSize: 25,
  };
  const { items: workspaces, pageInfo } = await getPortalWorkspacesPage({
    page: workspaceQuery.page,
    pageSize: workspaceQuery.pageSize,
    ...(workspaceQuery.q ? { q: workspaceQuery.q } : {}),
  });
  const totalSources = workspaces.reduce((sum, entry) => sum + entry.sources.length, 0);
  const totalMembers = workspaces.reduce((sum, entry) => sum + entry.members.length, 0);
  const paidWorkspaces = workspaces.filter(entry => entry.workspace.entitlement !== "free").length;
  const isAdmin = isPortalAdminSession(session);

  return (
    <PortalShell
      eyebrow="Workspaces"
      title="Workspace directory"
      lede="Create, open, and audit workspaces."
      pageTestId="workspace-index-page"
      primaryNav={buildPortalPrimaryNav(isAdmin)}
      activePrimaryNavKey="workspaces"
    >
      {renderBanner(params)}
      <section className="portal-stat-grid" aria-label="Workspace directory summary">
        <article className="portal-stat" data-testid="workspace-index-stat-workspaces">
          <span className="portal-stat__label">Workspaces</span>
          <span className="portal-stat__value">{workspaces.length}</span>
        </article>
        <article className="portal-stat" data-testid="workspace-index-stat-sources">
          <span className="portal-stat__label">Sources</span>
          <span className="portal-stat__value">{totalSources}</span>
        </article>
        <article className="portal-stat" data-testid="workspace-index-stat-members">
          <span className="portal-stat__label">Members</span>
          <span className="portal-stat__value">{totalMembers}</span>
        </article>
        <article className="portal-stat" data-testid="workspace-index-stat-paid">
          <span className="portal-stat__label">Paid plans</span>
          <span className="portal-stat__value">{paidWorkspaces}</span>
        </article>
      </section>

      <section className="portal-grid">
        <article className="portal-panel xl:col-span-2" data-testid="workspace-index-create-panel">
          <PortalSectionHeader title="Create a workspace" />
          <CreateWorkspaceForm />
        </article>
        <article className="portal-panel portal-panel--accent" data-testid="workspace-index-account-panel">
          <PortalSectionHeader title="Account" />
          <PortalMetaList
            items={[
              { label: "Admin", value: isAdmin ? "Enabled" : "Not granted" },
            ]}
          />
          <PortalLinkGrid testId="workspace-index-account-grid">
            <PortalLinkCard
              eyebrow="Account"
              href="/portal/settings"
              testId="workspace-index-open-settings"
              title="Account settings"
              tone="success"
            />
            <PortalLinkCard
              eyebrow="Plans"
              href="/pricing"
              title="Pricing"
              tone="warning"
            />
            {isAdmin ? (
              <PortalLinkCard
                eyebrow="Admin"
                href="/portal/admin/ai/auth"
                testId="workspace-index-open-admin"
                title="Admin"
                tone="info"
              />
            ) : null}
          </PortalLinkGrid>
        </article>
      </section>

      <section className="portal-panel portal-directory-shell" data-testid="workspace-index-list">
        <div className="portal-directory-toolbar">
          <PortalSectionHeader title="Your workspaces" />
          <form aria-label="Search workspaces" className="portal-search-form" method="GET" role="search">
            <label className="field">
              <span>Search</span>
              <input
                autoComplete="off"
                data-testid="workspace-index-search-input"
                defaultValue={workspaceQuery.q}
                name="q"
                placeholder="Filter by name, member, or source…"
              />
            </label>
            <button className="button-ghost" data-testid="workspace-index-search-submit" type="submit">Filter</button>
            {workspaceQuery.q ? (
              <Link
                className="button-secondary"
                data-testid="workspace-index-clear-filters"
                href={buildSearchHref("/portal/workspaces", params, {
                  page: undefined,
                  q: undefined,
                })}
              >
                Clear filters
              </Link>
            ) : null}
          </form>
        </div>
        {workspaces.length === 0 ? (
          <p className="subtle-note">
            {workspaceQuery.q
              ? `No workspaces match "${workspaceQuery.q}". Clear or change the search to see other workspaces.`
              : "No workspaces yet. Create one to get started."}
          </p>
        ) : null}
        {workspaces.length > 0 ? (
          <div className="portal-record-grid">
            {workspaces.map(({ workspace, sources, members }) => (
              <article className="portal-record-card" data-testid={`workspace-index-row-${workspace.id}`} key={workspace.id}>
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <h3>{workspace.name}</h3>
                    <p>{workspace.description ?? "No description yet."}</p>
                  </div>
                  <div className="portal-record-card__meta">
                    <span className={getEntitlementTagClass(workspace.entitlement)}>{workspace.entitlement}</span>
                  </div>
                </div>
                <PortalMetaList
                  items={[
                    { label: "Members", value: `${members.length}` },
                    { label: "Sources", value: `${sources.length}` },
                  ]}
                />
                <div className="portal-record-card__actions">
                  <Link
                    className="button"
                    data-testid={`workspace-index-open-${workspace.id}`}
                    href={`/portal/workspaces/${workspace.id}` as Route}
                  >
                    Open workspace
                  </Link>
                  <Link
                    className="button-ghost"
                    data-testid={`workspace-index-open-runs-${workspace.id}`}
                    href={`/portal/workspaces/${workspace.id}/runs` as Route}
                  >
                    View runs
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        <PaginationLinks
          pathname="/portal/workspaces"
          searchParams={params}
          pageInfo={pageInfo}
          testIdPrefix="workspace-index"
        />
      </section>
    </PortalShell>
  );
}
