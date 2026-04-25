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

  test("mobile public navigation declares its controlled drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectPublicPage(page, "/", "public-home-page");

    const menuToggle = page.getByLabel("Open menu");
    await expect(menuToggle).toHaveAttribute("aria-controls", "public-mobile-nav");
    await menuToggle.click();
    await expect(page.locator("#public-mobile-nav")).toBeVisible();
  });

  test("home page routes hosted SaaS versus commercial licensing explicitly", async ({ page }) => {
    await expectPublicPage(page, "/", "public-home-page");

    await expect(page.getByTestId("public-home-decision-banner")).toContainText(
      "Choose hosted SaaS for the managed product.",
    );
    await expect(page.getByTestId("public-home-decision-banner")).toContainText(
      "Choose commercial licensing for company rights.",
    );
    await expect(page.getByTestId("public-home-start-hosted")).toHaveText("Open hosted portal");
    await expect(page.getByTestId("public-home-view-pricing")).toHaveText("See hosted plans");
    await expect(page.getByTestId("public-home-contact-commercial")).toHaveText("Talk commercial licensing");
    await expect(page.getByTestId("public-cta-start-pro")).toHaveText("See hosted plans");
    await expect(page.getByTestId("public-nav-license")).toHaveText("Dual licensing");
    await expect(page.getByTestId("public-nav-commercial")).toHaveText("Commercial licensing");
  });

  test("pricing page makes the hosted-versus-commercial decision explicit", async ({ page }) => {
    await expectPublicPage(page, "/pricing", "public-pricing-page");

    await expect(page.getByTestId("public-pricing-decision-banner")).toContainText(
      "Choose Pro if you need hosted access to private GitHub repos.",
    );
    await expect(page.getByTestId("public-pricing-rights-note")).toContainText(
      "Free and Pro cover hosted SaaS usage only. They do not include commercial codebase rights.",
    );
    await expect(page.getByTestId("public-pricing-free-cta")).toHaveText("Open hosted portal");
    await expect(page.getByTestId("public-pricing-pro-checkout")).toHaveText("Open portal to start Pro");
    await expect(page.getByRole("heading", { name: "Commercial rights & deployments" })).toBeVisible();
  });

  test("commercial page clarifies when to choose Pro versus the contract path", async ({ page }) => {
    await expectPublicPage(page, "/commercial", "public-commercial-page");

    await expect(page.getByTestId("public-commercial-decision-banner")).toContainText(
      "Choose Pro for the managed hosted product.",
    );
    await expect(page.getByTestId("public-commercial-decision-banner")).toContainText(
      "Choose Commercial for commercial rights, commercial-purpose self-hosting, or procurement review.",
    );
    await expect(page.getByTestId("public-commercial-next-step-note")).toContainText(
      "we will route you to the right contract path",
    );
    await expect(page.getByTestId("public-commercial-pro-cta")).toHaveText("See hosted plans");
    await expect(page.getByTestId("public-commercial-main")).toContainText(
      "Offering SpecLens as a hosted or managed commercial service",
    );
  });

  test("commercial contact form submits through the public API proxy", async ({ page }) => {
    await expectPublicPage(page, "/commercial", "public-commercial-page");

    await page.getByLabel("Name").fill("SpecLens Buyer");
    await page.getByLabel("Work email").fill("buyer@example.com");
    await page.getByLabel("Company").fill("Example Corp");
    await page.getByLabel("How can we help?").fill("We need commercial-purpose self-hosting terms.");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("heading", { name: "We got your request" })).toBeVisible();
    await expect(page.getByText("next steps for commercial licensing")).toBeVisible();
  });

  test("license page routes hosted usage versus codebase rights explicitly", async ({ page }) => {
    await expectPublicPage(page, "/license", "public-license-page");

    await expect(page.getByTestId("public-license-decision-banner")).toContainText(
      "Choose Pricing if you only need the managed service.",
    );
    await expect(page.getByTestId("public-license-decision-banner")).toContainText(
      "Choose Commercial if you need codebase rights or commercial-purpose self-hosting.",
    );
    await expect(page.getByTestId("public-license-rights-note")).toContainText(
      "Hosted Free and Pro plans govern SaaS usage only.",
    );
    await expect(page.getByTestId("public-license-main")).toContainText(
      "non-commercial use and redistribution when license notices stay intact",
    );
    await expect(page.getByTestId("public-license-main")).toContainText(
      "commercial redistribution requires a commercial agreement",
    );
    await expect(page.getByTestId("public-license-scenarios")).toContainText(
      "I need to self-host SpecLens for commercial-purpose internal use - contact Commercial.",
    );
    await expect(page.getByTestId("public-license-scenarios")).toContainText(
      "I want to offer SpecLens as a hosted or managed commercial service - contact Commercial.",
    );
    await expect(page.getByTestId("public-license-pricing-cta")).toHaveText("See hosted plans");
    await expect(page.getByTestId("public-license-commercial-cta")).toHaveText("Talk commercial licensing");
  });

  test("primary CTAs reach pricing, auth, and commercial boundaries", async ({ page }) => {
    await gotoPublicPath(page, "/");
    await page.getByTestId("public-home-view-pricing").click();
    await expect(page).toHaveURL(/\/pricing$/);

    await gotoPublicPath(page, "/");
    await page.getByTestId("public-home-start-hosted").click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("public-login-page")).toBeVisible();
    await expect(page.getByTestId("public-login-continue")).toHaveAttribute("href", /\/api\/auth\/login/);

    await gotoPublicPath(page, "/");
    await page.getByTestId("public-home-contact-commercial").click();
    await expect(page).toHaveURL(/\/commercial$/);
  });
});
