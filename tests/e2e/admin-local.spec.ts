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
import { assertAnalysisTaskCatalogEntry, auditCompletedJobExecution, expectJobPlanVisible, waitForJobSuccess } from "./helpers/runs";
import { addSource } from "./helpers/sources";
import { createWorkspace } from "./helpers/workspaces";

const adminUser = resolveE2eUser("ADMIN", localTestUsers[3]);
const nonAdminUser = resolveE2eUser("OWNER", localTestUsers[0]);
const publicGithubUrl = process.env.E2E_GITHUB_PUBLIC_URL ?? "https://github.com/octocat/Hello-World.git";

function escapeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test.describe.serial("admin AI local", () => {
  test("non-admin users see the admin denial boundary", async ({ page }) => {
    test.skip(resolveE2eMode() !== "local", "Run this spec only against the local/dev stack.");

    await loginThroughKeycloak(page, nonAdminUser, {
      path: "/portal/admin/ai/auth",
      expectedUrl: /\/portal\/admin\/ai\/auth/,
    });

    for (const path of [
      "/portal/admin/ai/auth",
      "/portal/admin/ai/skills",
      "/portal/admin/ai/roles",
      "/portal/admin/ai/agents",
    ]) {
      await page.goto(path);
      await expect(page.getByTestId("admin-ai-access-denied-page")).toBeVisible();
      await expect(page.getByTestId("admin-ai-access-denied")).toContainText(/administrator/i);
    }
    await expect(page.getByTestId("admin-ai-auth-panel")).toHaveCount(0);
  });

  test("admin can manage auth/skills/roles/agents and run an agent job", async ({ page }) => {
    test.skip(resolveE2eMode() !== "local", "Run this spec only against the local/dev stack.");

    await loginThroughKeycloak(page, adminUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    const workspaceName = createTimestampedName("Admin Local Workspace");
    const sourceName = "Admin Local Git Source";
    const skillName = createTimestampedName("Admin Skill");
    const roleName = createTimestampedName("Admin Role");
    const agentName = createTimestampedName("Admin Agent");

    const workspace = await createWorkspace(page, {
      name: workspaceName,
      description: "Ephemeral workspace for admin agent validation.",
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
    await expect(page.getByTestId("admin-ai-auth-start")).toBeVisible();
    await expect(page.getByTestId("admin-ai-auth-check")).toBeVisible();
    await expect(page.getByTestId("admin-ai-auth-logout")).toBeVisible();

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
    await expectJobPlanVisible(page, { expectedMinimumSteps: 2 });
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
