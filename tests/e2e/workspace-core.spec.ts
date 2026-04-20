import assert from "node:assert/strict";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import { loginThroughKeycloak } from "./helpers/auth";
import { createTimestampedName, resolveE2eMode, resolveE2eUser } from "./helpers/env";
import { expectReportSurface } from "./helpers/reports";
import {
  assertAnalysisTaskCatalogEntry,
  auditCompletedJobExecution,
  deterministicE2eTaskLabel,
  queueAiTask,
  waitForJobSuccess,
} from "./helpers/runs";
import { addSource, createArchiveFixture, resolvePersistedSource } from "./helpers/sources";
import { createWorkspace } from "./helpers/workspaces";

const ownerUser = resolveE2eUser("OWNER", localTestUsers[0]);
const memberUser = resolveE2eUser("MEMBER", localTestUsers[1]);
const outsiderUser = resolveE2eUser("OUTSIDER", localTestUsers[2]);
const publicGithubUrl = process.env.E2E_GITHUB_PUBLIC_URL ?? "https://github.com/octocat/Hello-World.git";
let workspaceUrl = "";
let workspaceId = "";
let workspaceName = "";
let jobUrl = "";
let reportUrl = "";
let memberUserEmail = "";

function escapeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test.describe.serial("workspace core flows", () => {
  test("owner creates a workspace, adds deterministic sources, and completes a run", async ({ page }) => {
    const mode = resolveE2eMode();
    const archivePath = createArchiveFixture();
    const archiveName = path.basename(archivePath);
    const primarySourceLabel = mode === "local" ? archiveName : "Octocat Hello World";
    const primarySourceType = mode === "local" ? "upload-archive" : "git-public";
    const primarySourceLocations = mode === "local" ? [archiveName] : [publicGithubUrl];

    memberUserEmail = memberUser.email;

    await loginThroughKeycloak(page, ownerUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    workspaceName = createTimestampedName("Workspace Core E2E");
    const workspace = await createWorkspace(page, {
      name: workspaceName,
      description: "End-to-end workspace for hosted route and source validation.",
    });
    workspaceUrl = workspace.url;
    workspaceId = workspace.id;

    await expect(page.getByTestId("workspace-overview-page")).toBeVisible();
    await expect(page.getByTestId("workspace-overview-open-sources")).toBeVisible();
    await expect(page.getByTestId("workspace-overview-open-runs")).toBeVisible();
    await expect(page.getByTestId("workspace-overview-open-settings")).toBeVisible();
    await expect(page.getByTestId("workspace-overview-open-code")).toBeVisible();

    await page.goto(`/portal/workspaces/${workspaceId}/sources`);
    await expect(page.getByTestId("workspace-sources-page")).toBeVisible();

    if (mode === "local") {
      await addSource(page, {
        prefix: "workspace-sources",
        type: "upload-archive",
        archivePath,
      });
    } else {
      await addSource(page, {
        prefix: "workspace-sources",
        type: "git-public",
        displayName: "Octocat Hello World",
        location: publicGithubUrl,
      });
    }

    await expect(page.getByTestId("workspace-sources-list")).toContainText(primarySourceLabel);

    const primarySource = await resolvePersistedSource(page, {
      workspaceId,
      displayName: primarySourceLabel,
      type: primarySourceType,
      acceptedLocations: primarySourceLocations,
    });
    assert.ok(primarySource);

    await page.goto(`/portal/workspaces/${workspaceId}/runs`);
    await expect(page.getByTestId("workspace-runs-task-description")).toBeVisible();
    await page.getByTestId("workspace-runs-secrets-name-input").fill("Preview login");
    await page.getByTestId("workspace-runs-secrets-kind-select").selectOption("credential-pair");
    await page.getByTestId("workspace-runs-secrets-value-input").fill("{\"username\":\"demo\",\"password\":\"secret\"}");
    await page.getByTestId("workspace-runs-secrets-submit").click();
    await expect(page.getByTestId("workspace-runs-secrets-panel")).toContainText("Preview login");
    await page.getByTestId("workspace-runs-secrets-fieldset").getByRole("checkbox", { name: /Preview login/ }).check();
    await assertAnalysisTaskCatalogEntry(page, {
      taskLabel: deterministicE2eTaskLabel,
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
    });
    const jobId = await queueAiTask(page, {
      prefix: "workspace-runs",
      sourceLabel: primarySourceLabel,
      taskLabel: deterministicE2eTaskLabel,
    });
    jobUrl = page.url();

    reportUrl = await waitForJobSuccess(page);
    const executionAudit = await auditCompletedJobExecution(page, {
      jobId,
      expectedTaskLabel: deterministicE2eTaskLabel,
      expectedSourceLocationPattern: escapeRegex(primarySourceLocations[0]!),
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
      minArtifactCount: 4,
      requireStandardizedHandoff: true,
      allowExecutionFailureBlockers: mode === "local",
    });
    await page.getByTestId("workspace-runs-job-open-report").click();
    await expect(page).toHaveURL(new RegExp(`/portal/workspaces/${workspaceId}/reports/`));
    await expectReportSurface(page, { report: executionAudit.report, canMutate: true });
    await page.getByTestId("report-export-button").click();
    await expect(page.getByTestId("report-export-download-link")).toBeVisible();
    const firstFindingLink = page.locator('[data-testid^="report-open-code-finding-"]').first();
    await expect(firstFindingLink).toBeVisible();
    const codeHref = await firstFindingLink.getAttribute("href");
    assert.ok(codeHref);
    await page.goto(codeHref);
    await expect(page).toHaveURL(new RegExp(`/portal/workspaces/${workspaceId}/code`));
    await expect(page.getByTestId("workspace-code-page")).toBeVisible();
    await expect(page.getByTestId("workspace-code-source-panel")).toBeVisible();
    await expect(page.getByTestId("workspace-code-tree-panel")).toBeVisible();
    await expect(page.getByTestId("workspace-code-findings-panel")).toContainText("Fix handoff entries");
    const treePanel = page.getByTestId("workspace-code-tree-panel");
    await expect(treePanel).toBeVisible();
    const fileHref = await treePanel.locator('[data-testid^="workspace-code-tree-entry-"]').evaluateAll(links => {
      const match = links.find(link => {
        const href = link.getAttribute("href") ?? "";
        return href.includes("path=");
      });
      return match?.getAttribute("href") ?? null;
    });
    assert.ok(fileHref);
    await page.goto(fileHref);
    await expect(page).toHaveURL(/path=/);
    await expect(page.getByTestId("workspace-code-viewer-panel")).toBeVisible();
    await expect(page.locator('[data-testid="workspace-code-file"], [data-testid="workspace-code-diff"]')).toBeVisible();
    await page.goto(reportUrl);

    await page.goto(`/portal/workspaces/${workspaceId}/reports`);
    await expect(page.getByTestId("workspace-reports-list")).toContainText(primarySourceLabel);

    await page.goto(`/portal/workspaces/${workspaceId}/access`);
    await expect(page.getByTestId("workspace-access-page")).toBeVisible();
    await page.getByTestId("workspace-access-add-member-email-input").fill(memberUserEmail);
    await page.getByTestId("workspace-access-add-member-submit").click();
    await expect(page.getByTestId("workspace-access-members-panel")).toContainText(memberUserEmail);

    await page.goto(`/portal/workspaces/${workspaceId}/runs`);
    page.once("dialog", async dialog => {
      await dialog.accept();
    });
    await page.locator('[data-testid^="workspace-runs-secret-delete-"]').first().click();
    await expect(page.getByTestId("workspace-runs-secrets-panel")).not.toContainText("Preview login");
    assert.ok(jobId);
  });

  test("member can access the shared workspace, job, and report surfaces", async ({ browser }) => {
    assert.ok(workspaceUrl, "workspaceUrl must be captured from the owner flow");
    assert.ok(jobUrl, "jobUrl must be captured from the owner flow");
    assert.ok(reportUrl, "reportUrl must be captured from the owner flow");

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginThroughKeycloak(memberPage, memberUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    await memberPage.goto(workspaceUrl);
    await expect(memberPage.getByTestId("workspace-overview-page")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: workspaceName })).toBeVisible();
    await memberPage.goto(`/portal/workspaces/${workspaceId}/code`);
    await expect(memberPage.getByTestId("workspace-code-page")).toBeVisible();
    await expect(memberPage.getByTestId("workspace-code-permissions")).toContainText("read-only");

    await memberPage.goto(jobUrl);
    await expect(memberPage.getByTestId("workspace-runs-job-status")).toContainText("succeeded");

    await memberPage.goto(reportUrl);
    await expectReportSurface(memberPage, { canMutate: false });
    await memberContext.close();
  });

  test("outsider is denied from workspace, job, and report routes", async ({ browser }) => {
    assert.ok(workspaceUrl, "workspaceUrl must be captured from the owner flow");
    assert.ok(jobUrl, "jobUrl must be captured from the owner flow");
    assert.ok(reportUrl, "reportUrl must be captured from the owner flow");

    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await loginThroughKeycloak(outsiderPage, outsiderUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    await outsiderPage.goto(workspaceUrl);
    await expect(outsiderPage.getByTestId("workspace-overview-access-denied")).toBeVisible();

    await outsiderPage.goto(jobUrl);
    await expect(outsiderPage.getByTestId("workspace-runs-job-access-denied")).toBeVisible();

    await outsiderPage.goto(reportUrl);
    await expect(outsiderPage.getByTestId("report-access-denied")).toBeVisible();

    await outsiderPage.goto(`/portal/workspaces/${workspaceId}/code`);
    await expect(outsiderPage.getByTestId("workspace-code-access-denied")).toBeVisible();
    await outsiderContext.close();
  });
});
