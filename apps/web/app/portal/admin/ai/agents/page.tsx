import { AdminAiPageShell } from "../../../../../components/admin-ai-page-shell";

export default async function AdminAiAgentsPage() {
  return (
    <AdminAiPageShell
      activeSection="agents"
      pageTestId="admin-ai-agents-page"
      returnTo="/portal/admin/ai/agents"
      title="Agents"
    />
  );
}
