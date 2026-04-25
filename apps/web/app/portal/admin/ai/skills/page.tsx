import { AdminAiPageShell } from "../../../../../components/admin-ai-page-shell";

export default async function AdminAiSkillsPage() {
  return (
    <AdminAiPageShell
      activeSection="skills"
      pageTestId="admin-ai-skills-page"
      returnTo="/portal/admin/ai/skills"
      title="Skills"
    />
  );
}
