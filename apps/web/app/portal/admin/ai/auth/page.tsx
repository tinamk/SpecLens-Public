import { AdminAiPageShell } from "../../../../../components/admin-ai-page-shell";

export default async function AdminAiAuthPage() {
  return (
    <AdminAiPageShell
      activeSection="auth"
      pageTestId="admin-ai-auth-page"
      returnTo="/portal/admin/ai/auth"
      title="Codex auth"
    />
  );
}
