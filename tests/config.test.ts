import assert from "node:assert/strict";
import test from "node:test";

test("API config supports Keycloak and portable object storage settings", async () => {
  const originalEnv = { ...process.env };
  process.env.KEYCLOAK_ISSUER_URL = "http://localhost:8081/realms/speclens";
  process.env.KEYCLOAK_INTERNAL_ISSUER_URL = "http://keycloak:8080/realms/speclens";
  process.env.KEYCLOAK_CLIENT_ID = "speclens-web";
  process.env.OBJECT_STORAGE_PROVIDER = "s3-compatible";
  process.env.OBJECT_STORAGE_BUCKET = "speclens";
  process.env.OBJECT_STORAGE_ENDPOINT = "http://localhost:9000";
  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = "http://localhost:9000";
  process.env.OBJECT_STORAGE_REGION = "us-east-1";
  process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "true";

  const { loadApiConfig } = await import("../apps/api/src/services/config");
  const config = loadApiConfig();
  assert.equal(config.keycloakIssuerUrl, "http://localhost:8081/realms/speclens");
  assert.equal(config.keycloakInternalIssuerUrl, "http://keycloak:8080/realms/speclens");
  assert.equal(config.keycloakClientId, "speclens-web");
  assert.equal(config.objectStorageProvider, "s3-compatible");
  assert.equal(config.objectStoragePublicEndpoint, "http://localhost:9000");
  assert.equal(config.objectStorageForcePathStyle, true);

  process.env = originalEnv;
});
