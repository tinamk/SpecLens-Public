import fs from "node:fs";
import { spawn } from "node:child_process";

function loadDotEnv(filePath = ".env") {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const envText = fs.readFileSync(filePath, "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }
    const separatorIndex = rawLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function waitForHttp(url, timeoutMs = 180000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function resolveOptionalEnv(name) {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function main() {
  loadDotEnv();

  const testTargets = process.argv.slice(2);
  const playwrightArgs = ["playwright", "test", ...(testTargets.length > 0 ? testTargets : ["tests/e2e"])];
  const runningGithubOnly = testTargets.length > 0 && testTargets.every(target => target.includes("github-public.spec.ts"));
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_BASE_URL ?? process.env.APP_URL;
  if (!baseUrl) {
    throw new Error("Set PLAYWRIGHT_BASE_URL or E2E_BASE_URL for production E2E.");
  }

  requireEnv("E2E_OWNER_USERNAME");
  requireEnv("E2E_OWNER_PASSWORD");
  if (runningGithubOnly) {
    requireEnv("E2E_GITHUB_INSTALLATION_ID");
    requireEnv("E2E_GITHUB_PRIVATE_REPO_URL");
    requireEnv("E2E_GITHUB_PRIVATE_REPO_FULL_NAME");
  } else {
    requireEnv("E2E_MEMBER_USERNAME");
    requireEnv("E2E_MEMBER_PASSWORD");
    requireEnv("E2E_OUTSIDER_USERNAME");
    requireEnv("E2E_OUTSIDER_PASSWORD");
  }

  await waitForHttp(baseUrl);
  const apiReadyUrl = resolveOptionalEnv("E2E_API_READY_URL");
  if (apiReadyUrl) {
    await waitForHttp(apiReadyUrl);
  }

  await runCommand("npx", playwrightArgs, {
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: baseUrl,
    },
  });
}

void main().catch(error => {
  console.error("[e2e:production] failed", error);
  process.exitCode = 1;
});
