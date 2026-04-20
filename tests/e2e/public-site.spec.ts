import { expect, test } from "@playwright/test";
import { expectPrimaryPublicNav, expectPublicPage, gotoPublicPath } from "./helpers/public-site";

test.describe("public site", () => {
  test("every public page renders with the shared navigation contract", async ({ page }) => {
    await expectPublicPage(page, "/", "public-home-page");
    await expectPrimaryPublicNav(page);

    await expectPublicPage(page, "/pricing", "public-pricing-page");
    await expectPublicPage(page, "/license", "public-license-page");
    await expectPublicPage(page, "/commercial", "public-commercial-page");
    await expectPublicPage(page, "/privacy", "public-privacy-page");
    await expectPublicPage(page, "/terms", "public-terms-page");
  });

  test("primary CTAs reach pricing and auth boundaries", async ({ page }) => {
    await gotoPublicPath(page, "/");
    await page.getByTestId("public-home-compare-plans").click();
    await expect(page).toHaveURL(/\/pricing$/);

    await gotoPublicPath(page, "/");
    await Promise.all([
      page.waitForURL(/\/api\/auth\/login|protocol\/openid-connect\/auth|\/portal\/workspaces/, { timeout: 60_000 }),
      page.getByTestId("public-home-open-portal").click(),
    ]);
  });
});
