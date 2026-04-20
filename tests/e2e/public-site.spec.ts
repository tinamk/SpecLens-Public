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

  test("pricing page makes the hosted-versus-commercial decision explicit", async ({ page }) => {
    await expectPublicPage(page, "/pricing", "public-pricing-page");

    await expect(page.getByTestId("public-pricing-decision-banner")).toContainText(
      "Choose Pro if you need hosted access to private repos.",
    );
    await expect(page.getByTestId("public-pricing-rights-note")).toContainText(
      "Free and Pro cover hosted SaaS usage only. They do not include commercial codebase rights.",
    );
    await expect(page.getByTestId("public-pricing-pro-checkout")).toHaveText("Start Pro");
    await expect(page.getByRole("heading", { name: "Commercial rights & self-hosting" })).toBeVisible();
  });

  test("commercial page clarifies when to choose Pro versus the contract path", async ({ page }) => {
    await expectPublicPage(page, "/commercial", "public-commercial-page");

    await expect(page.getByTestId("public-commercial-decision-banner")).toContainText(
      "Choose Pro for the managed hosted product.",
    );
    await expect(page.getByTestId("public-commercial-decision-banner")).toContainText(
      "Choose Commercial for codebase rights, self-hosting, or procurement review.",
    );
    await expect(page.getByTestId("public-commercial-next-step-note")).toContainText(
      "we will route you to the right contract path",
    );
    await expect(page.getByTestId("public-commercial-pro-cta")).toHaveText("Review hosted plans");
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
