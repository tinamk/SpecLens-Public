import { AdminAiPageShell } from "../../../../../components/admin-ai-page-shell";

export default async function AdminAiRolesPage() {
  return (
    <AdminAiPageShell
      activeSection="roles"
      pageTestId="admin-ai-roles-page"
      returnTo="/portal/admin/ai/roles"
      title="Roles"
    />
  );
}
