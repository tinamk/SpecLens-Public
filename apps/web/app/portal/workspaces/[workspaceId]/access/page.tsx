import { PortalShell } from "@speclens/ui";
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
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
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
  const session = await requirePortalSession(`/portal/workspaces/${workspaceId}/access`);

  try {
    const query = await searchParams;
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
        <section className="portal-grid">
          <article className="portal-panel" data-testid="workspace-access-members-panel">
            <span className="tag tag--success">Members</span>
            <h2>Workspace members</h2>
            {canManageWorkspace ? (
              <AddWorkspaceMemberForm workspaceId={workspaceId} />
            ) : (
              <p className="subtle-note" data-testid="workspace-access-read-only">
                This account can review workspace membership, but only the workspace owner can add or remove members.
              </p>
            )}
            <form className="stack-form" method="GET">
              <label className="field">
                <span>Search members</span>
                <input
                  data-testid="workspace-access-search-input"
                  defaultValue={memberQuery.q}
                  name="q"
                  placeholder="Filter by name, email, or role"
                />
              </label>
              <button className="button-ghost" data-testid="workspace-access-search-submit" type="submit">Apply member filter</button>
            </form>
            {members.length === 0 ? <p className="subtle-note">No members matched this filter yet.</p> : null}
            {members.map(member => (
              <div className="list-row" data-testid={`workspace-access-row-${member.userId}`} key={member.id}>
                <div>
                  <strong>{member.displayName}</strong>
                  <p>{member.email}</p>
                  <p className="subtle-note">{member.role}</p>
                </div>
                {canManageWorkspace && member.userId !== workspaceConsole.workspace.ownerUserId && member.role !== "owner" ? (
                  <div className="list-row__actions">
                    <RemoveWorkspaceMemberButton
                      workspaceId={workspaceId}
                      membershipId={member.id}
                      label={member.email}
                      testId={`workspace-access-remove-member-${member.id}`}
                    />
                  </div>
                ) : null}
              </div>
            ))}
            <PaginationLinks
              pathname={`/portal/workspaces/${workspaceId}/access`}
              searchParams={query}
              pageInfo={pageInfo}
              testIdPrefix="workspace-access"
            />
          </article>
          <article className="portal-panel" data-testid="workspace-access-state-panel">
            <span className="tag tag--neutral">State</span>
            <h2>Access summary</h2>
            <p><strong>Owner:</strong> {ownerMember ? `${ownerMember.displayName} (${ownerMember.email})` : workspaceConsole.workspace.ownerUserId}</p>
            <p><strong>Workspace entitlement:</strong> {workspaceConsole.workspace.entitlement}</p>
            <p>Report, job, source, and settings access are mediated through workspace membership.</p>
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
          <p className="inline-error" data-testid="workspace-access-denied">You do not have access to this workspace.</p>
        </PortalShell>
      );
    }
    throw error;
  }
}
