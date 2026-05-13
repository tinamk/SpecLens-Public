import { expect, type Page } from "@playwright/test";

function isRetriableNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ERR_ADDRESS_UNREACHABLE");
}

export async function gotoPublicPath(page: Page, path: string, attempts = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableNavigationError(error) || attempt >= attempts) {
        throw error;
      }
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function expectPublicPage(page: Page, path: string, pageTestId: string): Promise<void> {
  await gotoPublicPath(page, path);
  await expect(page.getByTestId(pageTestId)).toBeVisible();
  await expect(page.getByTestId("public-site-header")).toBeVisible();
  await expect(page.getByTestId("public-site-footer")).toBeVisible();
}

export async function expectPrimaryPublicNav(page: Page): Promise<void> {
  await expect(page.getByTestId("public-nav-home")).toBeVisible();
  await expect(page.getByTestId("public-nav-pricing")).toBeVisible();
  await expect(page.getByTestId("public-nav-license")).toBeVisible();
  await expect(page.getByTestId("public-nav-commercial")).toBeVisible();
  await expect(page.getByTestId("public-nav-terms")).toBeVisible();
  await expect(page.getByTestId("public-nav-privacy")).toBeVisible();
  await expect(page.getByTestId("public-cta-login")).toHaveText("Log in");
  await expect(page.getByTestId("public-cta-login")).toBeVisible();
}
