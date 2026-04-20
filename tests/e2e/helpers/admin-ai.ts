import assert from "node:assert/strict";
import { expect, type Locator, type Page } from "@playwright/test";

function formByName(page: Page, prefix: string, name: string) {
  return page.locator(`[data-testid^="${prefix}"]`).filter({
    has: page.locator(`input[name="name"][value="${name}"]`),
  }).first();
}

function pageTestIdForPrefix(prefix: string): string {
  switch (prefix) {
    case "admin-ai-skill-form-":
      return "admin-ai-skills-page";
    case "admin-ai-role-form-":
      return "admin-ai-roles-page";
    case "admin-ai-agent-form-":
      return "admin-ai-agents-page";
    default:
      throw new Error(`Unsupported admin form prefix: ${prefix}`);
  }
}

async function recoverAdminPage(page: Page, pageTestId: string): Promise<void> {
  const applicationError = page.getByRole("heading", { name: /Application error:/ });
  const pageMarker = page.getByTestId(pageTestId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await applicationError.count() === 0) {
      try {
        await expect(pageMarker).toBeVisible({ timeout: 5_000 });
        return;
      } catch {
        // Fall through to a reload below.
      }
    }
    if (!(await waitForRateLimitCooldown(page))) {
      await page.waitForTimeout((attempt + 1) * 2_000);
    }
    await page.reload({ waitUntil: "networkidle" });
  }
  await expect(applicationError).toHaveCount(0);
  await expect(pageMarker).toBeVisible();
}

async function recoverMutationAttempt(page: Page, pageTestId: string, attempt: number): Promise<void> {
  if (!(await waitForRateLimitCooldown(page))) {
    await page.waitForTimeout((attempt + 1) * 1_000);
    await page.reload({ waitUntil: "networkidle" });
  }
  await recoverAdminPage(page, pageTestId);
}

async function expectNamedFormVisible(page: Page, prefix: string, name: string): Promise<Locator> {
  const pageTestId = pageTestIdForPrefix(prefix);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await recoverAdminPage(page, pageTestId);
    const form = formByName(page, prefix, name);
    if (await form.count() > 0) {
      await expect(form).toBeVisible();
      return form;
    }
    if (attempt < 3) {
      await recoverMutationAttempt(page, pageTestId, attempt);
    }
  }
  const form = formByName(page, prefix, name);
  await expect(form).toBeVisible();
  return form;
}

async function waitForRateLimitCooldown(page: Page): Promise<boolean> {
  const alert = page.getByRole("alert").filter({ hasText: /Rate limit exceeded/i }).last();
  if (await alert.count() === 0) {
    return false;
  }
  const text = await alert.textContent() ?? "";
  const retrySeconds = Number.parseInt(text.match(/retry in (\d+) seconds/i)?.[1] ?? "", 10);
  if (!Number.isFinite(retrySeconds) || retrySeconds <= 0) {
    return false;
  }
  await page.waitForTimeout((retrySeconds + 1) * 1000);
  await page.reload({ waitUntil: "networkidle" });
  return true;
}

async function deleteNamedForm(
  page: Page,
  prefix: string,
  name: string,
  deleteButtonTestId: RegExp,
): Promise<void> {
  const pageTestId = pageTestIdForPrefix(prefix);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await recoverAdminPage(page, pageTestId);
    const form = formByName(page, prefix, name);
    if (await form.count() === 0) {
      return;
    }
    await expect(form).toBeVisible();
    await form.getByTestId(deleteButtonTestId).click();
    try {
      await expect(form).toHaveCount(0, { timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }
      await recoverMutationAttempt(page, pageTestId, attempt);
    }
  }
}

export async function createSkill(page: Page, options: {
  name: string;
  description: string;
  instructions: string;
}): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await recoverAdminPage(page, "admin-ai-skills-page");
    const existing = formByName(page, "admin-ai-skill-form-", options.name);
    if (await existing.count() > 0) {
      await expect(existing).toBeVisible();
      return;
    }
    const form = page.getByTestId("admin-ai-skill-create-form");
    await form.locator('input[name="name"]').fill(options.name);
    await form.locator('input[name="description"]').fill(options.description);
    await form.locator('textarea[name="instructions"]').fill(options.instructions);
    await form.locator('select[name="toolCapabilities"]').selectOption(["repo-read"]);
    await page.getByTestId("admin-ai-skill-create-submit").click();
    try {
      await expectNamedFormVisible(page, "admin-ai-skill-form-", options.name);
      return;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await recoverMutationAttempt(page, "admin-ai-skills-page", attempt);
    }
  }
}

