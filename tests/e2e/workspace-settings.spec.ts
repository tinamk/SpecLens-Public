import { expect, test } from "@playwright/test";
import { localTestUsers } from "../../scripts/local/test-users";
import { loginThroughKeycloak } from "./helpers/auth";
import { startCheckout } from "./helpers/billing";
import { createTimestampedName, resolveE2eMode, resolveE2eUser } from "./helpers/env";
import { createWorkspace } from "./helpers/workspaces";

const ownerUser = resolveE2eUser("OWNER", localTestUsers[0]);

test.describe("workspace settings", () => {
  test("workspace-owned billing and GitHub settings render from the settings area", async ({ page }) => {
    await loginThroughKeycloak(page, ownerUser, {
      path: "/portal/workspaces",
      expectedUrl: /\/portal\/workspaces/,
    });

    const workspace = await createWorkspace(page, {
      name: createTimestampedName("Workspace Settings E2E"),
      description: "Workspace settings validation.",
    });

    await page.goto(`/portal/workspaces/${workspace.id}/settings`);
    await expect(page.getByTestId("workspace-settings-page")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-entitlement")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-checkout-button")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-billing-portal-button")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-github-install-button")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-installations")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-github-repositories")).toBeVisible();

    if (resolveE2eMode() === "production" || process.env.STRIPE_SECRET_KEY) {
      await startCheckout(page, "workspace-settings-checkout-button");
    }
  });
});
