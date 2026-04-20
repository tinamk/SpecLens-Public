import path from "node:path";
import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import { loginThroughKeycloak } from "./helpers/auth";
import { resolveE2eMode, resolveE2eUser } from "./helpers/env";
import { expectReportSurface, queueRemediationFromReport } from "./helpers/reports";
import {
  assertAnalysisTaskCatalogEntry,
  auditCompletedJobExecution,
  queueAiTask,
  remediationE2eTaskLabel,
  waitForJobSuccess,
} from "./helpers/runs";
import { addSource, createArchiveFixture } from "./helpers/sources";
import { addWorkspaceMember, createWorkspace } from "./helpers/workspaces";

const ownerUser = resolveE2eUser("OWNER", localTestUsers[0]);
const memberUser = resolveE2eUser("MEMBER", localTestUsers[1]);

test.describe.serial("report remediation local", () => {
  test("owner can queue remediation from a report and members remain read-only", async ({ page }) => {
    test.skip(resolveE2eMode() !== "local", "Run this spec only against the local/dev stack.");

    const archivePath = createArchiveFixture();
    const archiveName = path.basename(archivePath);

    const memberContext = await page.context().browser().newContext();
    const memberPage = await memberContext.newPage();
    await loginThroughKeycloak(memberPage, memberUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });
    await memberContext.close();

    await loginThroughKeycloak(page, ownerUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    const workspace = await createWorkspace(page, {
      name: `Remediation Local ${Date.now()}`,
      description: "Local remediation E2E workspace.",
    });

    await page.goto(`/portal/workspaces/${workspace.id}/sources`);
    await addSource(page, {
      prefix: "workspace-sources",
      type: "upload-archive",
      archivePath,
    });
    await expect(page.getByTestId("workspace-sources-list")).toContainText(archiveName);

    await page.goto(`/portal/workspaces/${workspace.id}/runs`);
    await expect(page.getByTestId("workspace-runs-task-description")).toBeVisible();
    await assertAnalysisTaskCatalogEntry(page, {
      taskLabel: remediationE2eTaskLabel,
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
    });

    const jobId = await queueAiTask(page, {
      prefix: "workspace-runs",
      sourceLabel: archiveName,
      taskLabel: remediationE2eTaskLabel,
    });

    const reportUrl = await waitForJobSuccess(page);
    const executionAudit = await auditCompletedJobExecution(page, {
      jobId,
      expectedTaskLabel: remediationE2eTaskLabel,
      expectedSourceLocationPattern: new RegExp(archiveName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
      minArtifactCount: 4,
      requireStandardizedHandoff: true,
      allowExecutionFailureBlockers: true,
    });

    await page.goto(reportUrl);
    await expect(page).toHaveURL(new RegExp(`/portal/workspaces/${workspace.id}/reports/`));
    await expectReportSurface(page, { report: executionAudit.report, canMutate: true });

    const remediationJobId = await queueRemediationFromReport(page);
    await waitForJobSuccess(page, {
      reportButtonTestId: "workspace-runs-job-open-parent-report",
    });
    await expect(page.getByTestId("workspace-runs-job-kind")).toContainText("remediation");
    await expect(page.getByTestId("workspace-runs-job-parent-report")).toBeVisible();
    await expect(page.getByTestId("workspace-runs-job-changeset-summary")).toBeVisible();
    await expect(page.locator('[data-testid^="workspace-runs-job-artifact-"]')).not.toHaveCount(0);

    await page.goto(reportUrl);
    await expect(page).toHaveURL(reportUrl);
    await expect(page.getByTestId("report-remediation-changeset")).toBeVisible();
    await expect(page.getByTestId("report-open-remediation-job")).toHaveAttribute("href", new RegExp(`${remediationJobId}$`));
    await expect(page.locator('[data-testid^="report-remediation-artifact-"]')).not.toHaveCount(0);

    await addWorkspaceMember(page, workspace.id, memberUser.email);

    const memberReviewContext = await page.context().browser().newContext();
    const memberReviewPage = await memberReviewContext.newPage();
    await loginThroughKeycloak(memberReviewPage, memberUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });
    await memberReviewPage.goto(reportUrl);
    await expectReportSurface(memberReviewPage, { canMutate: false });
    await memberReviewContext.close();
  });
});
