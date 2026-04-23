import assert from "node:assert/strict";
import path from "node:path";
import {
  assertGoodAgentReport,
  getStandardizedAgentHandoffFromReport,
  type AiToolCapability,
  type AnalysisLogEvent,
  type AnalysisReport,
  type AnalysisTask,
  type ArtifactReference,
  type JobEnvelope,
} from "@speclens/contracts";
import { expect, type Locator, type Page } from "@playwright/test";
import { refreshPortalSession } from "./auth";
import { jobIdFromUrl, resolveE2eMode } from "./env";

const defaultLocalAuditTaskLabel = "E2E audit smoke agent";
const defaultRemoteAuditTaskLabel = "Universal audit smoke agent";
const defaultLocalRemediationAuditTaskLabel = "E2E remediation audit agent";

export const deterministicE2eTaskLabel = process.env.E2E_ANALYSIS_TASK_LABEL
  ?? (resolveE2eMode() === "local" ? defaultLocalAuditTaskLabel : defaultRemoteAuditTaskLabel);

export const remediationE2eTaskLabel = process.env.E2E_REMEDIATION_ANALYSIS_TASK_LABEL
  ?? (resolveE2eMode() === "local" ? defaultLocalRemediationAuditTaskLabel : deterministicE2eTaskLabel);

const suspiciousExecutionLogPattern = /\b(timed out|timeout|sandbox exited|failed to|unknown .*failure|cancelled during|missing (required|secret|credential|api key|token|env)|could not|unable to|not found|forbidden|unauthorized|must emit|traceback|exception)\b/i;
const executionHealthScopes = new Set([
  "agent",
  "browser",
  "learnables",
  "queue",
  "runner",
  "sandbox",
  "source",
]);
const synthesizedReportRoleIds = new Set([
  "quality-review",
  "capability-review",
  "artifact-auditor",
  "remediation-planner",
  "release-gate-scorer",
]);

type ArtifactDownloadAudit = {
  artifact: ArtifactReference;
  byteLength: number;
  contentType: string;
  json: unknown | null;
  textPreview: string | null;
};

export type JobExecutionAudit = {
  defaultEnvelope: JobEnvelope;
  verboseEnvelope: JobEnvelope;
  report: AnalysisReport;
  jobArtifacts: ArtifactReference[];
  artifactDownloads: ArtifactDownloadAudit[];
};

function resolvePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveJobSuccessTimeoutMs(): number {
  const defaultTimeout = resolveE2eMode() === "production" ? 420_000 : 300_000;
  return resolvePositiveInt(process.env.E2E_JOB_SUCCESS_TIMEOUT_MS, defaultTimeout);
}

function resolveJobSuccessPollMs(): number {
  return resolvePositiveInt(process.env.E2E_JOB_SUCCESS_POLL_MS, 1_000);
}

function formatTerminalJobError(envelope: JobEnvelope): string {
  const reason = envelope.job.failureReason ? ` Failure reason: ${envelope.job.failureReason}` : "";
  return `Expected job ${envelope.job.id} to succeed, but it ended as ${envelope.job.status}.${reason}`;
}

function debugRunAuditStep(step: string): void {
  if (process.env.E2E_DEBUG_RUN_AUDIT === "1") {
    console.error(`[e2e-run-audit] ${step}`);
  }
}

