import { test, expect } from "@playwright/test";

test("closes with ESC and returns focus to opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open modal" });
  await opener.click();

  const dialog = page.getByTestId("modal-dialog");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await expect(opener).toBeFocused();
});

test("closes with overlay click and returns focus to opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open modal" });
  await opener.click();

  const dialog = page.getByTestId("modal-dialog");
  await expect(dialog).toBeVisible();

  await page.getByTestId("modal-overlay").click({ position: { x: 5, y: 5 } });

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("focus is trapped inside modal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open modal" }).click();

  const dialog = page.getByTestId("modal-dialog");
  await expect(dialog).toBeVisible();

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const focusedInsideDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(focusedInsideDialog).toBe(true);
  }
});
