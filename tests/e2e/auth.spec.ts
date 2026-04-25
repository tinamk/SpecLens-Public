import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import { loginThroughKeycloak, logoutFromPortal } from "./helpers/auth";
import { resolveE2eUser } from "./helpers/env";

const ownerUser = resolveE2eUser("OWNER", localTestUsers[0]);

test.describe("auth flows", () => {
  test("anonymous access to protected routes redirects to login", async ({ page }) => {
    await page.goto("/portal/workspaces");
    await expect(page).toHaveURL(/\/api\/auth\/login|protocol\/openid-connect\/auth/);
  });

  test("portal entry preserves query params when redirecting to workspaces", async ({ page }) => {
    await loginThroughKeycloak(page, ownerUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    await page.goto("/portal?source=entry&panel=reports");
    await expect(page).toHaveURL(/\/portal\/workspaces\?source=entry&panel=reports$/);
  });

  test("invalid auth callback redirects back through login with return-to context", async ({ request }) => {
    const response = await request.get("/api/auth/callback?returnTo=/portal/settings", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    expect(response.headers().location ?? "").toContain("/login?auth=callback-invalid&returnTo=%2Fportal%2Fsettings%3Fauth%3Dcallback-invalid");
  });

  test("auth configuration failure renders a public recovery page instead of a protected-route loop", async ({ page }) => {
    await page.goto("/login?auth=auth-config-required&returnTo=/portal/workspaces?auth=auth-config-required");

    await expect(page.getByTestId("public-login-auth-config-required-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The hosted portal cannot start sign-in right now." })).toBeVisible();
    await expect(page.getByTestId("public-login-retry-auth")).toHaveAttribute("href", /\/api\/auth\/login/);
  });

  test("GitHub callback failures render recovery guidance on the workspace directory", async ({ page }) => {
    await loginThroughKeycloak(page, ownerUser, {
      path: "/portal/workspaces?github=link-failed",
      expectedUrl: /\/portal\/workspaces\?github=link-failed$/,
    });

    await expect(page.getByTestId("workspace-index-github-link-failed")).toContainText(
      "could not link that GitHub App installation",
    );
  });

  test("login honors return-to and logout clears the portal session", async ({ page }) => {
    await loginThroughKeycloak(page, ownerUser, {
      path: "/portal/settings",
      expectedUrl: /\/portal\/settings/,
    });
    await expect(page.getByTestId("portal-settings-page")).toBeVisible();

    await logoutFromPortal(page);
    await page.goto("/portal/workspaces");
    await expect(page).toHaveURL(/\/api\/auth\/login|protocol\/openid-connect\/auth/);
  });
});
