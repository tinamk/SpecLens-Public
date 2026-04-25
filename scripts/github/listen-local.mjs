import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigValue } from "../_env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const smeeClientBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "smee-client.cmd" : "smee-client",
);

function resolveWebhookProxyUrl() {
  const explicit = readConfigValue("GITHUB_LOCAL_WEBHOOK_PROXY_URL", "");
  if (explicit) {
    return explicit;
  }

  console.error("GITHUB_LOCAL_WEBHOOK_PROXY_URL is not set.");
  console.error("Create a channel at https://smee.io/new and save the generated URL into .env.");
  process.exit(1);
}

function resolveTargetUrl() {
  const explicit = readConfigValue("GITHUB_LOCAL_WEBHOOK_TARGET_URL", "");
  if (explicit) {
    return explicit;
  }

  const port = readConfigValue("PORT", "4000");
  return `http://127.0.0.1:${port}/api/webhooks/github`;
}

function resolveGatewayUrl() {
  return readConfigValue("GITHUB_GATEWAY_URL", "");
}

function resolveAppUrl() {
  return readConfigValue("APP_URL", "");
}

function resolveRegistrationToken() {
  return readConfigValue("GITHUB_GATEWAY_REGISTRATION_TOKEN", "");
}

async function registerGatewayTarget(webhookProxyUrl) {
  const gatewayUrl = resolveGatewayUrl();
  const appUrl = resolveAppUrl();
  const token = resolveRegistrationToken();
  if (!gatewayUrl || !appUrl || !token) {
    console.warn("Skipping GitHub gateway registration because GITHUB_GATEWAY_URL, APP_URL, or GITHUB_GATEWAY_REGISTRATION_TOKEN is missing.");
    return;
  }

  const response = await fetch(`${gatewayUrl.replace(/\/+$/, "")}/api/integrations/github/gateway/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      environmentLabel: `local-${os.hostname()}`,
      appUrl,
      webhookForwardUrl: webhookProxyUrl,
      kind: "local",
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub gateway registration failed: ${response.status} ${await response.text()}`);
  }
}

const webhookProxyUrl = resolveWebhookProxyUrl();
const targetUrl = resolveTargetUrl();
const probe = spawnSync(smeeClientBin, ["--help"], {
  stdio: "ignore",
});

if (probe.status !== 0) {
  console.error("smee-client is required to run the local GitHub webhook forwarder.");
  console.error("Run `npm install` from the repository root so the declared dev dependency is available.");
  process.exit(1);
}

console.log(`Forwarding GitHub App webhooks from ${webhookProxyUrl}`);
console.log(`Forward target: ${targetUrl}`);
console.log("Set your GitHub App webhook URL to the smee URL above while testing locally.");
console.log("");

await registerGatewayTarget(webhookProxyUrl);
const refreshIntervalMs = Math.max(30_000, Number.parseInt(readConfigValue("GITHUB_WEBHOOK_TARGET_REFRESH_MS", "240000"), 10) || 240_000);
const refreshTimer = setInterval(() => {
  registerGatewayTarget(webhookProxyUrl).catch(error => {
    console.warn(`GitHub gateway target refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, refreshIntervalMs);

const child = spawn(smeeClientBin, [
  "--url",
  webhookProxyUrl,
  "--target",
  targetUrl,
], {
  stdio: "inherit",
});
child.on("exit", code => {
  clearInterval(refreshTimer);
  process.exit(code ?? 0);
});
