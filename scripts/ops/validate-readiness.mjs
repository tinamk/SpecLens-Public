import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Stripe from "stripe";
import PgBoss from "pg-boss";
import pg from "pg";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const { Client: PgClient } = pg;

const apiUrl = process.env.API_URL ?? "http://localhost:14000";
const runnerUrl = process.env.RUNNER_URL ?? "http://localhost:14510";
const aiWorkerUrl = process.env.AI_WORKER_URL ?? "http://localhost:14520";
const appUrl = process.env.APP_URL ?? "http://localhost:18080";
const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? "";
const emitJson = process.env.OPS_VALIDATE_JSON === "1";

let failed = false;
const results = [];

function logResult(ok, name, detail = "") {
  results.push({ name, ok, detail });
  if (ok) {
    console.log(`[ops] ${name} ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  failed = true;
  console.error(`[ops] ${name} failed${detail ? `: ${detail}` : ""}`);
}

function logSuccess(name, detail = "") {
  logResult(true, name, detail);
}

function logFailure(name, detail) {
  logResult(false, name, detail);
}

function logSkipped(name, detail) {
  console.log(`[ops] ${name} skipped${detail ? ` (${detail})` : ""}`);
  results.push({ name, ok: true, skipped: true, detail });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveHomeDir() {
  return process.env.HOME?.trim() || os.homedir();
}

function resolveSpecLensStateRoot() {
  const explicitRoot = process.env.SPECLENS_STATE_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  const xdgStateHome = process.env.XDG_STATE_HOME?.trim();
  return path.resolve(
    xdgStateHome && xdgStateHome.length > 0
      ? path.join(xdgStateHome, "speclens")
      : path.join(resolveHomeDir(), ".local", "state", "speclens"),
  );
}

function resolveObjectStorageRoot() {
  const explicitRoot = process.env.SPECLENS_OBJECT_STORAGE_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  return path.join(resolveSpecLensStateRoot(), "object-storage");
}

function resolveStorageConfig() {
  const provider = process.env.OBJECT_STORAGE_PROVIDER === "s3-compatible" || process.env.OBJECT_STORAGE_PROVIDER === "digitalocean-spaces"
    ? process.env.OBJECT_STORAGE_PROVIDER
    : "local";
  return {
    provider,
    bucket: process.env.OBJECT_STORAGE_BUCKET ?? process.env.SPACES_BUCKET ?? null,
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    region: process.env.OBJECT_STORAGE_REGION ?? process.env.SPACES_REGION ?? null,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? process.env.SPACES_ACCESS_KEY_ID ?? null,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? process.env.SPACES_SECRET_ACCESS_KEY ?? null,
  };
}

function createStorageClient(config) {
  if (config.provider === "local" || !config.bucket || !config.endpoint || !config.region) {
    return null;
  }
  const credentials = config.accessKeyId && config.secretAccessKey
    ? {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    }
    : undefined;
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    ...(credentials ? { credentials } : {}),
  });
}

async function readBodyText(body) {
  if (!body) {
    return "";
  }
  if (typeof body.transformToString === "function") {
    return await body.transformToString("utf8");
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withDbClient(task) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database-backed validation.");
  }
  const client = new PgClient({ connectionString });
  await client.connect();
  try {
    return await task(client);
  } finally {
    await client.end();
  }
}

async function expectStatus(name, url, options = {}) {
  const {
    method = "GET",
    expected = [200],
    headers,
    body,
    redirect = "follow",
  } = options;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect,
    });
    if (!expected.includes(response.status)) {
      logFailure(name, `${response.status} ${await response.text()}`);
      return null;
    }
    logSuccess(name, `(${response.status})`);
    return response;
  } catch (error) {
    logFailure(name, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function expectJson(name, url, validator) {
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      logFailure(name, `${response.status} ${await response.text()}`);
      return null;
    }
    const payload = await response.json();
    validator(payload);
    logSuccess(name, `(${response.status})`);
    return payload;
  } catch (error) {
    logFailure(name, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function validateQueueRoundtrip() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    logSkipped("queue-roundtrip", "DATABASE_URL not configured");
    return;
  }

  const queueName = "speclens-ops-validate";
  const boss = new PgBoss({
    connectionString,
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });

  try {
    boss.on("error", error => {
      logFailure("queue-roundtrip", error instanceof Error ? error.message : String(error));
    });
    await boss.start();
    await boss.createQueue(queueName).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already exists/i.test(message)) {
        throw error;
      }
    });
    const nonce = crypto.randomUUID();
    const messageId = await boss.send(queueName, { nonce });
    if (!messageId) {
      throw new Error("Queue send did not return a message id.");
    }

    let jobs = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      jobs = await boss.fetch(queueName);
      if (jobs.length > 0) {
        break;
      }
      await sleep(250);
    }

    if (jobs.length !== 1) {
      throw new Error(`Expected one fetched queue job, received ${jobs.length}.`);
    }
    if (jobs[0]?.data?.nonce !== nonce) {
      throw new Error("Fetched queue payload did not match the published payload.");
    }

    await boss.complete(queueName, jobs[0].id);
    await boss.purgeQueue(queueName);
    logSuccess("queue-roundtrip", `(message=${messageId})`);
  } catch (error) {
    logFailure("queue-roundtrip", error instanceof Error ? error.message : String(error));
  } finally {
    await boss.stop().catch(() => undefined);
  }
}

async function validateObjectStorageRoundtrip() {
  const config = resolveStorageConfig();
  const key = `ops-validate/${Date.now()}-${crypto.randomUUID()}.txt`;
  const content = `speclens ops validate ${new Date().toISOString()}`;

  try {
    if (config.provider === "local") {
      const targetPath = path.join(resolveObjectStorageRoot(), key);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");
      const downloaded = fs.readFileSync(targetPath, "utf8");
      if (downloaded !== content) {
        throw new Error("Local object storage roundtrip content mismatch.");
      }
      fs.rmSync(targetPath, { force: true });
      logSuccess("object-storage-roundtrip", "(provider=local)");
      return;
    }

    const client = createStorageClient(config);
    if (!client || !config.bucket) {
      throw new Error("Remote object storage is not fully configured.");
    }

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain",
    }));

    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    const downloaded = await readBodyText(response.Body);
    if (downloaded !== content) {
      throw new Error("Remote object storage roundtrip content mismatch.");
    }

    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    logSuccess("object-storage-roundtrip", `(provider=${config.provider})`);
  } catch (error) {
    logFailure("object-storage-roundtrip", error instanceof Error ? error.message : String(error));
  }
}

async function validateStripeWebhooks() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    logSkipped("stripe-webhooks", "STRIPE_WEBHOOK_SECRET not configured");
    return;
  }

  await expectStatus("stripe-webhook-rejects-invalid-signature", `${apiUrl}/api/webhooks/stripe`, {
    method: "POST",
    expected: [401],
    headers: {
      "content-type": "application/json",
      "stripe-signature": "invalid",
    },
    body: JSON.stringify({ type: "customer.subscription.updated" }),
  });

  const validateUserId = process.env.OPS_VALIDATE_STRIPE_USER_ID?.trim();
  if (!validateUserId) {
    logSkipped("stripe-webhook-valid", "set OPS_VALIDATE_STRIPE_USER_ID to validate an accepted event");
    return;
  }

  const stripe = new Stripe("sk_test_speclens_ops_validate", {
    apiVersion: "2025-08-27.basil",
  });
  const event = {
    id: `evt_ops_${Date.now()}`,
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: `sub_ops_${Date.now()}`,
        object: "subscription",
        customer: `cus_ops_${Date.now()}`,
        status: "active",
        metadata: {
          userId: validateUserId,
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const response = await expectStatus("stripe-webhook-accepts-valid-signature", `${apiUrl}/api/webhooks/stripe`, {
    method: "POST",
    expected: [200],
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
  if (!response) {
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    logSkipped("stripe-webhook-side-effect", "DATABASE_URL not configured");
    return;
  }

  try {
    const result = await withDbClient(client => client.query(
      'select "entitlement" from "User" where "id" = $1',
      [validateUserId],
    ));
    const entitlement = result.rows[0]?.entitlement ?? null;
    if (entitlement !== "pro") {
      throw new Error(`Expected user entitlement to be pro, received ${String(entitlement)}.`);
    }
    logSuccess("stripe-webhook-side-effect", `(entitlement=${entitlement})`);
  } catch (error) {
    logFailure("stripe-webhook-side-effect", error instanceof Error ? error.message : String(error));
  }
}

async function validateGithubWebhooks() {
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    logSkipped("github-webhooks", "GITHUB_APP_WEBHOOK_SECRET not configured");
    return;
  }

  await expectStatus("github-webhook-rejects-invalid-signature", `${apiUrl}/api/webhooks/github`, {
    method: "POST",
    expected: [401],
    headers: {
      "content-type": "application/json",
      "x-github-event": "installation",
      "x-hub-signature-256": "sha256=invalid",
    },
    body: JSON.stringify({ action: "deleted" }),
  });

  const workspaceId = process.env.OPS_VALIDATE_GITHUB_WORKSPACE_ID?.trim();
  const installationId = String(Date.now());
  if (workspaceId && process.env.DATABASE_URL?.trim()) {
    try {
      await withDbClient(client => client.query(
        `insert into "GithubInstallation" ("id", "workspaceId", "githubInstallationId", "githubAccountLogin", "createdAt")
         values ($1, $2, $3, $4, now())`,
        [`ghinst_ops_${installationId}`, workspaceId, installationId, "ops-validate"],
      ));
    } catch (error) {
      logFailure("github-webhook-setup", error instanceof Error ? error.message : String(error));
      return;
    }
  }

  const payload = JSON.stringify({
    action: "deleted",
    installation: {
      id: Number(installationId),
      account: {
        login: "ops-validate",
      },
    },
  });
  const signature = `sha256=${crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex")}`;

  const response = await expectStatus("github-webhook-accepts-valid-signature", `${apiUrl}/api/webhooks/github`, {
    method: "POST",
    expected: [200],
    headers: {
      "content-type": "application/json",
      "x-github-event": "installation",
      "x-hub-signature-256": signature,
    },
    body: payload,
  });
  if (!response) {
    return;
  }

  if (!workspaceId || !process.env.DATABASE_URL?.trim()) {
    logSkipped("github-webhook-side-effect", "set OPS_VALIDATE_GITHUB_WORKSPACE_ID and DATABASE_URL to validate deletion side effects");
    return;
  }

  try {
    const result = await withDbClient(client => client.query(
      'select count(*)::int as count from "GithubInstallation" where "workspaceId" = $1 and "githubInstallationId" = $2',
      [workspaceId, installationId],
    ));
    const count = Number(result.rows[0]?.count ?? 0);
    if (count !== 0) {
      throw new Error(`Expected GitHub installation ${installationId} to be removed, found ${count} rows.`);
    }
    logSuccess("github-webhook-side-effect", `(installationId=${installationId})`);
  } catch (error) {
    logFailure("github-webhook-side-effect", error instanceof Error ? error.message : String(error));
  }
}

await expectStatus("api-health", `${apiUrl}/health`);
await expectJson("api-ready", `${apiUrl}/ready`, payload => {
  if (!payload || payload.ok !== true) {
    throw new Error("API readiness payload was not ok.");
  }
});
await expectStatus("api-metrics", `${apiUrl}/metrics`);
await expectStatus("runner-health", `${runnerUrl}/health`);
await expectJson("runner-ready", `${runnerUrl}/ready`, payload => {
  if (!payload || payload.ok !== true) {
    throw new Error("Runner readiness payload was not ok.");
  }
});
await expectStatus("runner-metrics", `${runnerUrl}/metrics`);
await expectStatus("ai-worker-health", `${aiWorkerUrl}/health`);
await expectJson("ai-worker-ready", `${aiWorkerUrl}/ready`, payload => {
  if (!payload || payload.ok !== true) {
    throw new Error("AI worker readiness payload was not ok.");
  }
});
await expectStatus("ai-worker-metrics", `${aiWorkerUrl}/metrics`);
await expectStatus("portal-root", `${appUrl}/`);
await expectStatus("auth-login-route", `${appUrl}/api/auth/login?returnTo=%2Fportal%2Fworkspaces`, {
  expected: [302, 307],
  redirect: "manual",
});
await expectStatus("auth-callback-invalid-state", `${appUrl}/api/auth/callback?returnTo=%2Fportal%2Fworkspaces&state=invalid`, {
  expected: [302, 307],
  redirect: "manual",
});
await expectStatus("auth-logout-route", `${appUrl}/api/auth/logout`, {
  expected: [200, 302, 307],
});

if (keycloakIssuerUrl) {
  await expectStatus("keycloak-issuer", `${keycloakIssuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`);
}

await validateQueueRoundtrip();
await validateObjectStorageRoundtrip();
await validateStripeWebhooks();
await validateGithubWebhooks();

if (emitJson) {
  console.log(JSON.stringify({
    ok: !failed,
    checks: results,
  }, null, 2));
}

if (failed) {
  process.exit(1);
}