async function selectOptionByLabel(select: Locator, labelText: string): Promise<void> {
  const value = await select.locator("option").evaluateAll((options, expectedLabel) => {
    const normalizedExpected = expectedLabel.trim().toLowerCase();
    const match = options.find(option => {
      const text = option.textContent?.trim().toLowerCase() ?? "";
      return text.includes(normalizedExpected);
    });
    return match?.getAttribute("value") ?? null;
  }, labelText);

  assert.ok(value, `Expected to find a select option containing "${labelText}".`);
  await select.selectOption(value);
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function findTaskByLabel(tasks: AnalysisTask[], label: string): AnalysisTask | undefined {
  const normalized = normalizeLabel(label);
  return tasks.find(task => normalizeLabel(task.title).includes(normalized));
}

function expectedStableArtifactBasenames(jobId: string): string[] {
  return [
    `${jobId}.generated-spec-pack.json`,
    "report.json",
    "report.md",
    "report.html",
  ];
}

function formatLogLines(logs: AnalysisLogEvent[]): string {
  return logs.map(log => `[${log.level}] ${log.scope}: ${log.message}`).join("\n");
}

function ensureReportQuality(
  report: AnalysisReport,
  options: {
    requireStandardizedHandoff?: boolean;
    allowExecutionFailureBlockers?: boolean;
  } = {},
): void {
  assert.ok(report.title.trim().length > 0, "Expected a non-empty report title.");
  assert.ok(report.roles.length > 0, "Expected the report to include at least one role.");
  assert.ok(report.sections.length > 0, "Expected at least one report section.");
  assert.ok(report.sections.some(section => section.status === "ready"), "Expected at least one ready report section.");
  assert.equal(
    report.summary.totalFindings,
    report.findings.length,
    "Report summary totalFindings should match the rendered findings count.",
  );
  const roleIds = new Set(report.roles.map(role => role.id));

  for (const section of report.sections) {
    assert.ok(section.title.trim().length > 0, "Every report section should have a title.");
    assert.ok(section.summary.trim().length > 0, `Section "${section.title}" should have a summary.`);
    assert.ok(
      roleIds.has(section.roleId) || synthesizedReportRoleIds.has(section.roleId),
      `Section "${section.title}" should reference a known or synthesized role.`,
    );
  }

  for (const finding of report.findings) {
    assert.ok(finding.title.trim().length > 0, "Every finding should have a title.");
    assert.ok(finding.message.trim().length > 0, `Finding "${finding.title}" should have a message.`);
    assert.ok(finding.suggestion.trim().length > 0, `Finding "${finding.title}" should have a suggestion.`);
    assert.ok(roleIds.has(finding.roleId), `Finding "${finding.title}" should reference a known role.`);
  }

  const hasStandardizedHandoff = report.sections.some(section => section.title === "Standardized JSON handoff");
  if (options.requireStandardizedHandoff) {
    assert.ok(hasStandardizedHandoff, "Expected a Standardized JSON handoff section for this report.");
  }
  if (hasStandardizedHandoff) {
    const allowExecutionFailureBlockers = report.runtimeMode === "static" || options.allowExecutionFailureBlockers === true;
    if (allowExecutionFailureBlockers) {
      getStandardizedAgentHandoffFromReport(report);
    } else {
      assertGoodAgentReport(report);
    }
  }
}

function assertHealthyLogs(logs: AnalysisLogEvent[], label: string): void {
  const relevantLogs = logs.filter(log => executionHealthScopes.has(log.scope));
  const errorLogs = relevantLogs.filter(log => log.level === "error");
  assert.equal(
    errorLogs.length,
    0,
    `${label} log stream contained error-level output.\n${formatLogLines(errorLogs)}`,
  );

  const suspiciousLogs = relevantLogs.filter(log => suspiciousExecutionLogPattern.test(log.message));
  assert.equal(
    suspiciousLogs.length,
    0,
    `${label} log stream contained suspicious execution warnings.\n${formatLogLines(suspiciousLogs)}`,
  );
}

function assertAgentLifecycle(
  logs: AnalysisLogEvent[],
  executionSteps: JobEnvelope["executionSteps"],
  learnableCount: number,
): void {
  const hasCompletionLog = logs.some(log => /Agent completed \d+ roles?\./i.test(log.message));
  const hasCompletedExecutionTimeline = executionSteps.length > 0
    && executionSteps.some(step => step.stepType === "role" && step.status === "succeeded")
    && executionSteps.every(step => step.status !== "running");
  assert.ok(
    hasCompletionLog || hasCompletedExecutionTimeline,
    "Expected the agent execution evidence to show a completed role timeline.",
  );

  const hasLearnablesLog = logs.some(log => /Stored \d+ learnable\(s\) for future runs\./i.test(log.message));
  assert.ok(
    hasLearnablesLog || learnableCount > 0,
    "Expected the completed run to persist learnables or log learnable storage.",
  );
}

async function buildCookieHeader(page: Page, targetUrl: string): Promise<string> {
  const cookies = await page.context().cookies(targetUrl);
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

function isExpiredPortalSessionResponse(status: number, body: string): boolean {
  return status === 401 && /claim timestamp check failed|token expired|expired/i.test(body);
}

function isRetriableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

function resolveRateLimitRetryMs(response: Response, body: string, attempt: number): number | null {
  if (response.status !== 429) {
    return null;
  }
  const headerValue = response.headers.get("retry-after");
  const headerSeconds = Number.parseInt(headerValue ?? "", 10);
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return (headerSeconds + 1) * 1_000;
  }
  const bodySeconds = Number.parseInt(body.match(/retry in (\d+) seconds/i)?.[1] ?? "", 10);
  if (Number.isFinite(bodySeconds) && bodySeconds > 0) {
    return (bodySeconds + 1) * 1_000;
  }
  return attempt * 1_000;
}

async function fetchAuthed(
  page: Page,
  pathname: string,
  init?: RequestInit,
  allowSessionRefresh = true,
  attempt = 1,
): Promise<Response> {
  const base = page.url().startsWith("http")
    ? page.url()
    : process.env.PLAYWRIGHT_BASE_URL
      ?? process.env.E2E_BASE_URL
      ?? "http://localhost:3300";
  const url = new URL(pathname, base);
  const cookieHeader = await buildCookieHeader(page, url.toString());
  const headers = new Headers(init?.headers);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      redirect: "follow",
    });
  } catch (error) {
    if (attempt < 3 && isRetriableFetchError(error)) {
      await page.waitForTimeout(1_000 * attempt);
      return await fetchAuthed(page, pathname, init, allowSessionRefresh, attempt + 1);
    }
    throw error;
  }
  if (allowSessionRefresh && response.status === 401) {
    const body = await response.text();
    if (isExpiredPortalSessionResponse(response.status, body)) {
      await refreshPortalSession(page);
      return await fetchAuthed(page, pathname, init, false, attempt);
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}

async function fetchApiJson<T>(page: Page, pathname: string, allowSessionRefresh = true, attempt = 1): Promise<T> {
  const response = await fetchAuthed(page, pathname);
  if (!response.ok) {
    const body = await response.text();
    const retryMs = resolveRateLimitRetryMs(response, body, attempt);
    if (retryMs != null && attempt < 4) {
      await page.waitForTimeout(retryMs);
      return await fetchApiJson<T>(page, pathname, allowSessionRefresh, attempt + 1);
    }
    if (allowSessionRefresh && isExpiredPortalSessionResponse(response.status, body)) {
      await refreshPortalSession(page);
      return await fetchApiJson<T>(page, pathname, false, attempt);
    }
    throw new Error(`Request failed for ${pathname}: ${response.status} ${body}`);
  }
  return await response.json() as T;
}

async function downloadArtifactAudit(
  page: Page,
  jobId: string,
  artifactIndex: number,
  artifact: ArtifactReference,
  allowSessionRefresh = true,
  attempt = 1,
): Promise<ArtifactDownloadAudit> {
  const response = await fetchAuthed(page, `/api/proxy/api/jobs/${jobId}/artifacts/${artifactIndex}`);
  if (!response.ok) {
    const body = await response.text();
    const retryMs = resolveRateLimitRetryMs(response, body, attempt);
    if (retryMs != null && attempt < 4) {
      await page.waitForTimeout(retryMs);
      return await downloadArtifactAudit(page, jobId, artifactIndex, artifact, allowSessionRefresh, attempt + 1);
    }
    if (allowSessionRefresh && isExpiredPortalSessionResponse(response.status, body)) {
      await refreshPortalSession(page);
      return await downloadArtifactAudit(page, jobId, artifactIndex, artifact, false, attempt);
    }
    throw new Error(`Artifact download failed for ${artifact.key}: ${response.status} ${body}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let byteLength = 0;
  let json: unknown | null = null;
  let textPreview: string | null = null;

  if (
    contentType.includes("application/json")
    || contentType.startsWith("text/")
    || contentType.includes("markdown")
    || contentType.includes("html")
  ) {
    const text = await response.text();
    byteLength = Buffer.byteLength(text);
    textPreview = text.slice(0, 400);
    if (contentType.includes("application/json")) {
      json = JSON.parse(text);
    }
  } else {
    const bytes = await response.arrayBuffer();
    byteLength = bytes.byteLength;
  }

  assert.ok(byteLength > 0, `Artifact ${artifact.key} should download non-empty content.`);
  assert.ok(contentType.length > 0, `Artifact ${artifact.key} should have a content-type.`);

  return {
    artifact,
    byteLength,
    contentType,
    json,
    textPreview,
  };
}

export async function fetchAnalysisTasks(page: Page): Promise<AnalysisTask[]> {
  const payload = await fetchApiJson<{ tasks: AnalysisTask[] }>(page, "/api/proxy/api/analysis-tasks");
  return payload.tasks;
}

export async function fetchHostedJobEnvelope(
  page: Page,
  jobId: string,
  verbosity: "default" | "verbose" = "default",
): Promise<JobEnvelope> {
  const payload = await fetchApiJson<{ job: JobEnvelope }>(page, `/api/proxy/api/jobs/${jobId}?verbosity=${verbosity}`);
  return payload.job;
}

export async function fetchJobArtifacts(page: Page, jobId: string): Promise<ArtifactReference[]> {
  const payload = await fetchApiJson<{ artifacts: ArtifactReference[] }>(page, `/api/proxy/api/jobs/${jobId}/artifacts`);
  return payload.artifacts;
}

export async function cancelJob(
  page: Page,
  jobId: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<JobEnvelope> {
  const response = await fetchAuthed(page, `/api/proxy/api/jobs/${jobId}/cancel`, { method: "POST" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Job cancel request failed for ${jobId}: ${response.status} ${body}`);
  }

  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? resolveJobSuccessPollMs();
  const deadline = Date.now() + timeoutMs;
  let envelope = await fetchHostedJobEnvelope(page, jobId, "default");
  while (
    envelope.job.status !== "cancelled"
    && envelope.job.status !== "failed"
    && envelope.job.status !== "succeeded"
    && Date.now() < deadline
  ) {
    await page.waitForTimeout(pollMs);
    envelope = await fetchHostedJobEnvelope(page, jobId, "default");
  }

  assert.notEqual(
    envelope.job.status,
    "queued",
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} to honor cancellation. Last observed status: queued.`,
  );
  assert.notEqual(
    envelope.job.status,
    "running",
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} to honor cancellation. Last observed status: running.`,
  );
  return envelope;
}

