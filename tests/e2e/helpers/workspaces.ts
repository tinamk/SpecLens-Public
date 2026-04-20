import assert from "node:assert/strict";
import { type Page } from "@playwright/test";
import { createTimestampedName, workspaceIdFromUrl } from "./env";

export type WorkspaceSourceSnapshot = {
  id: string;
  displayName: string;
  location: string;
  type: string;
  verificationStatus: string;
  verificationError: string | null;
};

export type WorkspaceSnapshot = {
  sources: WorkspaceSourceSnapshot[];
};

export async function createWorkspace(
  page: Page,
  options: {
    name: string;
    description: string;
  },
): Promise<{ id: string; url: string }> {
  await page.getByTestId("workspace-index-name-input").fill(options.name);
  await page.getByTestId("workspace-index-description-input").fill(options.description);
  await page.getByTestId("workspace-index-submit").click();
  await page.waitForURL(/\/portal\/workspaces\/[^/]+$/);

  const url = page.url();
  return {
    id: workspaceIdFromUrl(url),
    url,
  };
}

export async function createTimestampedWorkspace(
  page: Page,
  options: {
    prefix: string;
    description: string;
  },
): Promise<{ id: string; url: string; name: string }> {
  const name = createTimestampedName(options.prefix);
  const workspace = await createWorkspace(page, {
    name,
    description: options.description,
  });
  return {
    ...workspace,
    name,
  };
}

export async function fetchWorkspaceSnapshot(page: Page, workspaceId: string): Promise<WorkspaceSnapshot> {
  return await page.evaluate(async currentWorkspaceId => {
    const response = await fetch(`/api/proxy/api/workspaces/${currentWorkspaceId}`);
    if (!response.ok) {
      throw new Error(`Workspace fetch failed with ${response.status}`);
    }
    const payload = await response.json();
    const sources = Array.isArray(payload.sources)
      ? payload.sources
      : Array.isArray(payload.workspace?.sources)
        ? payload.workspace.sources
        : [];
    return {
      sources: sources.map((source: {
        id: string;
        displayName: string;
        location: string;
        type: string;
        verificationStatus?: string;
        verificationError?: string | null;
      }) => ({
        id: source.id,
        displayName: source.displayName,
        location: source.location,
        type: source.type,
        verificationStatus: typeof source.verificationStatus === "string" ? source.verificationStatus : "verified",
        verificationError: typeof source.verificationError === "string" ? source.verificationError : null,
      })),
    };
  }, workspaceId);
}

export async function addWorkspaceMember(page: Page, workspaceId: string, email: string): Promise<void> {
  const membershipResult = await page.evaluate(async ({ currentWorkspaceId, currentEmail }) => {
    const response = await fetch(`/api/proxy/api/workspaces/${currentWorkspaceId}/members`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: currentEmail }),
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, {
    currentWorkspaceId: workspaceId,
    currentEmail: email,
  });
  assert.ok(membershipResult.ok, `membership request failed: ${membershipResult.status} ${membershipResult.text}`);
}
