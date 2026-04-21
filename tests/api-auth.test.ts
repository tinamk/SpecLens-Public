import assert from "node:assert/strict";
import test from "node:test";
import { buildPortalCsrfToken, decodePortalSessionToken, encodePortalSessionToken } from "@speclens/core";

test("api local-dev auth env derives fallback signing secrets when auth secrets are unset", async () => {
  const originalEnv = { ...process.env };
  process.env.API_AUTH_MODE = "local-dev";
  process.env.APP_URL = "http://localhost:3000";
  process.env.API_URL = "http://localhost:4000";
  delete process.env.CSRF_SECRET;
  delete process.env.PORTAL_SESSION_SECRET;

  const module = await import("../apps/api/src/services/portal-auth-env");
  const authEnv = module.resolvePortalAuthEnv();
  const token = encodePortalSessionToken({
    provider: "local-dev",
    subject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Local Dev User",
  }, authEnv);

  assert.equal(typeof authEnv.PORTAL_SESSION_SECRET, "string");
  assert.equal(typeof authEnv.CSRF_SECRET, "string");
  assert.deepEqual(decodePortalSessionToken(token, authEnv), {
    provider: "local-dev",
    subject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Local Dev User",
  });
  assert.equal(buildPortalCsrfToken(token, authEnv).length > 0, true);

  process.env = originalEnv;
});

test("api local-dev auth env leaves hosted contexts strict when auth secrets are unset", async () => {
  const originalEnv = { ...process.env };
  process.env.API_AUTH_MODE = "keycloak";
  process.env.APP_URL = "https://app.speclens.example";
  process.env.API_URL = "https://api.speclens.example";
  delete process.env.CSRF_SECRET;
  delete process.env.PORTAL_SESSION_SECRET;

  const module = await import("../apps/api/src/services/portal-auth-env");
  const authEnv = module.resolvePortalAuthEnv();

  assert.equal(authEnv.PORTAL_SESSION_SECRET, undefined);
  assert.equal(authEnv.CSRF_SECRET, undefined);

  process.env = originalEnv;
});
