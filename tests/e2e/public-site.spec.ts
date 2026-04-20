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

  test("home page routes hosted SaaS versus commercial licensing explicitly", async ({ page }) => {
    await expectPublicPage(page, "/", "public-home-page");

    await expect(page.getByTestId("public-home-decision-banner")).toContainText(
      "Choose hosted SaaS for the managed product.",
    );
    await expect(page.getByTestId("public-home-decision-banner")).toContainText(
      "Choose commercial licensing for company rights.",
    );
    await expect(page.getByTestId("public-home-start-hosted")).toHaveText("Try hosted SaaS");
    await expect(page.getByTestId("public-home-view-pricing")).toHaveText("See hosted pricing");
    await expect(page.getByTestId("public-home-contact-commercial")).toHaveText("Talk commercial licensing");
    await expect(page.getByTestId("public-cta-start-pro")).toHaveText("See hosted plans");
    await expect(page.getByTestId("public-nav-license")).toHaveText("License model");
    await expect(page.getByTestId("public-nav-commercial")).toHaveText("Commercial licensing");
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

  test("license page routes hosted usage versus codebase rights explicitly", async ({ page }) => {
    await expectPublicPage(page, "/license", "public-license-page");

    await expect(page.getByTestId("public-license-decision-banner")).toContainText(
      "Choose Pricing if you only need the managed service.",
    );
    await expect(page.getByTestId("public-license-decision-banner")).toContainText(
      "Choose Commercial if you need codebase rights or self-hosting.",
    );
    await expect(page.getByTestId("public-license-rights-note")).toContainText(
      "Hosted Free and Pro plans govern SaaS usage only.",
    );
    await expect(page.getByTestId("public-license-scenarios")).toContainText(
      "I need to self-host SpecLens in my own environment - contact Commercial.",
    );
    await expect(page.getByTestId("public-license-pricing-cta")).toHaveText("View hosted plans");
    await expect(page.getByTestId("public-license-commercial-cta")).toHaveText("Talk commercial licensing");
  });

  test("primary CTAs reach pricing, auth, and commercial boundaries", async ({ page }) => {
    await gotoPublicPath(page, "/");
    await page.getByTestId("public-home-view-pricing").click();
    await expect(page).toHaveURL(/\/pricing$/);

    await gotoPublicPath(page, "/");
    await Promise.all([
      page.waitForURL(/\/api\/auth\/login|protocol\/openid-connect\/auth|\/portal\/workspaces/, { timeout: 60_000 }),
      page.getByTestId("public-home-start-hosted").click(),
    ]);

    await gotoPublicPath(page, "/");
    await page.getByTestId("public-home-contact-commercial").click();
    await expect(page).toHaveURL(/\/commercial$/);
  });
});