export async function updateSkill(page: Page, currentName: string, nextDescription: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const form = await expectNamedFormVisible(page, "admin-ai-skill-form-", currentName);
    if ((await form.locator('input[name="description"]').inputValue()) === nextDescription) {
      return;
    }
    await form.locator('input[name="description"]').fill(nextDescription);
    await form.getByTestId(/admin-ai-skill-update-/).click();
    try {
      await expect(form.locator('input[name="description"]')).toHaveValue(nextDescription);
      return;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await recoverMutationAttempt(page, "admin-ai-skills-page", attempt);
    }
  }
}

export async function deleteSkill(page: Page, name: string): Promise<void> {
  await deleteNamedForm(page, "admin-ai-skill-form-", name, /admin-ai-skill-delete-/);
}

export async function createRole(page: Page, options: {
  name: string;
  description: string;
  prompt: string;
  skillName: string;
}): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await recoverAdminPage(page, "admin-ai-roles-page");
    const existing = formByName(page, "admin-ai-role-form-", options.name);
    if (await existing.count() > 0) {
      await expect(existing).toBeVisible();
      return;
    }
    const form = page.getByTestId("admin-ai-role-create-form");
    await form.locator('input[name="name"]').fill(options.name);
    await form.locator('input[name="description"]').fill(options.description);
    await form.locator('textarea[name="prompt"]').fill(options.prompt);
    await form.locator('select[name="skillIds"]').selectOption({ label: options.skillName });
    await page.getByTestId("admin-ai-role-create-submit").click();
    try {
      await expectNamedFormVisible(page, "admin-ai-role-form-", options.name);
      return;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await recoverMutationAttempt(page, "admin-ai-roles-page", attempt);
    }
  }
}

export async function updateRole(page: Page, currentName: string, nextPrompt: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const form = await expectNamedFormVisible(page, "admin-ai-role-form-", currentName);
    if ((await form.locator('textarea[name="prompt"]').inputValue()) === nextPrompt) {
      return;
    }
    await form.locator('textarea[name="prompt"]').fill(nextPrompt);
    await form.getByTestId(/admin-ai-role-update-/).click();
    try {
      await expect(form.locator('textarea[name="prompt"]')).toHaveValue(nextPrompt);
      return;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await recoverMutationAttempt(page, "admin-ai-roles-page", attempt);
    }
  }
}

export async function deleteRole(page: Page, name: string): Promise<void> {
  await deleteNamedForm(page, "admin-ai-role-form-", name, /admin-ai-role-delete-/);
}

export async function createAgent(page: Page, options: {
  name: string;
  description: string;
  roleName: string;
}): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await recoverAdminPage(page, "admin-ai-agents-page");
    const existing = formByName(page, "admin-ai-agent-form-", options.name);
    if (await existing.count() > 0) {
      await expect(existing).toBeVisible();
      return;
    }
    const form = page.getByTestId("admin-ai-agent-create-form");
    await form.locator('input[name="name"]').fill(options.name);
    await form.locator('input[name="description"]').fill(options.description);
    await form.locator('select[name="roleIds"]').selectOption({ label: options.roleName });
    await page.getByTestId("admin-ai-agent-create-submit").click();
    try {
      await expectNamedFormVisible(page, "admin-ai-agent-form-", options.name);
      return;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await recoverMutationAttempt(page, "admin-ai-agents-page", attempt);
    }
  }
}

export async function updateAgent(page: Page, currentName: string, nextDescription: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const form = await expectNamedFormVisible(page, "admin-ai-agent-form-", currentName);
    if ((await form.locator('input[name="description"]').inputValue()) === nextDescription) {
      return;
    }
    await form.locator('input[name="description"]').fill(nextDescription);
    await form.getByTestId(/admin-ai-agent-update-/).click();
    try {
      await expect(form.locator('input[name="description"]')).toHaveValue(nextDescription);
      return;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await recoverMutationAttempt(page, "admin-ai-agents-page", attempt);
    }
  }
}

export async function deleteAgent(page: Page, name: string): Promise<void> {
  await deleteNamedForm(page, "admin-ai-agent-form-", name, /admin-ai-agent-delete-/);
}

export async function queueAdminAgentRun(page: Page, options: {
  agentName: string;
  workspaceName: string;
  sourceName: string;
}): Promise<string> {
  const form = page.getByTestId("admin-ai-run-form");
  await form.locator('select[name="agentId"]').selectOption({ label: options.agentName });
  await form.locator('select[name="workspaceId"]').selectOption({ label: options.workspaceName });
  await form.locator('select[name="sourceId"]').selectOption({ label: options.sourceName });
  await page.getByTestId("admin-ai-run-submit").click();
  const status = page.getByRole("status");
  await expect(status).toContainText("Queued job");
  const text = await status.textContent();
  const match = text?.match(/Queued job (\S+)/);
  assert.ok(match?.[1], "Expected the admin run form to expose the queued job id.");
  return match[1];
}
