import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalNoticePanel, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { PaginationLinks } from "../../../../../components/portal-pagination";
import {
  AddWorkspaceMemberForm,
  RemoveWorkspaceMemberButton,
} from "../../../../../components/portal-actions";
import {
  ApiResponseError,
  getCurrentUser,
  getWorkspaceConsole,
  getWorkspaceMembersPage,
} from "../../../../../lib/api";
import { buildPortalReturnTo, requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import {
  buildPortalPrimaryNav,
  buildWorkspaceNav,
  isWorkspaceScopedEntityPage,
  isWorkspaceScopedWorkspaceConsoleContext,
} from "../../../../../lib/portal";

export default async function WorkspaceAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const session = await requirePortalSession(buildPortalReturnTo(`/portal/workspaces/${workspaceId}/access`, query));

  try {
    const memberQuery = {
      q: typeof query.q === "string" ? query.q : "",
      page: typeof query.page === "string" ? Number.parseInt(query.page, 10) || 1 : 1,
      pageSize: 25,
    };
    const [workspaceConsole, { items: members, pageInfo }, currentUser] = await Promise.all([
      getWorkspaceConsole(workspaceId),
      getWorkspaceMembersPage(workspaceId, memberQuery),
      getCurrentUser(),
    ]);
    const canManageWorkspace = currentUser.id === workspaceConsole.workspace.ownerUserId;
    if (!isWorkspaceScopedWorkspaceConsoleContext(workspaceId, workspaceConsole)
      || !isWorkspaceScopedEntityPage(workspaceId, members)) {
      throw new ApiResponseError(404, `Workspace access payload does not belong to workspace ${workspaceId}.`);
    }
    const ownerMember = workspaceConsole.members.find(member => member.userId === workspaceConsole.workspace.ownerUserId) ?? null;
    const collaboratorCount = Math.max(workspaceConsole.members.length - 1, 0);

    return (
      <PortalShell
        eyebrow="Workspace access"
        title={workspaceConsole.workspace.name}
        lede="Membership and access state live in their own route so collaboration and authorization are visible without mixing them into billing or run controls."
        pageTestId="workspace-access-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="access"
      >
        <section className="portal-stat-grid">
          <article className="portal-stat" data-testid="workspace-access-stat-members">
            <span className="portal-stat__label">Members</span>
            <span className="portal-stat__value">{workspaceConsole.members.length}</span>
            <p>Total people with access to this workspace.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-access-stat-collaborators">
            <span className="portal-stat__label">Collaborators</span>
            <span className="portal-stat__value">{collaboratorCount}</span>
            <p>Non-owner members currently sharing run and report visibility.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-access-stat-sources">
            <span className="portal-stat__label">Shared sources</span>
            <span className="portal-stat__value">{workspaceConsole.sources.length}</span>
            <p>Repository inputs already visible to the workspace team.</p>
          </article>
          <article className="portal-stat" data-testid="workspace-access-stat-runs">
            <span className="portal-stat__label">Shared runs</span>
            <span className="portal-stat__value">{workspaceConsole.jobs.length}</span>
            <p>Run and report history governed by the same workspace membership.</p>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-access-members-panel">
            <PortalSectionHeader
              badgeLabel="Members"
              badgeClassName="tag tag--success"
              title="Workspace members"
              description="Membership stays visible here so collaboration rules do not get buried inside run or billing screens."
            />
            {canManageWorkspace ? (
              <AddWorkspaceMemberForm workspaceId={workspaceId} />
            ) : (
              <p className="subtle-note" data-testid="workspace-access-read-only">
                This account can review workspace membership, but only the workspace owner can add or remove members.
              </p>
            )}
            <form className="stack-form form-shell" method="GET">
              <div className="form-grid">
                <label className="field field--full">
                  <span>Search members</span>
                  <input
                    autoComplete="off"
                    data-testid="workspace-access-search-input"
                    defaultValue={memberQuery.q}
                    name="q"
                    placeholder="Filter by name, email, or role…"
                  />
                </label>
              </div>
              <button className="button-ghost" data-testid="workspace-access-search-submit" type="submit">Apply member filter</button>
            </form>
            {members.length === 0 ? <p className="subtle-note">No members matched this filter yet.</p> : null}
            {members.length > 0 ? (
              <div className="portal-record-grid">
                {members.map(member => (
                  <article className="portal-record-card" data-testid={`workspace-access-row-${member.userId}`} key={member.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <strong>{member.displayName}</strong>
                        <p>{member.email}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={member.role === "owner" ? "tag tag--success" : "tag tag--neutral"}>{member.role}</span>
                        {member.userId === workspaceConsole.workspace.ownerUserId ? <span className="tag tag--info">workspace owner</span> : null}
                      </div>
                    </div>
                    <div className="portal-record-card__body">
                      <p>
                        {member.userId === workspaceConsole.workspace.ownerUserId
                          ? "Owns membership, billing, and workspace-scoped integration controls."
                          : "Can review the shared sources, runs, reports, and code surfaces attached to this workspace."}
                      </p>
                    </div>
                    {canManageWorkspace && member.userId !== workspaceConsole.workspace.ownerUserId && member.role !== "owner" ? (
                      <div className="portal-record-card__actions">
                        <RemoveWorkspaceMemberButton
                          workspaceId={workspaceId}
                          membershipId={member.id}
                          label={member.email}
                          testId={`workspace-access-remove-member-${member.id}`}
                        />
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
            <PaginationLinks
              pathname={`/portal/workspaces/${workspaceId}/access`}
              searchParams={query}
              pageInfo={pageInfo}
              testIdPrefix="workspace-access"
            />
          </article>
          <article className="portal-panel" data-testid="workspace-access-state-panel">
            <PortalSectionHeader
              badgeLabel="State"
              title="Access summary"
              description="Workspace access governs reports, jobs, sources, and workspace-owned settings together."
            />
            <PortalMetaList
              items={[
                { label: "Owner", value: ownerMember ? `${ownerMember.displayName} (${ownerMember.email})` : workspaceConsole.workspace.ownerUserId },
                { label: "Workspace entitlement", value: workspaceConsole.workspace.entitlement },
                { label: "Member management", value: canManageWorkspace ? "This account can add or remove members" : "Workspace owner only" },
              ]}
            />
            <PortalLinkGrid>
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}`}
                title="Workspace overview"
                eyebrow="route hub"
                description="Return to the summary route for navigation across this workspace."
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/settings`}
                title="Workspace settings"
                eyebrow="owner controls"
                description="Review billing, entitlement, and GitHub installation state."
                tone="warning"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/runs`}
                title="Run history"
                eyebrow="shared execution"
                description="Open the runs surface that the current membership can review."
                tone="info"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/reports`}
                title="Report history"
                eyebrow="shared review"
                description="Open the generated reports visible to the current workspace members."
                tone="success"
              />
            </PortalLinkGrid>
          </article>
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      return (
        <PortalShell
          eyebrow="Workspace access"
          title="Access denied"
          pageTestId="workspace-access-denied-page"
          primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
          activePrimaryNavKey="workspaces"
        >
          <PortalNoticePanel
            actions={<Link className="button-secondary" href="/portal/workspaces">Back to workspaces</Link>}
            description="You do not have access to this workspace."
            descriptionTestId="workspace-access-denied"
            title="This access surface is not available to your account"
          />
        </PortalShell>
      );
    }
    throw error;
  }
}
