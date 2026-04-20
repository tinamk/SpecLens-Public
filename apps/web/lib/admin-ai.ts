import {
  getAdminAiAgents,
  getAdminAiAuthStatus,
  getAdminAiRoles,
  getAdminAiSkills,
  getPortalWorkspaces,
} from "./api";

export async function loadAdminAiPageData() {
  const [auth, skills, roles, agents, workspaces] = await Promise.all([
    getAdminAiAuthStatus(),
    getAdminAiSkills(),
    getAdminAiRoles(),
    getAdminAiAgents(),
    getPortalWorkspaces(),
  ]);

  return {
    auth,
    skills,
    roles,
    agents,
    workspaces,
  };
}
