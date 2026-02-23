import { test, expect } from "@playwright/test";

test("closes with ESC and returns focus to opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open modal" });
  await opener.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await expect(opener).toBeFocused();
});

test("closes with overlay click and returns focus to opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open modal" });
  await opener.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Click overlay (assumes overlay covers the viewport)
  await page.mouse.click(10, 10);

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("focus is trapped inside modal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open modal" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // After many Tabs, focus should still stay inside the modal
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => document.activeElement?.outerHTML ?? "");
    expect(active).toContain("data-modal");
  }
});
