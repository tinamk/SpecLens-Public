import type { Route } from "next";
import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { CreateWorkspaceForm } from "../../../components/portal-actions";
import { PaginationLinks } from "../../../components/portal-pagination";
import { getPortalWorkspacesPage } from "../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../lib/auth";
import { buildPortalPrimaryNav, getEntitlementTagClass } from "../../../lib/portal";

function renderBanner(params: Record<string, string | string[] | undefined>) {
  const access = typeof params.access === "string" ? params.access : null;
  const admin = typeof params.admin === "string" ? params.admin : null;
  const billing = typeof params.billing === "string" ? params.billing : null;

  if (access === "denied") {
    return <p className="banner banner--error" data-testid="workspace-index-access-denied">You do not have access to that workspace.</p>;
  }
  if (admin === "denied") {
    return <p className="banner banner--error" data-testid="workspace-index-admin-denied">Administrator access is required for that area.</p>;
  }
  if (billing === "success") {
    return (
      <p className="banner banner--success" data-testid="workspace-index-billing-success">
        Billing completed. Refresh the workspace settings if the entitlement has not updated yet.
      </p>
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
      lede="Create, open, and audit workspaces from one place. Workspace operations now live inside each workspace area."
      pageTestId="workspace-index-page"
      primaryNav={buildPortalPrimaryNav(isAdmin)}
      activePrimaryNavKey="workspaces"
    >
      {renderBanner(params)}
      <section className="portal-stat-grid">
        <article className="portal-stat" data-testid="workspace-index-stat-workspaces">
          <span className="portal-stat__label">Workspaces</span>
          <span className="portal-stat__value">{workspaces.length}</span>
          <p>Shared spaces for sources, runs, reports, and workspace-owned settings.</p>
        </article>
        <article className="portal-stat" data-testid="workspace-index-stat-sources">
          <span className="portal-stat__label">Tracked sources</span>
          <span className="portal-stat__value">{totalSources}</span>
          <p>Git-backed repository inputs connected across your workspaces.</p>
        </article>
        <article className="portal-stat" data-testid="workspace-index-stat-members">
          <span className="portal-stat__label">Members</span>
          <span className="portal-stat__value">{totalMembers}</span>
          <p>Workspace collaborators with access to runs and reports.</p>
        </article>
        <article className="portal-stat" data-testid="workspace-index-stat-paid">
          <span className="portal-stat__label">Paid workspaces</span>
          <span className="portal-stat__value">{paidWorkspaces}</span>
          <p>Workspaces currently on Pro or Commercial entitlements.</p>
        </article>
      </section>

      <section className="portal-grid">
        <article className="portal-panel xl:col-span-2" data-testid="workspace-index-create-panel">
          <PortalSectionHeader
            badgeLabel="Create"
            badgeClassName="tag tag--success"
            title="Create a workspace"
            description="New workspaces start with an overview page and dedicated areas for sources, runs, reports, access, and settings."
          />
          <ul className="bullet-list">
            <li>Keep source intake in the sources route so repository scope stays explicit.</li>
            <li>Queue analysis and remediation in runs, not in a mixed overview surface.</li>
            <li>Keep billing and GitHub installation state in workspace-owned settings.</li>
          </ul>
          <CreateWorkspaceForm />
        </article>
        <article className="portal-panel portal-panel--accent" data-testid="workspace-index-account-panel">
          <PortalSectionHeader
            badgeLabel="Account"
            title="Global settings"
            description="Session details, environment information, and pricing links live in the shared settings area."
          />
          <PortalMetaList
            items={[
              { label: "Portal admin", value: isAdmin ? "Enabled for this session" : "Not granted for this session" },
              { label: "Workspace focus", value: "Global settings stay separate from workspace-owned billing and GitHub state" },
            ]}
          />
          <PortalLinkGrid testId="workspace-index-account-grid">
            <PortalLinkCard
              description="Open the account-level settings surface for session context, pricing entrypoints, and portal-wide navigation."
              eyebrow="Account"
              href="/portal/settings"
              testId="workspace-index-open-settings"
              title="Open settings"
              tone="success"
            />
            <PortalLinkCard
              description="Review hosted plan boundaries before changing workspace-owned billing or source scope."
              eyebrow="Plans"
              href="/pricing"
              title="Open pricing"
              tone="warning"
            />
            {isAdmin ? (
              <PortalLinkCard
                description="Jump into the admin AI surfaces for auth, skills, roles, and agent execution."
                eyebrow="Admin"
                href="/portal/admin/ai/auth"
                testId="workspace-index-open-admin"
                title="Open admin"
                tone="info"
              />
            ) : null}
          </PortalLinkGrid>
        </article>
      </section>

      <section className="portal-panel portal-directory-shell" data-testid="workspace-index-list">
        <div className="portal-directory-toolbar">
          <PortalSectionHeader
            badgeLabel="Directory"
            badgeClassName="tag tag--info"
            title="Your workspaces"
            description="Scan workspace health, then jump straight into the exact operating surface you need."
          />
          <form className="portal-search-form" method="GET">
            <label className="field">
              <span>Search workspaces</span>
              <input
                autoComplete="off"
                data-testid="workspace-index-search-input"
                defaultValue={workspaceQuery.q}
                name="q"
                placeholder="Filter by workspace, member, or source…"
              />
            </label>
            <button className="button-ghost" data-testid="workspace-index-search-submit" type="submit">Apply workspace filter</button>
          </form>
        </div>
        {workspaces.length === 0 ? <p className="subtle-note">No workspaces yet. Create one to start adding sources and queueing runs.</p> : null}
        {workspaces.length > 0 ? (
          <div className="portal-record-grid">
            {workspaces.map(({ workspace, sources, members }) => (
              <article className="portal-record-card" data-testid={`workspace-index-row-${workspace.id}`} key={workspace.id}>
                <div className="portal-record-card__header">
                  <div className="portal-record-card__title">
                    <strong>{workspace.name}</strong>
                    <p>{workspace.description ?? "No description yet."}</p>
                  </div>
                  <div className="portal-record-card__meta">
                    <span className={getEntitlementTagClass(workspace.entitlement)}>{workspace.entitlement}</span>
                    <span className="tag tag--info">{members.length} member{members.length === 1 ? "" : "s"}</span>
                    <span className="tag tag--neutral">{sources.length} source{sources.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <PortalMetaList
                  items={[
                    { label: "Workspace ID", value: workspace.id.slice(0, 8) },
                    { label: "Operating model", value: "Overview plus dedicated sources, runs, reports, access, and settings routes" },
                  ]}
                />
                <div className="portal-record-card__actions">
                  <Link
                    className="button-secondary"
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
