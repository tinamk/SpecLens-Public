import Link from "next/link";
import { PortalNoticePanel, PortalShell } from "@speclens/ui";
import { AdminAiPanel } from "../../../../../components/admin-ai-actions";
import { requirePortalSession, isPortalAdminSession } from "../../../../../lib/auth";
import { loadAdminAiPageData } from "../../../../../lib/admin-ai";
import { buildAdminNav, buildPortalPrimaryNav } from "../../../../../lib/portal";

export default async function AdminAiSkillsPage() {
  const session = await requirePortalSession("/portal/admin/ai/skills");
  const isAdmin = isPortalAdminSession(session);

  if (!isAdmin) {
    return (
      <PortalShell eyebrow="Admin" title="Access denied" pageTestId="admin-ai-access-denied-page" primaryNav={buildPortalPrimaryNav(false)}>
        <PortalNoticePanel
          actions={<Link className="button-secondary" href="/portal/workspaces">Open workspaces</Link>}
          badgeLabel="Admin only"
          description="Administrator access is required."
          descriptionTestId="admin-ai-access-denied"
          title="This area is reserved for portal administrators"
        />
      </PortalShell>
    );
  }

  const data = await loadAdminAiPageData();

  return (
    <PortalShell
      eyebrow="Admin AI"
      title="Skills"
      lede="Skill definitions are managed in their own admin route so CRUD coverage stays focused and deterministic."
      pageTestId="admin-ai-skills-page"
      primaryNav={buildPortalPrimaryNav(true)}
      activePrimaryNavKey="admin"
      secondaryNav={buildAdminNav()}
      activeSecondaryNavKey="skills"
    >
      <AdminAiPanel
        section="skills"
        initialAuth={data.auth}
        initialSkills={data.skills}
        initialRoles={data.roles}
        initialAgents={data.agents}
        workspaces={data.workspaces.map(entry => ({ workspace: entry.workspace, sources: entry.sources }))}
      />
    </PortalShell>
  );
}
