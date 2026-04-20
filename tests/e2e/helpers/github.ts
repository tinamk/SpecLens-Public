import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { loginThroughKeycloak } from "./auth";
import { type E2eUser } from "./env";
import { addGithubPrivateRepositorySource, resolvePersistedSource } from "./sources";
import {
  assertAnalysisTaskCatalogEntry,
  deterministicE2eTaskLabel,
  queueAiTask,
  waitForJobStarted,
  waitForJobSuccess,
} from "./runs";
import { createTimestampedWorkspace } from "./workspaces";

export type GithubInstallUrlPayload = {
  installUrl: string;
  state: string;
};

export type GithubPrivateRepoFlowOptions = {
  user: E2eUser;
  installationId: string;
  privateRepoUrl: string;
  privateRepoFullName: string;
  sourceDisplayName: string;
  workspaceNamePrefix: string;
  workspaceDescription: string;
  jobSuccessTimeoutMs?: number;
  requireCompletedAudit?: boolean;
};

export type GithubPrivateRepoFlowResult = {
  acceptedLocations: string[];
  jobId: string;
  jobStatus: "running" | "succeeded";
  reportUrl: string | null;
  workspaceId: string;
  workspaceUrl: string;
};

export function resolveGithubIntegrationEnv(): {
  installationId: string;
  privateRepoFullName: string;
  privateRepoUrl: string;
} {
  return {
    installationId: process.env.E2E_GITHUB_INSTALLATION_ID ?? "",
    privateRepoUrl: process.env.E2E_GITHUB_PRIVATE_REPO_URL ?? "https://github.com/tinamk/tinamk.no",
    privateRepoFullName: process.env.E2E_GITHUB_PRIVATE_REPO_FULL_NAME ?? "tinamk/tinamk.no",
  };
}

export function normalizeGithubRepoUrlVariants(url: string): string[] {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return [];
  }

  const variants = new Set([trimmed]);
  if (trimmed.startsWith("https://github.com/")) {
    variants.add(trimmed.endsWith(".git") ? trimmed.slice(0, -4) : `${trimmed}.git`);
  }
  return [...variants];
}

export function githubLocationPattern(acceptedLocations: string[]): RegExp {
  const escapedLocations = acceptedLocations.map(location => location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escapedLocations.join("|"));
}

function isRetriableGithubJobStartFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Expected job .* ended as failed\./i.test(message)
    && /Failure reason:\s*fetch failed/i.test(message);
}

