import assert from "node:assert/strict";
import test from "node:test";
import {
  addSourceInputSchema,
  billingCheckoutInputSchema,
  createWorkspaceInputSchema,
  createWorkspaceSecretInputSchema,
  presetIdSchema,
  capabilityIdSchema,
  analysisRuntimeModeSchema,
  githubInstallQuerySchema,
  githubWebhookInputSchema,
  licenseEntitlementSchema,
  sourceTypeSchema,
  stripeWebhookInputSchema,
} from "@speclens/contracts";

test("contracts expose the dual-license entitlement tiers", () => {
  assert.deepEqual(licenseEntitlementSchema.options, ["free", "pro", "commercial"]);
});

test("contracts accept hosted workspace creation and source registration inputs", () => {
  const workspace = createWorkspaceInputSchema.parse({
    name: "Hosted Team",
    description: "Portal workspace",
  });
  assert.equal(workspace.name, "Hosted Team");

  const source = addSourceInputSchema.parse({
    type: sourceTypeSchema.enum["github-public"],
    displayName: "SpecLens repo",
    location: "https://github.com/example/repo",
    visibility: "public",
  });
  assert.equal(source.type, "github-public");
});

test("contracts expose parity presets, capabilities, runtime modes, and workspace secrets", () => {
  assert.equal(presetIdSchema.options.includes("tagtwo"), true);
  assert.equal(capabilityIdSchema.options.includes("visual-inspection"), true);
  assert.equal(analysisRuntimeModeSchema.options.includes("browser"), true);

  const secret = createWorkspaceSecretInputSchema.parse({
    name: "Demo credentials",
    kind: "credential-pair",
    value: "{\"username\":\"demo\",\"password\":\"secret\"}",
  });
  assert.equal(secret.kind, "credential-pair");
});

test("contracts accept billing and github integration payloads", () => {
  const checkout = billingCheckoutInputSchema.parse({
    workspaceId: "workspace_demo",
    plan: "pro",
  });
  assert.equal(checkout.plan, "pro");

  const stripeWebhook = stripeWebhookInputSchema.parse({
    type: "checkout.session.completed",
    sessionId: "checkout_123",
  });
  assert.equal(stripeWebhook.type, "checkout.session.completed");

  const githubInstall = githubInstallQuerySchema.parse({
    workspaceId: "workspace_demo",
  });
  assert.equal(githubInstall.workspaceId, "workspace_demo");

  const githubWebhook = githubWebhookInputSchema.parse({
    workspaceId: "workspace_demo",
    action: "created",
    installationId: "12345",
    accountLogin: "example-org",
  });
  assert.equal(githubWebhook.action, "created");
});
