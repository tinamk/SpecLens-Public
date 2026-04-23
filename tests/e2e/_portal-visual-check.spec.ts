import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = "/tmp/ux-portal";
const HOST = "http://100.69.199.78:18080";
const USERNAME = process.env.E2E_ADMIN_USERNAME ?? "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

async function ensureLogin(page: import("@playwright/test").Page, to: string) {
  await page.goto(`${HOST}${to}`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("protocol/openid-connect/auth") || page.url().includes("keycloak")) {
    await page.fill("#username", USERNAME);
    await page.fill("#password", PASSWORD);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForURL(/\/portal\//, { timeout: 15_000 });
  }
}

test("capture portal pages after aggressive trim", async ({ page, browser }) => {
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
    { name: "portal-workspaces-dir", url: `${HOST}/portal/workspaces` },
    { name: "portal-settings", url: `${HOST}/portal/settings` },
    { name: "workspace-overview", url: wsUrl },
    { name: "workspace-sources", url: `${wsUrl}/sources` },
    { name: "workspace-runs", url: `${wsUrl}/runs` },
    { name: "workspace-reports", url: `${wsUrl}/reports` },
    { name: "workspace-access", url: `${wsUrl}/access` },
    { name: "workspace-settings", url: `${wsUrl}/settings` },
    { name: "workspace-code", url: `${wsUrl}/code` },
    { name: "admin-ai-auth", url: `${HOST}/portal/admin/ai/auth` },
    { name: "admin-ai-skills", url: `${HOST}/portal/admin/ai/skills` },
    { name: "admin-ai-roles", url: `${HOST}/portal/admin/ai/roles` },
    { name: "admin-ai-agents", url: `${HOST}/portal/admin/ai/agents` },
  ];

  for (const p of pages) {
    await page.goto(p.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${p.name}-1440.png`), fullPage: true });
  }

  // Mobile for the key workspace pages
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mctx.newPage();
  await ensureLogin(m, "/portal/workspaces");

  const mobilePages = [
    { name: "portal-workspaces-dir", url: `${HOST}/portal/workspaces` },
    { name: "workspace-overview", url: wsUrl },
    { name: "workspace-runs", url: `${wsUrl}/runs` },
  ];
  for (const p of mobilePages) {
    await m.goto(p.url, { waitUntil: "domcontentloaded" });
    await m.waitForTimeout(500);
    await m.screenshot({ path: path.join(OUT, `${p.name}-390.png`), fullPage: true });
  }
  await mctx.close();

  expect(true).toBe(true);
});
