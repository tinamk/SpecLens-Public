import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAdminBaseUrl,
  firstCommaSeparatedValue,
  realmName,
} from "../scripts/local/seed-keycloak-users";

test("Keycloak seed helpers use the first issuer when issuer env is comma-separated", () => {
  const env = {
    KEYCLOAK_ISSUER_URL: "http://localhost:18080/auth/realms/speclens,http://100.69.199.78:18080/auth/realms/speclens",
  };

  assert.equal(firstCommaSeparatedValue(env.KEYCLOAK_ISSUER_URL), "http://localhost:18080/auth/realms/speclens");
  assert.equal(realmName(env), "speclens");
  assert.equal(deriveAdminBaseUrl(env), "http://localhost:18080/auth");
});

test("Keycloak seed admin URL takes precedence over issuer-derived admin base", () => {
  assert.equal(
    deriveAdminBaseUrl({
      KEYCLOAK_ADMIN_URL: "http://localhost:18081/",
      KEYCLOAK_ISSUER_URL: "http://localhost:18080/auth/realms/speclens",
    }),
    "http://localhost:18081",
  );
});
