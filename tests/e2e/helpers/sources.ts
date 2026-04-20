import assert from "node:assert/strict";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createCommittedGitArchiveFixture } from "../../helpers/git-fixtures";
import { fetchWorkspaceSnapshot, type WorkspaceSourceSnapshot } from "./workspaces";

export function createArchiveFixture(override = process.env.E2E_UPLOAD_ARCHIVE_PATH ?? ""): string {
  if (override) {
    return override;
  }
  return createCommittedGitArchiveFixture(path.resolve(process.cwd(), "fixtures", "tagtwo-mini")).archivePath;
}

export async function addSource(
  page: Page,
  options: {
    prefix: string;
    type: "upload-archive" | "git-public";
    displayName?: string;
    location?: string;
    archivePath?: string;
  },
): Promise<void> {
  const successLocator = page.getByTestId(`${options.prefix}-success`);
  const errorLocator = page.getByTestId(`${options.prefix}-error`);
  await page.getByTestId(`${options.prefix}-type-select`).selectOption(options.type);
  if (options.type === "upload-archive") {
    assert.ok(options.archivePath, "archivePath is required for upload-archive sources.");
    await page.getByTestId(`${options.prefix}-archive-input`).setInputFiles(options.archivePath);
  } else {
    assert.ok(options.displayName, "displayName is required for non-upload sources.");
    assert.ok(options.location, "location is required for non-upload sources.");
    await page.getByTestId(`${options.prefix}-display-name-input`).fill(options.displayName);
    await page.getByTestId(`${options.prefix}-location-input`).fill(options.location);
  }
  await page.getByTestId(`${options.prefix}-submit`).click();
  const result = await Promise.race([
    successLocator.waitFor({ state: "visible", timeout: 30_000 }).then(() => "success" as const),
    errorLocator.waitFor({ state: "visible", timeout: 30_000 }).then(() => "error" as const),
  ]);
  if (result === "error") {
    throw new Error((await errorLocator.textContent())?.trim() || "Source creation failed.");
  }
}

export async function addGithubPrivateRepositorySource(
  page: Page,
  options: {
    prefix: string;
    privateRepoFullName: string;
    sourceDisplayName: string;
  },
): Promise<void> {
  const successLocator = page.getByTestId(`${options.prefix}-success`);
  const errorLocator = page.getByTestId(`${options.prefix}-error`);
  await page.getByTestId(`${options.prefix}-type-select`).selectOption("github-private");
  await page.getByTestId(`${options.prefix}-display-name-input`).fill(options.sourceDisplayName);
  await expect(page.getByTestId(`${options.prefix}-github-repository-select`)).toBeVisible();
  await page.getByTestId(`${options.prefix}-github-repository-select`).selectOption({ label: options.privateRepoFullName });
  await page.getByTestId(`${options.prefix}-submit`).click();
  const result = await Promise.race([
    successLocator.waitFor({ state: "visible", timeout: 30_000 }).then(() => "success" as const),
    errorLocator.waitFor({ state: "visible", timeout: 30_000 }).then(() => "error" as const),
  ]);
  if (result === "error") {
    throw new Error((await errorLocator.textContent())?.trim() || "GitHub source creation failed.");
  }
  await expect(successLocator).toContainText(options.sourceDisplayName, { timeout: 30_000 });
}

export async function resolvePersistedSource(
  page: Page,
  options: {
    workspaceId: string;
    displayName: string;
    type: string;
    acceptedLocations: string[];
  },
): Promise<WorkspaceSourceSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const workspaceSnapshot = await fetchWorkspaceSnapshot(page, options.workspaceId);
    const source = workspaceSnapshot.sources.find(candidate =>
      candidate.type === options.type
      && candidate.displayName === options.displayName
      && options.acceptedLocations.includes(candidate.location),
    );
    if (!source) {
      await page.waitForTimeout(500);
      continue;
    }
    if (source.verificationStatus === "pending") {
      await page.waitForTimeout(500);
      continue;
    }
    if (source.verificationStatus === "failed") {
      throw new Error(source.verificationError || `Source verification failed for ${source.displayName}.`);
    }
    return source;
  }
  assert.fail("Expected the new source to be persisted and verified on the workspace.");
}
