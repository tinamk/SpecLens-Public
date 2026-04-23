import Link from "next/link";
import { PortalNoticePanel, PortalShell } from "@speclens/ui";
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
        <PortalNoticePanel
          actions={<Link className="button-secondary" href="/portal/workspaces">Open workspaces</Link>}
          badgeLabel="Admin only"
          description="Administrator access is required."
          descriptionTestId="admin-ai-access-denied"
          title="Admin only"
        />
      </PortalShell>
    );
  }

  const data = await loadAdminAiPageData();

  return (
    <PortalShell
      eyebrow="Admin AI"
      title="Agents"
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
