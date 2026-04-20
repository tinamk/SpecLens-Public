import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import { loginThroughKeycloak } from "./helpers/auth";
import {
  createAgent,
  createRole,
  createSkill,
  deleteAgent,
  deleteRole,
  deleteSkill,
  queueAdminAgentRun,
  updateAgent,
  updateRole,
  updateSkill,
} from "./helpers/admin-ai";
import { createTimestampedName, resolveE2eMode, resolveE2eUser } from "./helpers/env";
import { assertAnalysisTaskCatalogEntry, auditCompletedJobExecution, waitForJobSuccess } from "./helpers/runs";
import { addSource } from "./helpers/sources";
import { createWorkspace } from "./helpers/workspaces";

const adminUser = resolveE2eUser("ADMIN", localTestUsers[3]);
const publicGithubUrl = process.env.E2E_GITHUB_PUBLIC_URL ?? "https://github.com/octocat/Hello-World.git";

function escapeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test.describe.serial("admin AI production", () => {
  test("dedicated production admin can perform a safe CRUD cycle and run an agent job", async ({ page }) => {
    test.skip(resolveE2eMode() !== "production", "Run this spec only against the production/public-host target.");
    test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, "Set dedicated E2E_ADMIN_* credentials before running the production admin flow.");

    await loginThroughKeycloak(page, adminUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    const workspaceName = createTimestampedName("Admin Production Workspace");
    const sourceName = "Admin Production Git Source";
    const skillName = createTimestampedName("Prod Admin Skill");
    const roleName = createTimestampedName("Prod Admin Role");
    const agentName = createTimestampedName("Prod Admin Agent");

    const workspace = await createWorkspace(page, {
      name: workspaceName,
      description: "Ephemeral production workspace for admin agent validation.",
    });

    await page.goto(`/portal/workspaces/${workspace.id}/sources`);
    await addSource(page, {
      prefix: "workspace-sources",
      type: "git-public",
      displayName: sourceName,
      location: publicGithubUrl,
    });

    await page.goto("/portal/admin/ai/auth");
    await expect(page.getByTestId("admin-ai-auth-page")).toBeVisible();
    await expect(page.getByTestId("admin-ai-auth-panel")).toBeVisible();

    await page.goto("/portal/admin/ai/skills");
    await createSkill(page, {
      name: skillName,
      description: "Skill description",
      instructions: "Review repository context.",
    });
    await updateSkill(page, skillName, "Updated skill description");

    await page.goto("/portal/admin/ai/roles");
    await createRole(page, {
      name: roleName,
      description: "Role description",
      prompt: "Inspect the repository and describe risks.",
      skillName,
    });
    await updateRole(page, roleName, "Inspect the repository carefully and describe risks.");

    await page.goto("/portal/admin/ai/agents");
    await createAgent(page, {
      name: agentName,
      description: "Agent description",
      roleName,
    });
    await updateAgent(page, agentName, "Updated agent description");
    await assertAnalysisTaskCatalogEntry(page, {
      taskLabel: agentName,
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
    });

    const jobId = await queueAdminAgentRun(page, {
      agentName,
      workspaceName,
      sourceName,
    });

    await page.goto(`/portal/workspaces/${workspace.id}/runs/${jobId}`);
    await waitForJobSuccess(page);
    await auditCompletedJobExecution(page, {
      jobId,
      expectedTaskLabel: agentName,
      expectedSourceLocationPattern: escapeRegex(publicGithubUrl),
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
      minArtifactCount: 4,
    });

    await page.goto("/portal/admin/ai/agents");
    await deleteAgent(page, agentName);
    await page.goto("/portal/admin/ai/roles");
    await deleteRole(page, roleName);
    await page.goto("/portal/admin/ai/skills");
    await deleteSkill(page, skillName);
  });
});
