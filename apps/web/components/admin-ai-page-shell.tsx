import { PortalShell } from "@speclens/ui";
import { AdminAccessDenied } from "./admin-access-denied";
import { AdminAiPanel } from "./admin-ai-actions";
import { loadAdminAiPageData } from "../lib/admin-ai";
import { requirePortalSession, isPortalAdminSession } from "../lib/auth";
import { buildAdminNav, buildPortalPrimaryNav } from "../lib/portal";

type AdminAiSection = "auth" | "skills" | "roles" | "agents";

export async function AdminAiPageShell({
  activeSection,
  pageTestId,
  returnTo,
  title,
}: {
  activeSection: AdminAiSection;
  pageTestId: string;
  returnTo: string;
  title: string;
}) {
  const session = await requirePortalSession(returnTo);
  const isAdmin = isPortalAdminSession(session);

  if (!isAdmin) {
    return <AdminAccessDenied />;
  }

  const data = await loadAdminAiPageData();

  return (
    <PortalShell
      eyebrow="Admin AI"
      title={title}
      pageTestId={pageTestId}
      primaryNav={buildPortalPrimaryNav(true)}
      activePrimaryNavKey="admin"
      secondaryNav={buildAdminNav()}
      activeSecondaryNavKey={activeSection}
    >
      <AdminAiPanel
        section={activeSection}
        initialAuth={data.auth}
        initialSkills={data.skills}
        initialRoles={data.roles}
        initialAgents={data.agents}
        workspaces={data.workspaces.map(entry => ({ workspace: entry.workspace, sources: entry.sources }))}
      />
    </PortalShell>
  );
}
