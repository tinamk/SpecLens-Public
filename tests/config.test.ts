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
  process.env.UPLOAD_ARCHIVE_MAX_BYTES = "33554432";

  const { loadApiConfig } = await import("../apps/api/src/services/config");
  const config = loadApiConfig();
  assert.equal(config.keycloakIssuerUrl, "http://localhost:8081/realms/speclens");
  assert.equal(config.keycloakInternalIssuerUrl, "http://keycloak:8080/realms/speclens");
  assert.equal(config.keycloakClientId, "speclens-web");
  assert.equal(config.objectStorageProvider, "s3-compatible");
  assert.equal(config.objectStoragePublicEndpoint, "http://localhost:9000");
  assert.equal(config.objectStorageForcePathStyle, true);
  assert.equal(config.uploadArchiveMaxBytes, 33_554_432);

  process.env = originalEnv;
});

test("API config falls back for invalid numeric environment values", async () => {
  const originalEnv = { ...process.env };
  process.env.PORT = "not-a-port";
  process.env.RATE_LIMIT_MAX = "0";
  process.env.RATE_LIMIT_WINDOW_MS = "-1";
  process.env.WORKSPACE_RETENTION_DAYS = "nan";

  const { loadApiConfig } = await import("../apps/api/src/services/config");
  const config = loadApiConfig();
  assert.equal(config.port, 4000);
  assert.equal(config.rateLimitMax, 120);
  assert.equal(config.rateLimitWindowMs, 60_000);
  assert.equal(config.workspaceRetentionDays, null);

  process.env = originalEnv;
});

test("AI worker config falls back for invalid numeric environment values", async () => {
  const originalEnv = { ...process.env };
  process.env.AI_WORKER_POLL_INTERVAL_MS = "nope";
  process.env.AI_WORKER_MAX_CONCURRENCY = "0";
  process.env.AI_WORKER_ROLE_MAX_CONCURRENCY = "-3";
  process.env.AI_WORKER_SANDBOX_TIMEOUT_MS = "Infinity";
  process.env.AI_WORKER_CODEX_MAX_ATTEMPTS = "NaN";

  const { loadAiWorkerConfig } = await import("../apps/ai-worker/src/services/config");
  const config = loadAiWorkerConfig();
  assert.equal(config.pollIntervalMs, 5000);
  assert.equal(config.maxConcurrency, 1);
  assert.equal(config.roleMaxConcurrency, 4);
  assert.equal(config.sandboxTimeoutMs, 3_600_000);
  assert.equal(config.codexMaxAttempts, 3);

  process.env = originalEnv;
});

test("runner config falls back for invalid numeric environment values", async () => {
  const originalEnv = { ...process.env };
  process.env.RUNNER_POLL_INTERVAL_MS = "sometimes";
  process.env.RUNNER_MAX_CONCURRENCY = "0";
  process.env.RUNNER_HEALTH_PORT = "-4510";
  process.env.SANDBOX_TIMEOUT_MS = "NaN";
  process.env.SANDBOX_TEMP_RETENTION_MS = "1.5";

  const { loadRunnerConfig } = await import("../apps/runner/src/services/config");
  const config = loadRunnerConfig();
  assert.equal(config.pollIntervalMs, 5000);
  assert.equal(config.maxConcurrency, 2);
  assert.equal(config.healthPort, 4510);
  assert.equal(config.sandboxTimeoutMs, 900_000);
  assert.equal(config.sandboxTempRetentionMs, 86_400_000);

  process.env = originalEnv;
});
