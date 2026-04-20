import { PortalShell } from "@speclens/ui";
import { AdminAiPanel } from "../../../../../components/admin-ai-actions";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import { loadAdminAiPageData } from "../../../../../lib/admin-ai";
import { buildAdminNav, buildPortalPrimaryNav } from "../../../../../lib/portal";

export default async function AdminAiRolesPage() {
  const session = await requirePortalSession("/portal/admin/ai/roles");
  const isAdmin = isPortalAdminSession(session);

  if (!isAdmin) {
    return (
      <PortalShell eyebrow="Admin" title="Access denied" pageTestId="admin-ai-access-denied-page" primaryNav={buildPortalPrimaryNav(false)}>
        <p className="inline-error" data-testid="admin-ai-access-denied">Administrator access is required.</p>
      </PortalShell>
    );
  }

  const data = await loadAdminAiPageData();

  return (
    <PortalShell
      eyebrow="Admin AI"
      title="Roles"
      lede="Role prompts and dependencies are separated from auth and agents so prompt-layer changes remain easy to review and test."
      pageTestId="admin-ai-roles-page"
      primaryNav={buildPortalPrimaryNav(true)}
      activePrimaryNavKey="admin"
      secondaryNav={buildAdminNav()}
      activeSecondaryNavKey="roles"
    >
      <AdminAiPanel
        section="roles"
        initialAuth={data.auth}
        initialSkills={data.skills}
        initialRoles={data.roles}
        initialAgents={data.agents}
        workspaces={data.workspaces.map(entry => ({ workspace: entry.workspace, sources: entry.sources }))}
      />
    </PortalShell>
  );
}
