import { PortalShell } from "@speclens/ui";
import { AdminAiPanel } from "../../../../../components/admin-ai-actions";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import { loadAdminAiPageData } from "../../../../../lib/admin-ai";
import { buildAdminNav, buildPortalPrimaryNav } from "../../../../../lib/portal";

export default async function AdminAiAuthPage() {
  const session = await requirePortalSession("/portal/admin/ai/auth");
  const isAdmin = isPortalAdminSession(session);

  if (!isAdmin) {
    return (
      <PortalShell
        eyebrow="Admin"
        title="Access denied"
        pageTestId="admin-ai-access-denied-page"
        primaryNav={buildPortalPrimaryNav(false)}
      >
        <p className="inline-error" data-testid="admin-ai-access-denied">Administrator access is required.</p>
      </PortalShell>
    );
  }

  const data = await loadAdminAiPageData();

  return (
    <PortalShell
      eyebrow="Admin AI"
      title="Codex auth"
      lede="Device-flow authentication is isolated from skill, role, and agent management so admin-state transitions stay explicit and testable."
      pageTestId="admin-ai-auth-page"
      primaryNav={buildPortalPrimaryNav(true)}
      activePrimaryNavKey="admin"
      secondaryNav={buildAdminNav()}
      activeSecondaryNavKey="auth"
    >
      <AdminAiPanel
        section="auth"
        initialAuth={data.auth}
        initialSkills={data.skills}
        initialRoles={data.roles}
        initialAgents={data.agents}
        workspaces={data.workspaces.map(entry => ({ workspace: entry.workspace, sources: entry.sources }))}
      />
    </PortalShell>
  );
}
