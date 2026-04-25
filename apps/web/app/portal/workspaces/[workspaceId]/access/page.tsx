import Link from "next/link";
import { PortalLinkCard, PortalLinkGrid, PortalMetaList, PortalSectionHeader, PortalShell } from "@speclens/ui";
import { buildSearchHref, PaginationLinks } from "@speclens/ui";
import { WorkspaceRouteState } from "../../../../../components/workspace-route-state";
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
  getWorkspaceMembersEmptyState,
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
    const membersEmptyState = getWorkspaceMembersEmptyState(memberQuery.q);

    return (
      <PortalShell
        eyebrow="Workspace access"
        title={workspaceConsole.workspace.name}
        pageTestId="workspace-access-page"
        primaryNav={buildPortalPrimaryNav(isPortalAdminSession(session))}
        activePrimaryNavKey="workspaces"
        secondaryNav={buildWorkspaceNav(workspaceId)}
        activeSecondaryNavKey="access"
      >
        <section className="portal-stat-grid" aria-label="Workspace access summary">
          <article className="portal-stat" data-testid="workspace-access-stat-members">
            <span className="portal-stat__label">Members</span>
            <span className="portal-stat__value">{workspaceConsole.members.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-access-stat-collaborators">
            <span className="portal-stat__label">Collaborators</span>
            <span className="portal-stat__value">{collaboratorCount}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-access-stat-sources">
            <span className="portal-stat__label">Sources</span>
            <span className="portal-stat__value">{workspaceConsole.sources.length}</span>
          </article>
          <article className="portal-stat" data-testid="workspace-access-stat-runs">
            <span className="portal-stat__label">Runs</span>
            <span className="portal-stat__value">{workspaceConsole.stats.totalJobs}</span>
          </article>
        </section>

        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-access-members-panel">
            <PortalSectionHeader
              badgeLabel="Members"
              badgeClassName="tag tag--success"
              title="Workspace members"
            />
            {canManageWorkspace ? (
              <AddWorkspaceMemberForm workspaceId={workspaceId} />
            ) : (
              <p className="subtle-note" data-testid="workspace-access-read-only">
                Workspace owners manage membership. Contact the owner shown in the access summary for role changes.
              </p>
            )}
            <form aria-label="Search workspace members" className="stack-form form-shell" method="GET" role="search">
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
              <div className="portal-inline-actions">
                <button className="button-ghost" data-testid="workspace-access-search-submit" type="submit">Apply member filter</button>
                {memberQuery.q ? (
                  <Link
                    className="button-secondary"
                    data-testid="workspace-access-clear-filters"
                    href={buildSearchHref(`/portal/workspaces/${workspaceId}/access`, query, {
                      page: undefined,
                      q: undefined,
                    })}
                  >
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </form>
            {members.length === 0 ? (
              <div className="subtle-note" data-testid="workspace-access-empty-state">
                <p><strong>{membersEmptyState.title}</strong></p>
                <p>{membersEmptyState.detail}</p>
              </div>
            ) : null}
            {members.length > 0 ? (
              <div className="portal-record-grid">
                {members.map(member => (
                  <article className="portal-record-card" data-testid={`workspace-access-row-${member.userId}`} key={member.id}>
                    <div className="portal-record-card__header">
                      <div className="portal-record-card__title">
                        <h3>{member.displayName}</h3>
                        <p>{member.email}</p>
                      </div>
                      <div className="portal-record-card__meta">
                        <span className={member.role === "owner" ? "tag tag--success" : "tag tag--neutral"}>{member.role}</span>
                        {member.userId === workspaceConsole.workspace.ownerUserId ? <span className="tag tag--info">workspace owner</span> : null}
                      </div>
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
            <PortalSectionHeader badgeLabel="State" title="Access summary" />
            <PortalMetaList
              items={[
                { label: "Owner", value: ownerMember ? `${ownerMember.displayName} (${ownerMember.email})` : workspaceConsole.workspace.ownerUserId },
                { label: "Entitlement", value: workspaceConsole.workspace.entitlement },
              ]}
            />
            <PortalLinkGrid>
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}`}
                title="Workspace overview"
                eyebrow="hub"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/settings`}
                title="Workspace settings"
                eyebrow="owner"
                tone="warning"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/runs`}
                title="Run history"
                eyebrow="execution"
                tone="info"
              />
              <PortalLinkCard
                href={`/portal/workspaces/${workspaceId}/reports`}
                title="Report history"
                eyebrow="review"
                tone="success"
              />
            </PortalLinkGrid>
          </article>
        </section>
      </PortalShell>
    );
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 403 || error.status === 404)) {
      const isMissing = error.status === 404;
      return (
        <WorkspaceRouteState
          eyebrow="Workspace access"
          isAdmin={isPortalAdminSession(session)}
          isMissing={isMissing}
          pageTestId="workspace-access-denied-page"
          descriptionTestId="workspace-access-denied"
        />
      );
    }
    throw error;
  }
}