export async function assertAnalysisTaskCatalogEntry(
  page: Page,
  options: {
    taskLabel: string;
    minRoleCount?: number;
    minSkillCount?: number;
    requiredToolCapabilities?: AiToolCapability[];
  },
): Promise<AnalysisTask> {
  const tasks = await fetchAnalysisTasks(page);
  const task = findTaskByLabel(tasks, options.taskLabel);
  assert.ok(task, `Expected to find an analysis task matching "${options.taskLabel}".`);
  assert.ok(
    task.roleCount >= (options.minRoleCount ?? 1),
    `Task "${task.title}" should expose at least ${options.minRoleCount ?? 1} role(s).`,
  );
  assert.ok(
    task.skillNames.length >= (options.minSkillCount ?? 1),
    `Task "${task.title}" should expose at least ${options.minSkillCount ?? 1} skill(s).`,
  );
  for (const capability of options.requiredToolCapabilities ?? ["repo-read"]) {
    assert.ok(
      task.toolCapabilities.includes(capability),
      `Task "${task.title}" should include the "${capability}" capability.`,
    );
  }
  return task;
}

export async function queueAiTask(
  page: Page,
  options: {
    prefix?: string;
    sourceLabel?: string;
    companionSourceLabel?: string;
    taskLabel?: string;
    runtimeMode?: "static" | "browser";
  } = {},
): Promise<string> {
  const prefix = options.prefix ?? "workspace-runs";
  if (options.sourceLabel) {
    await selectOptionByLabel(page.getByTestId(`${prefix}-source-select`), options.sourceLabel);
  }
  if (options.companionSourceLabel) {
    await selectOptionByLabel(page.getByTestId(`${prefix}-companion-source-select`), options.companionSourceLabel);
  }
  if (options.taskLabel) {
    await selectOptionByLabel(page.getByTestId(`${prefix}-task-select`), options.taskLabel);
  }
  if (options.runtimeMode) {
    await page.getByTestId(`${prefix}-runtime-mode-select`).selectOption(options.runtimeMode);
  }

  await page.getByTestId(`${prefix}-submit`).click();
  await page.waitForURL(/\/runs\/[^/]+$/);
  return jobIdFromUrl(page.url());
}

