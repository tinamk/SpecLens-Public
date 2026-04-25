import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { localTestUsers } from "../../scripts/local/test-users";
import { resolveE2eMode, resolveE2eUser } from "./helpers/env";

const OUT = process.env.PORTAL_VISUAL_OUTPUT_DIR ?? path.join(process.cwd(), "test-results", "portal-visual");
const E2E_MODE = resolveE2eMode();
const DEFAULT_LOCAL_HOST = `http://localhost:${process.env.CADDY_HTTP_PORT ?? "18080"}`;
const HOST = (
  process.env.PORTAL_VISUAL_BASE_URL
  ?? (E2E_MODE === "local" ? DEFAULT_LOCAL_HOST : (process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_BASE_URL ?? DEFAULT_LOCAL_HOST))
).replace(/\/+$/, "");
const ADMIN_USER = resolveE2eUser("ADMIN", localTestUsers[3]);
const USERNAME = ADMIN_USER.username;
const PASSWORD = ADMIN_USER.password;
const requiresExplicitProductionAdmin = E2E_MODE === "production"
  && (!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD);

async function ensureLogin(page: import("@playwright/test").Page, to: string) {
  await page.goto(`${HOST}${to}`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("protocol/openid-connect/auth") || page.url().includes("keycloak")) {
    await page.fill("#username", USERNAME);
    await page.fill("#password", PASSWORD);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForURL(/\/portal\//, { timeout: 15_000 });
  }
}

async function expectAnyTestId(page: import("@playwright/test").Page, testIds: string | string[]) {
  const ids = Array.isArray(testIds) ? testIds : [testIds];
  const selector = ids.map(id => `[data-testid="${id}"]`).join(", ");
  await expect(page.locator(selector).first()).toBeVisible();
}

test("capture portal evidence views for visual regression review", async ({ page, browser }) => {
  test.skip(requiresExplicitProductionAdmin, "Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running production portal visual capture.");

  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await ensureLogin(page, "/portal/workspaces");

  // Create a workspace for deeper page captures
  const wsName = `Visual Trim Check ${Date.now()}`;
  await page.waitForSelector('[data-testid="workspace-index-name-input"]');
  await page.fill('[data-testid="workspace-index-name-input"]', wsName);
  await page.click('[data-testid="workspace-index-submit"]');
  await page.waitForURL(/\/portal\/workspaces\/[^/]+$/);
  const wsUrl = page.url();

  const pages = [
    { name: "portal-workspaces-dir", url: `${HOST}/portal/workspaces`, testId: "workspace-index-page" },
    { name: "portal-settings", url: `${HOST}/portal/settings`, testId: "portal-settings-page" },
    { name: "workspace-overview", url: wsUrl, testId: "workspace-overview-page" },
    { name: "workspace-sources", url: `${wsUrl}/sources`, testId: "workspace-sources-page" },
    { name: "workspace-runs", url: `${wsUrl}/runs`, testId: "workspace-runs-page" },
    { name: "workspace-reports", url: `${wsUrl}/reports`, testId: "workspace-reports-page" },
    { name: "workspace-access", url: `${wsUrl}/access`, testId: "workspace-access-page" },
    { name: "workspace-settings", url: `${wsUrl}/settings`, testId: "workspace-settings-page" },
    { name: "workspace-code", url: `${wsUrl}/code`, testId: ["workspace-code-page", "workspace-code-access-denied-page"] },
    { name: "admin-ai-auth", url: `${HOST}/portal/admin/ai/auth`, testId: "admin-ai-auth-page" },
    { name: "admin-ai-skills", url: `${HOST}/portal/admin/ai/skills`, testId: "admin-ai-skills-page" },
    { name: "admin-ai-roles", url: `${HOST}/portal/admin/ai/roles`, testId: "admin-ai-roles-page" },
    { name: "admin-ai-agents", url: `${HOST}/portal/admin/ai/agents`, testId: "admin-ai-agents-page" },
  ];

  for (const p of pages) {
    await page.goto(p.url, { waitUntil: "domcontentloaded" });
    await expectAnyTestId(page, p.testId);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${p.name}-1440.png`), fullPage: true });
  }

  // Mobile for the key workspace pages
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mctx.newPage();
  await ensureLogin(m, "/portal/workspaces");

  const mobilePages = [
    { name: "portal-workspaces-dir", url: `${HOST}/portal/workspaces`, testId: "workspace-index-page" },
    { name: "workspace-overview", url: wsUrl, testId: "workspace-overview-page" },
    { name: "workspace-runs", url: `${wsUrl}/runs`, testId: "workspace-runs-page" },
  ];
  for (const p of mobilePages) {
    await m.goto(p.url, { waitUntil: "domcontentloaded" });
    await expectAnyTestId(m, p.testId);
    await m.waitForTimeout(500);
    await m.screenshot({ path: path.join(OUT, `${p.name}-390.png`), fullPage: true });
  }
  await mctx.close();
});
