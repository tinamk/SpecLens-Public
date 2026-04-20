import { expect, type Page } from "@playwright/test";

export async function startCheckout(
  page: Page,
  buttonTestId: string,
  options?: {
    expectUrl?: RegExp;
  },
): Promise<void> {
  await Promise.all([
    page.waitForURL(options?.expectUrl ?? /checkout|stripe/i, { timeout: 60_000 }),
    page.getByTestId(buttonTestId).click(),
  ]);
  await expect(page).toHaveURL(options?.expectUrl ?? /checkout|stripe/i);
}
