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
