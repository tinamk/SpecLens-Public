import assert from "node:assert/strict";
import type { AnalysisReport } from "@speclens/contracts";
import { expect, type Page } from "@playwright/test";
import { jobIdFromUrl } from "./env";

export async function expectReportSurface(
  page: Page,
  options: {
    report?: AnalysisReport;
    canMutate?: boolean;
  } = {},
): Promise<void> {
  await expect(page.getByTestId("workspace-report-page")).toBeVisible();
  await expect(page.getByTestId("report-hero")).toBeVisible();
  await expect(page.getByTestId("report-artifacts-panel")).toBeVisible();
  await expect(page.getByTestId("report-remediation-panel")).toBeVisible();
  if (options.canMutate ?? true) {
    await expect(page.getByTestId("report-remediation-form")).toBeVisible();
    await expect(page.getByTestId("report-remediation-submit")).toBeVisible();
  } else {
    await expect(page.getByTestId("report-remediation-read-only")).toBeVisible();
  }

  const report = options.report;
  if (!report) {
    return;
  }

  await expect(page.getByTestId("report-hero").getByRole("heading", { name: report.title })).toBeVisible();
  await expect(page.getByTestId("report-summary-total")).toContainText(String(report.summary.totalFindings));
  await expect(page.getByTestId("report-summary-high")).toContainText(String(report.summary.high));
  await expect(page.getByTestId("report-summary-medium")).toContainText(String(report.summary.medium));
  await expect(page.getByTestId("report-summary-low")).toContainText(String(report.summary.low));

  await expect(page.locator('[data-testid^="report-section-"]')).toHaveCount(report.sections.length);
  await expect(page.locator('[data-testid^="report-finding-"]')).toHaveCount(report.findings.length);
  await expect(page.locator('[data-testid^="report-artifact-"]')).toHaveCount(report.artifacts.length);
  for (const [index, artifact] of report.artifacts.entries()) {
    await expect(page.getByTestId(`report-artifact-${index}`)).toContainText(artifact.key);
    await expect(page.getByTestId(`report-download-artifact-${index}`)).toBeVisible();
  }
}

export async function queueRemediationFromReport(page: Page): Promise<string> {
  await expect(page.getByTestId("report-remediation-form")).toBeVisible();
  await page.getByTestId("report-remediation-submit").click();
  await page.waitForURL(/\/portal\/workspaces\/[^/]+\/runs\/[^/]+$/);
  const remediationJobId = jobIdFromUrl(page.url());
  assert.ok(remediationJobId, "Expected remediation queueing to redirect to a run detail URL.");
  return remediationJobId;
}