async function cancelOutstandingGithubPrivateJobs(page: Page, acceptedLocations: string[]): Promise<void> {
  const normalizedLocations = new Set(acceptedLocations.map(location => location.trim().replace(/\/+$/, "")));

  const matchingJobs = await page.evaluate(async accepted => {
    const response = await fetch("/api/proxy/api/jobs");
    if (!response.ok) {
      throw new Error(`Job list request failed with ${response.status}`);
    }
    const payload = await response.json() as {
      jobs?: Array<{
        job: {
          id: string;
          status: string;
          sourceType: string;
          sourceLocation: string;
        };
      }>;
      items?: Array<{
        job: {
          id: string;
          status: string;
          sourceType: string;
          sourceLocation: string;
        };
      }>;
    };
    const acceptedSet = new Set(accepted);
    const jobs = payload.items ?? payload.jobs ?? [];
    return jobs
      .map(entry => entry.job)
      .filter(job =>
        job.sourceType === "github-private"
        && (job.status === "queued" || job.status === "running")
        && acceptedSet.has(job.sourceLocation.trim().replace(/\/+$/, "")),
      );
  }, [...normalizedLocations]);

  for (const job of matchingJobs) {
    await page.evaluate(async jobId => {
      const response = await fetch(`/api/proxy/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`Job cancel request failed for ${jobId} with ${response.status}`);
      }
    }, job.id);
  }

  if (matchingJobs.length === 0) {
    return;
  }

  try {
    await expect
      .poll(async () => {
        const response = await page.evaluate(async accepted => {
          const result = await fetch("/api/proxy/api/jobs");
          if (!result.ok) {
            throw new Error(`Job list request failed with ${result.status}`);
          }
          const payload = await result.json() as {
            jobs?: Array<{
              job: {
                status: string;
                sourceType: string;
                sourceLocation: string;
              };
            }>;
            items?: Array<{
              job: {
                status: string;
                sourceType: string;
                sourceLocation: string;
              };
            }>;
          };
          const acceptedSet = new Set(accepted);
          const jobs = payload.items ?? payload.jobs ?? [];
          return jobs.some(entry =>
            entry.job.sourceType === "github-private"
            && (entry.job.status === "queued" || entry.job.status === "running")
            && acceptedSet.has(entry.job.sourceLocation.trim().replace(/\/+$/, "")),
          );
        }, [...normalizedLocations]);
        return response;
      }, {
        timeout: 30_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .toBe(false);
  } catch {
    console.warn(
      `[e2e:github] proceeding with ${matchingJobs.length} stale GitHub job(s) after cancellation grace period.`,
    );
  }
}

export async function fetchGithubInstallUrl(page: Page, workspaceId: string): Promise<GithubInstallUrlPayload> {
  return await page.evaluate(async currentWorkspaceId => {
    const response = await fetch(`/api/proxy/api/integrations/github/install?workspaceId=${currentWorkspaceId}`);
    if (!response.ok) {
      throw new Error(`GitHub install URL request failed with ${response.status}`);
    }
    return await response.json() as GithubInstallUrlPayload;
  }, workspaceId);
}

export function assertGithubInstallUrlPayload(payload: GithubInstallUrlPayload): void {
  expect(payload.installUrl).toContain("github.com/apps/");
  expect(payload.installUrl).toContain("state=");
  expect(payload.state.length).toBeGreaterThan(10);
}

export async function linkGithubInstallationToWorkspace(
  page: Page,
  options: {
    installationId: string;
    privateRepoFullName: string;
    workspaceId: string;
  },
): Promise<GithubInstallUrlPayload> {
  const installUrlPayload = await fetchGithubInstallUrl(page, options.workspaceId);
  assertGithubInstallUrlPayload(installUrlPayload);

  await page.goto(
    `/auth/github/callback?state=${encodeURIComponent(installUrlPayload.state)}&installation_id=${options.installationId}&setup_action=install`,
  );
  await expect(page).toHaveURL(new RegExp(`/portal/workspaces/${options.workspaceId}/settings\\?github=(connected|updated)`));
  await expect(page.getByTestId("workspace-settings-page")).toBeVisible();
  const githubStatusBanner = page.getByTestId(/workspace-settings-github-(connected|updated)/);
  if (await githubStatusBanner.count() > 0) {
    await expect(githubStatusBanner.first()).toBeVisible();
  }
  await expect(page.getByTestId("workspace-settings-installations")).toContainText(options.installationId);
  await expect(page.getByTestId("workspace-settings-github-repositories")).toContainText(options.privateRepoFullName, {
    timeout: 60_000,
  });

  return installUrlPayload;
}

export async function runGithubPrivateRepoFlow(
  page: Page,
  options: GithubPrivateRepoFlowOptions,
): Promise<GithubPrivateRepoFlowResult> {
  await loginThroughKeycloak(page, options.user, {
    path: "/portal/workspaces",
    expectedUrl: /\/portal\/workspaces/,
  });

  const acceptedLocations = normalizeGithubRepoUrlVariants(options.privateRepoUrl);
  await cancelOutstandingGithubPrivateJobs(page, acceptedLocations);

  const workspace = await createTimestampedWorkspace(page, {
    prefix: options.workspaceNamePrefix,
    description: options.workspaceDescription,
  });

  await linkGithubInstallationToWorkspace(page, {
    workspaceId: workspace.id,
    installationId: options.installationId,
    privateRepoFullName: options.privateRepoFullName,
  });

  await page.goto(`/portal/workspaces/${workspace.id}/sources`);
  await addGithubPrivateRepositorySource(page, {
    prefix: "workspace-sources",
    sourceDisplayName: options.sourceDisplayName,
    privateRepoFullName: options.privateRepoFullName,
  });

  const source = await resolvePersistedSource(page, {
    workspaceId: workspace.id,
    displayName: options.sourceDisplayName,
    type: "github-private",
    acceptedLocations,
  });
  assert.ok(source, "Expected a persisted GitHub private source.");

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`/portal/workspaces/${workspace.id}/runs`);
    await expect(page.getByTestId("workspace-runs-task-description")).toBeVisible();
    await assertAnalysisTaskCatalogEntry(page, {
      taskLabel: deterministicE2eTaskLabel,
      minRoleCount: 1,
      minSkillCount: 1,
      requiredToolCapabilities: ["repo-read"],
    });
    const jobId = await queueAiTask(page, {
      prefix: "workspace-runs",
      sourceLabel: options.sourceDisplayName,
      taskLabel: deterministicE2eTaskLabel,
    });
    try {
      if (options.requireCompletedAudit) {
        const reportUrl = await waitForJobSuccess(page, {
          timeoutMs: options.jobSuccessTimeoutMs,
        });
        return {
          acceptedLocations,
          jobId,
          jobStatus: "succeeded",
          reportUrl,
          workspaceId: workspace.id,
          workspaceUrl: workspace.url,
        };
      }

      const envelope = await waitForJobStarted(page, {
        timeoutMs: options.jobSuccessTimeoutMs,
      });

      return {
        acceptedLocations,
        jobId,
        jobStatus: envelope.job.status === "succeeded" ? "succeeded" : "running",
        reportUrl: envelope.job.status === "succeeded"
          ? await page.getByTestId("workspace-runs-job-open-report").getAttribute("href")
          : null,
        workspaceId: workspace.id,
        workspaceUrl: workspace.url,
      };
    } catch (error) {
      if (attempt === 0 && isRetriableGithubJobStartFailure(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
