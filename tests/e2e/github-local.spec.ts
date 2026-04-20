import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import {
  githubLocationPattern,
  resolveGithubIntegrationEnv,
  runGithubPrivateRepoFlow,
} from "./helpers/github";
import { resolveE2eMode, resolveE2eUser } from "./helpers/env";
import { expectReportSurface } from "./helpers/reports";
import {
  auditCompletedJobExecution,
  cancelJob,
  deterministicE2eTaskLabel,
  fetchHostedJobEnvelope,
} from "./helpers/runs";

const ownerUser = resolveE2eUser("OWNER", localTestUsers[0]);
const githubIntegration = resolveGithubIntegrationEnv();

test.describe.serial("GitHub App private repository integration (local)", () => {
  test("owner links the configured installation on the local stack and runs a private repo analysis", async ({ page }) => {
    test.skip(resolveE2eMode() !== "local", "Run this spec on the local/dev stack.");
    test.skip(
      !githubIntegration.installationId,
      "Set E2E_GITHUB_INSTALLATION_ID to a real GitHub App installation id before running this test.",
    );
    test.setTimeout(12 * 60 * 1000);

    const flow = await runGithubPrivateRepoFlow(page, {
      user: ownerUser,
      installationId: githubIntegration.installationId,
      privateRepoUrl: githubIntegration.privateRepoUrl,
      privateRepoFullName: githubIntegration.privateRepoFullName,
      sourceDisplayName: "Private GitHub repo (local)",
      workspaceNamePrefix: "GitHub Local E2E",
      workspaceDescription: "Ephemeral local GitHub E2E workspace for deterministic callback validation.",
      jobSuccessTimeoutMs: 3 * 60 * 1000,
    });

    await expect(page.getByText(githubLocationPattern(flow.acceptedLocations))).toBeVisible();
    await expect(page.getByTestId("workspace-runs-job-task")).toContainText(deterministicE2eTaskLabel);
    const envelope = await fetchHostedJobEnvelope(page, flow.jobId, "default");
    expect(["running", "succeeded"]).toContain(envelope.job.status);

    if (flow.jobStatus === "succeeded" && flow.reportUrl) {
      const executionAudit = await auditCompletedJobExecution(page, {
        jobId: flow.jobId,
        expectedTaskLabel: deterministicE2eTaskLabel,
        expectedSourceLocationPattern: githubLocationPattern(flow.acceptedLocations),
        minRoleCount: 1,
        minSkillCount: 1,
        requiredToolCapabilities: ["repo-read"],
        minArtifactCount: 4,
      });
      await page.getByTestId("workspace-runs-job-open-report").click();
      await expect(page).toHaveURL(/\/portal\/workspaces\/.+\/reports\//);
      await expectReportSurface(page, { report: executionAudit.report });
      return;
    }

    await expect(page.getByTestId("workspace-runs-job-status")).toContainText("running");
    await expect(page.getByTestId("workspace-runs-job-log-console")).toContainText(
      /claimed job|Planned \d+ role|Materialize source|Running role|Estimated remaining runtime|Role .* finished/i,
    );
    await cancelJob(page, flow.jobId);
  });
});
