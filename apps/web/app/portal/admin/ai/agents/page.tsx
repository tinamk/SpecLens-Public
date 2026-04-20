import { PortalShell } from "@speclens/ui";
import { AdminAiPanel } from "../../../../../components/admin-ai-actions";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import { loadAdminAiPageData } from "../../../../../lib/admin-ai";
import { buildAdminNav, buildPortalPrimaryNav } from "../../../../../lib/portal";

export default async function AdminAiAgentsPage() {
  const session = await requirePortalSession("/portal/admin/ai/agents");
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
      title="Agents"
      lede="Agent composition and admin-triggered runs stay together in one route so agent CRUD and execution remain testable from the same surface."
      pageTestId="admin-ai-agents-page"
      primaryNav={buildPortalPrimaryNav(true)}
      activePrimaryNavKey="admin"
      secondaryNav={buildAdminNav()}
      activeSecondaryNavKey="agents"
    >
      <AdminAiPanel
        section="agents"
        initialAuth={data.auth}
        initialSkills={data.skills}
        initialRoles={data.roles}
        initialAgents={data.agents}
        workspaces={data.workspaces.map(entry => ({ workspace: entry.workspace, sources: entry.sources }))}
      />
    </PortalShell>
  );
}
