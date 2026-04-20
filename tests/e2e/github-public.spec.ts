import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import {
  githubLocationPattern,
  resolveGithubIntegrationEnv,
  runGithubPrivateRepoFlow,
} from "./helpers/github";
import { resolveE2eMode, resolveE2eUser } from "./helpers/env";
import { expectReportSurface } from "./helpers/reports";
import { auditCompletedJobExecution, deterministicE2eTaskLabel } from "./helpers/runs";

const ownerUser = resolveE2eUser("OWNER", localTestUsers[0]);
const githubIntegration = resolveGithubIntegrationEnv();

test.describe.serial("GitHub App private repository integration (public host)", () => {
  test("dedicated E2E owner links the shared installation on the public host and runs a private repo analysis", async ({ page }) => {
    test.skip(resolveE2eMode() !== "production", "Run this spec on the public-host target.");
    test.skip(
      !githubIntegration.installationId,
      "Set E2E_GITHUB_INSTALLATION_ID to a real GitHub App installation id before running this test.",
    );
    test.skip(
      !process.env.E2E_OWNER_USERNAME || !process.env.E2E_OWNER_PASSWORD,
      "Set dedicated E2E_OWNER_* credentials before running the public GitHub flow.",
    );

    const flow = await runGithubPrivateRepoFlow(page, {
      user: ownerUser,
      installationId: githubIntegration.installationId,
      privateRepoUrl: githubIntegration.privateRepoUrl,
      privateRepoFullName: githubIntegration.privateRepoFullName,
      sourceDisplayName: "Private GitHub repo (public)",
      workspaceNamePrefix: "GitHub Public E2E",
      workspaceDescription: "Ephemeral public-host GitHub E2E workspace for deterministic callback validation.",
    });

    const executionAudit = await auditCompletedJobExecution(page, {
      jobId: flow.jobId,
      expectedTaskLabel: deterministicE2eTaskLabel,
      expectedSourceLocationPattern: githubLocationPattern(flow.acceptedLocations),
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
      minArtifactCount: 4,
    });
    await expect(page.getByText(githubLocationPattern(flow.acceptedLocations))).toBeVisible();
    await page.getByTestId("workspace-runs-job-open-report").click();
    await expect(page).toHaveURL(/\/portal\/workspaces\/.+\/reports\//);
    await expectReportSurface(page, { report: executionAudit.report });
  });
});