export async function waitForJobSuccess(
  page: Page,
  options: {
    prefix?: string;
    reportButtonTestId?: string;
    jobId?: string;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<string> {
  const prefix = options.prefix ?? "workspace-runs-job";
  const jobId = options.jobId ?? jobIdFromUrl(page.url());
  const timeoutMs = options.timeoutMs ?? resolveJobSuccessTimeoutMs();
  const pollMs = options.pollMs ?? resolveJobSuccessPollMs();
  const status = page.getByTestId(`${prefix}-status`);
  await expect(status).toBeVisible();
  const deadline = Date.now() + timeoutMs;
  let envelope = await fetchHostedJobEnvelope(page, jobId, "default");
  while (
    envelope.job.status !== "succeeded"
    && envelope.job.status !== "failed"
    && envelope.job.status !== "cancelled"
    && Date.now() < deadline
  ) {
    await page.waitForTimeout(pollMs);
    envelope = await fetchHostedJobEnvelope(page, jobId, "default");
  }

  assert.notEqual(
    envelope.job.status,
    "queued",
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} to reach a terminal state. Last observed status: queued.`,
  );
  assert.notEqual(
    envelope.job.status,
    "running",
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} to reach a terminal state. Last observed status: running.`,
  );
  assert.equal(envelope.job.status, "succeeded", formatTerminalJobError(envelope));

  await page.reload({ waitUntil: "networkidle" });
  await expect(status).toContainText("succeeded", { timeout: 30_000 });
  const reportLink = page.getByTestId(options.reportButtonTestId ?? "workspace-runs-job-open-report");
  await expect(reportLink).toBeVisible({ timeout: 30_000 });
  const href = await reportLink.getAttribute("href");
  assert.ok(href, "Expected a report link after the job succeeded.");
  return href;
}

export async function waitForJobStarted(
  page: Page,
  options: {
    prefix?: string;
    jobId?: string;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<JobEnvelope> {
  const prefix = options.prefix ?? "workspace-runs-job";
  const jobId = options.jobId ?? jobIdFromUrl(page.url());
  const timeoutMs = options.timeoutMs ?? resolvePositiveInt(process.env.E2E_JOB_START_TIMEOUT_MS, 180_000);
  const pollMs = options.pollMs ?? resolveJobSuccessPollMs();
  const status = page.getByTestId(`${prefix}-status`);
  await expect(status).toBeVisible();
  const deadline = Date.now() + timeoutMs;
  let envelope = await fetchHostedJobEnvelope(page, jobId, "default");
  while (envelope.job.status === "queued" && Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    envelope = await fetchHostedJobEnvelope(page, jobId, "default");
  }

  assert.notEqual(
    envelope.job.status,
    "queued",
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} to leave the queue. Last observed status: queued.`,
  );
  assert.notEqual(envelope.job.status, "failed", formatTerminalJobError(envelope));
  assert.notEqual(envelope.job.status, "cancelled", formatTerminalJobError(envelope));

  await page.reload({ waitUntil: "networkidle" });
  const refreshedEnvelope = await fetchHostedJobEnvelope(page, jobId, "default");
  assert.notEqual(refreshedEnvelope.job.status, "failed", formatTerminalJobError(refreshedEnvelope));
  assert.notEqual(refreshedEnvelope.job.status, "cancelled", formatTerminalJobError(refreshedEnvelope));
  await expect(status).toContainText(refreshedEnvelope.job.status, { timeout: 30_000 });
  return refreshedEnvelope;
}

export async function expectJobPlanVisible(
  page: Page,
  options: {
    prefix?: string;
    expectedMinimumSteps?: number;
  } = {},
): Promise<void> {
  const prefix = options.prefix ?? "workspace-runs-job";
  const steps = page.locator(`[data-testid^="${prefix}-step-"]`);
  await expect(steps.first()).toBeVisible();
  const count = await steps.count();
  assert.ok(
    count >= (options.expectedMinimumSteps ?? 1),
    `Expected at least ${options.expectedMinimumSteps ?? 1} visible execution step card(s), found ${count}.`,
  );
}

export async function expectJobConsoleControls(page: Page, prefix = "workspace-runs-job"): Promise<void> {
  await expect(page.getByTestId(`${prefix}-verbosity-default`)).toBeVisible();
  await expect(page.getByTestId(`${prefix}-verbosity-verbose`)).toBeVisible();
}

export async function auditCompletedJobExecution(
  page: Page,
  options: {
    jobId: string;
    expectedTaskLabel?: string;
    expectedSourceLocationPattern?: RegExp;
    minRoleCount?: number;
    minSkillCount?: number;
    requiredToolCapabilities?: AiToolCapability[];
    minArtifactCount?: number;
    requireStandardizedHandoff?: boolean;
    allowExecutionFailureBlockers?: boolean;
  },
): Promise<JobExecutionAudit> {
  debugRunAuditStep(`begin job=${options.jobId}`);
  await expect(page.getByTestId("workspace-runs-job-page")).toBeVisible();
  await expect(page.getByTestId("workspace-runs-job-metadata")).toBeVisible();
  await expect(page.getByTestId("workspace-runs-job-log-console")).toBeVisible();
  await expect(page.getByTestId("workspace-runs-job-learnables")).toBeVisible();
  await expectJobConsoleControls(page);
  debugRunAuditStep("page shell visible");

  if (options.expectedTaskLabel) {
    const task = await assertAnalysisTaskCatalogEntry(page, {
      taskLabel: options.expectedTaskLabel,
      minRoleCount: options.minRoleCount,
      minSkillCount: options.minSkillCount,
      requiredToolCapabilities: options.requiredToolCapabilities,
    });
    await expect(page.getByTestId("workspace-runs-job-task")).toContainText(task.title);
    debugRunAuditStep(`task verified title=${task.title}`);
  }

  await page.getByTestId("workspace-runs-job-verbosity-verbose").click();
  await expect(page.getByText(/Showing the full verbose trace, including raw Codex and shell output\./)).toBeVisible();
  const verboseEnvelope = await fetchHostedJobEnvelope(page, options.jobId, "verbose");
  debugRunAuditStep(`verbose envelope status=${verboseEnvelope.job.status} logs=${verboseEnvelope.logs.length}`);

  await page.getByTestId("workspace-runs-job-verbosity-default").click();
  await expect(page.getByText(/Showing role progress, summaries, findings, blockers, and learnables activity\./)).toBeVisible();
  const defaultEnvelope = await fetchHostedJobEnvelope(page, options.jobId, "default");
  debugRunAuditStep(`default envelope status=${defaultEnvelope.job.status} logs=${defaultEnvelope.logs.length}`);

  assert.equal(defaultEnvelope.job.status, "succeeded", "Expected a succeeded job envelope.");
  assert.equal(verboseEnvelope.job.status, "succeeded", "Expected a succeeded verbose job envelope.");
  assert.ok(defaultEnvelope.job.startedAt, "Expected the job to record a startedAt timestamp.");
  assert.ok(defaultEnvelope.job.finishedAt, "Expected the job to record a finishedAt timestamp.");
  assert.equal(defaultEnvelope.job.failureReason, null, "A succeeded job should not retain a failureReason.");
  assert.ok(defaultEnvelope.logs.length > 0, "Expected default job logs to be present.");

  if (options.expectedSourceLocationPattern) {
    assert.match(
      defaultEnvelope.job.sourceLocation,
      options.expectedSourceLocationPattern,
      `Job source location did not match ${options.expectedSourceLocationPattern}.`,
    );
    await expect(page.getByTestId("workspace-runs-job-source")).toContainText(options.expectedSourceLocationPattern);
    debugRunAuditStep("source verified");
  }

  const learnableCount = await page.locator('[data-testid^="workspace-runs-job-learnable-"]').count();
  assert.ok(learnableCount > 0, "Expected the completed run to store at least one learnable.");
  debugRunAuditStep(`learnables count=${learnableCount}`);

  assertHealthyLogs(defaultEnvelope.logs, "Default");
  assertHealthyLogs(verboseEnvelope.logs, "Verbose");
  debugRunAuditStep("logs healthy");

  assertAgentLifecycle([...defaultEnvelope.logs, ...verboseEnvelope.logs], defaultEnvelope.executionSteps, learnableCount);
  debugRunAuditStep("agent lifecycle verified");

  assert.ok(defaultEnvelope.report, "Expected a report to be attached to the succeeded job.");
  const report = defaultEnvelope.report;
  ensureReportQuality(report, {
    requireStandardizedHandoff: options.requireStandardizedHandoff,
    allowExecutionFailureBlockers: options.allowExecutionFailureBlockers,
  });
  debugRunAuditStep(`report quality verified artifacts=${report.artifacts.length}`);
  if (options.minRoleCount) {
    assert.ok(
      report.roles.length >= options.minRoleCount,
      `Expected the report to record at least ${options.minRoleCount} executed role(s).`,
    );
  }
  assert.ok(
    report.artifacts.length >= (options.minArtifactCount ?? 4),
    `Expected the report to expose at least ${options.minArtifactCount ?? 4} artifact reference(s).`,
  );

  const jobArtifacts = await fetchJobArtifacts(page, options.jobId);
  debugRunAuditStep(`job artifacts listed count=${jobArtifacts.length}`);
  assert.ok(
    jobArtifacts.length >= Math.max(options.minArtifactCount ?? 4, report.artifacts.length),
    `Expected at least ${Math.max(options.minArtifactCount ?? 4, report.artifacts.length)} job artifacts.`,
  );

  const jobArtifactKeys = new Set(jobArtifacts.map(artifact => artifact.key));
  for (const artifact of report.artifacts) {
    assert.ok(
      jobArtifactKeys.has(artifact.key),
      `Expected report artifact ${artifact.key} to be present in the job artifact inventory.`,
    );
  }

  const stableBasenames = new Set(jobArtifacts.map(artifact => path.posix.basename(artifact.key)));
  for (const basename of expectedStableArtifactBasenames(options.jobId)) {
    assert.ok(
      stableBasenames.has(basename),
      `Expected stable artifact ${basename} to be present in the job outputs.`,
    );
  }

  const artifactDownloads: ArtifactDownloadAudit[] = [];
  for (const [index, artifact] of jobArtifacts.entries()) {
    artifactDownloads.push(await downloadArtifactAudit(page, options.jobId, index, artifact));
    debugRunAuditStep(`artifact downloaded index=${index} key=${artifact.key}`);
  }

  const stableDownloads = new Map(
    artifactDownloads.map(download => [path.posix.basename(download.artifact.key), download]),
  );
  const generatedPack = stableDownloads.get(`${options.jobId}.generated-spec-pack.json`);
  assert.ok(generatedPack?.json, "Expected the generated spec pack artifact to be valid JSON.");

  const reportJson = stableDownloads.get("report.json");
  assert.ok(reportJson?.json && typeof reportJson.json === "object", "Expected report.json to be valid JSON.");
  assert.equal(
    (reportJson?.json as { id?: string; title?: string }).id,
    report.id,
    "report.json should match the API report id.",
  );
  assert.equal(
    (reportJson?.json as { id?: string; title?: string }).title,
    report.title,
    "report.json should match the API report title.",
  );

  const reportMarkdown = stableDownloads.get("report.md");
  assert.ok(
    reportMarkdown?.textPreview?.includes(report.title),
    "report.md should include the rendered report title.",
  );

  const reportHtml = stableDownloads.get("report.html");
  assert.ok(
    reportHtml?.textPreview && /<!doctype html|<html/i.test(reportHtml.textPreview),
    "report.html should download HTML content.",
  );
  debugRunAuditStep("audit complete");

  return {
    defaultEnvelope,
    verboseEnvelope,
    report,
    jobArtifacts,
    artifactDownloads,
  };
}
