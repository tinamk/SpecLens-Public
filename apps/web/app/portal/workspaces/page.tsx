import type { Route } from "next";
import Link from "next/link";
import { PortalShell } from "@speclens/ui";
import { CreateWorkspaceForm } from "../../../components/portal-actions";
import { PaginationLinks } from "../../../components/portal-pagination";
import { getPortalWorkspacesPage } from "../../../lib/api";
import { requirePortalSession, isPortalAdminSession } from "../../../lib/auth";
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
  const session = await requirePortalSession("/portal/workspaces");
  const params = await searchParams;
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
          <span className="tag tag--success">Create</span>
          <h2>Create a workspace</h2>
          <p>New workspaces start with an overview page and dedicated areas for sources, runs, reports, access, and settings.</p>
          <CreateWorkspaceForm />
        </article>
        <article className="portal-panel" data-testid="workspace-index-account-panel">
          <span className="tag tag--neutral">Account</span>
          <h2>Global settings</h2>
          <p>Session details, environment information, and pricing links live in the shared settings area.</p>
          <Link className="button-secondary" data-testid="workspace-index-open-settings" href={"/portal/settings" as Route}>Open settings</Link>
          {isAdmin ? (
            <Link className="button-ghost" data-testid="workspace-index-open-admin" href={"/portal/admin/ai/auth" as Route}>Open admin</Link>
          ) : null}
        </article>
      </section>

      <section className="portal-panel" data-testid="workspace-index-list">
        <div className="auth-status">
          <div>
            <span className="tag tag--info">Directory</span>
            <h2>Your workspaces</h2>
          </div>
        </div>
        <form className="stack-form" method="GET">
          <label className="field">
            <span>Search workspaces</span>
            <input
              data-testid="workspace-index-search-input"
              defaultValue={workspaceQuery.q}
              name="q"
              placeholder="Filter by workspace, member, or source"
            />
          </label>
          <button className="button-ghost" data-testid="workspace-index-search-submit" type="submit">Apply workspace filter</button>
        </form>
        {workspaces.length === 0 ? <p className="subtle-note">No workspaces yet. Create one to start adding sources and queueing runs.</p> : null}
        {workspaces.map(({ workspace, sources, members }) => (
          <div className="list-row" data-testid={`workspace-index-row-${workspace.id}`} key={workspace.id}>
            <div>
              <span className={getEntitlementTagClass(workspace.entitlement)}>{workspace.entitlement}</span>
              <h3 className="mt-3 text-xl font-semibold text-slate-950">{workspace.name}</h3>
              <p>{workspace.description ?? "No description yet."}</p>
              <p className="subtle-note">Members: {members.length} · Sources: {sources.length}</p>
            </div>
            <div className="list-row__actions">
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
          </div>
        ))}
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
