#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const LOCAL_DEV_PORTAL_SECRET_NAMESPACE = "speclens-local-dev-portal-auth";
const DEFAULT_WORKSPACE_NAME = "SpecLens self-improvement";
const DEFAULT_WORKSPACE_DESCRIPTION = "Dogfood workspace for iterative SpecLens self-improvement runs.";
const DEFAULT_RUNTIME_MODE = "browser";
const DEFAULT_CODEX_SCOPE = "workspace";
const STANDARD_ANALYZE_TIMEOUT_MS = 90 * 60 * 1000;
const RUNTIME_FAST_ANALYZE_TIMEOUT_MS = 25 * 60 * 1000;
const AGENT_PROFILES = Object.freeze({
  standard: Object.freeze({
    agentId: "agent-universal-standard",
    timeoutMs: STANDARD_ANALYZE_TIMEOUT_MS,
  }),
  "runtime-fast": Object.freeze({
    agentId: "agent-e2e-runtime-tooling-fast",
    timeoutMs: RUNTIME_FAST_ANALYZE_TIMEOUT_MS,
  }),
});
const DEFAULT_PROFILE = "standard";
const DEFAULT_AGENT_ID = AGENT_PROFILES[DEFAULT_PROFILE].agentId;
const DEFAULT_TIMEOUT_MS = AGENT_PROFILES[DEFAULT_PROFILE].timeoutMs;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_LOCAL_OWNER_USERNAME = "owner";
const DEFAULT_LOCAL_OWNER_PASSWORD = "owner-password";
const DEFAULT_COMPOSE_FILE = "docker-compose.yml";
const DEFAULT_AGENT_SANDBOX_IMAGE = "speclens/ai-agent-sandbox:local";
const DEFAULT_RUNNER_SANDBOX_IMAGE = "speclens/analysis-runner:local";
const EXECUTION_STEP_EVENT_PREFIX = "__speclens_step__";
const SESSION_COOKIE_NAME = "speclens_portal_session";
const CSRF_COOKIE_NAME = "speclens_csrf";
const ID_TOKEN_COOKIE_NAME = "speclens_portal_id_token";

function printUsage() {
  console.log(`Usage:
  node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs analyze [options]
  node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs collect [options]
  node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs remediate [options]

Analyze options:
  --repo <path>                 Repo to archive. Defaults to the current Git repo.
  --ref <git-ref>               Git ref to archive. Defaults to HEAD.
  --workspace-name <name>       Workspace name. Defaults to "${DEFAULT_WORKSPACE_NAME}".
  --workspace-description <txt> Workspace description for first-time creation.
  --profile <name>              Agent profile: standard or runtime-fast. Defaults to ${DEFAULT_PROFILE}.
  --agent-id <id>               Agent to run. Defaults to the selected profile agent (${DEFAULT_AGENT_ID} for standard).
  --runtime-mode <mode>         Runtime mode. Defaults to ${DEFAULT_RUNTIME_MODE}.
  --codex-scope <scope>         Codex auth scope. Defaults to ${DEFAULT_CODEX_SCOPE}.
  --api-url <url>               API base URL. Defaults to API_URL or http://localhost:4000.
  --app-url <url>               App URL used for local-dev auth secret derivation.
  --username <name>             Keycloak username when API_AUTH_MODE=keycloak.
  --password <value>            Keycloak password when API_AUTH_MODE=keycloak.
  --compose-file <path>         Compose file for sandbox preflight. Defaults to ${DEFAULT_COMPOSE_FILE}.
  --agent-sandbox-image <img>   Hosted agent sandbox image. Defaults to ${DEFAULT_AGENT_SANDBOX_IMAGE}.
  --runner-sandbox-image <img>  Runner sandbox image. Defaults to ${DEFAULT_RUNNER_SANDBOX_IMAGE}.
  --output-dir <path>           Evidence root. Defaults to .speclens-workspace/self-improvement.
  --timeout-ms <ms>             Wait timeout. Defaults to the selected profile timeout (${DEFAULT_TIMEOUT_MS} for standard).
  --poll-ms <ms>                Poll interval. Defaults to ${DEFAULT_POLL_MS}.
  --no-wait                     Queue the job and exit after writing summary.json.
  --no-sandbox-preflight        Skip local Docker sandbox stack checks before queueing.
  --no-strict-sandbox-evidence  Download evidence but do not fail if sandbox launch evidence is missing.

Collect options:
  --repo <path>                 Repo root. Defaults to the current Git repo.
  --job-id <id>                 Existing job id to collect.
  --api-url <url>               API base URL. Defaults to API_URL or http://localhost:4000.
  --app-url <url>               App URL used for local-dev auth secret derivation.
  --username <name>             Keycloak username when API_AUTH_MODE=keycloak.
  --password <value>            Keycloak password when API_AUTH_MODE=keycloak.
  --output-dir <path>           Evidence root. Defaults to .speclens-workspace/self-improvement.
  --timeout-ms <ms>             Wait timeout when the job is still running. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --poll-ms <ms>                Poll interval. Defaults to ${DEFAULT_POLL_MS}.
  --no-wait                     Download current evidence without waiting for a terminal job status.
  --no-strict-sandbox-evidence  Download evidence but do not fail if sandbox launch evidence is missing.

Remediation options:
  --repo <path>                 Repo root. Defaults to the current Git repo.
  --analysis-summary <path>     Summary from a prior analyze run.
  --workspace-id <id>           Workspace id when not loading from a summary.
  --report-id <id>              Report id when not loading from a summary.
  --source-id <id>              Source id when not loading from a summary.
  --base-ref <ref>              Base ref for remediation. Defaults to HEAD.
  --selection-mode <mode>       Defaults to auto-priority.
  --max-iterations <n>          Defaults to 2.
  --output-mode <mode>          Defaults to changeset.
  --publish-remote <bool>       Defaults to false.
  --codex-scope <scope>         Auth scope check. Defaults to prior summary or ${DEFAULT_CODEX_SCOPE}.
  --api-url <url>               API base URL. Defaults to API_URL or http://localhost:4000.
  --app-url <url>               App URL used for local-dev auth secret derivation.
  --username <name>             Keycloak username when API_AUTH_MODE=keycloak.
  --password <value>            Keycloak password when API_AUTH_MODE=keycloak.
  --compose-file <path>         Compose file for sandbox preflight. Defaults to ${DEFAULT_COMPOSE_FILE}.
  --agent-sandbox-image <img>   Hosted agent sandbox image. Defaults to ${DEFAULT_AGENT_SANDBOX_IMAGE}.
  --runner-sandbox-image <img>  Runner sandbox image. Defaults to ${DEFAULT_RUNNER_SANDBOX_IMAGE}.
  --output-dir <path>           Evidence root. Defaults to .speclens-workspace/self-improvement.
  --timeout-ms <ms>             Wait timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --poll-ms <ms>                Poll interval. Defaults to ${DEFAULT_POLL_MS}.
  --no-wait                     Queue the job and exit after writing summary.json.
  --no-sandbox-preflight        Skip local Docker sandbox stack checks before queueing.
  --no-strict-sandbox-evidence  Download evidence but do not fail if sandbox launch evidence is missing.

Notes:
  - This helper supports local hosted stacks in both local-dev and Keycloak mode.
  - Analyze uploads a committed Git archive, so the audited source is the chosen Git ref.
  - Use --profile runtime-fast for fast sandbox/runtime/browser/Playwright/artifact dogfood loops.
  - Hosted jobs must execute through ai-worker -> Docker sandbox. The default preflight fails if job-dind, ai-worker, or sandbox images are not ready.`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const raw = token.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (raw.startsWith("no-") && equalsIndex === -1) {
      args[raw.slice(3)] = false;
      continue;
    }
    if (equalsIndex >= 0) {
      args[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[raw] = next;
      index += 1;
      continue;
    }
    args[raw] = true;
  }
  return args;
}

function readStringArg(args, key, fallback = null) {
  const value = args[key];
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().length > 0 ? value.trim() : fallback;
}

function readBooleanArg(args, key, fallback) {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return fallback;
}

function readIntegerArg(args, key, fallback) {
  const value = readStringArg(args, key, null);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readCodexScopeArg(args, key, fallback) {
  const value = readStringArg(args, key, fallback);
  if (value === "user" || value === "workspace" || value === "global") {
    return value;
  }
  throw new Error(`Invalid ${key} value "${value}". Expected user, workspace, or global.`);
}

function readAnalyzeProfile(args) {
  const name = readStringArg(args, "profile", DEFAULT_PROFILE);
  const profile = AGENT_PROFILES[name];
  if (!profile) {
    throw new Error(`Invalid profile value "${name}". Expected one of: ${Object.keys(AGENT_PROFILES).join(", ")}.`);
  }
  return { name, ...profile };
}

function ensureArg(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const parsed = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) {
      continue;
    }
    const key = match[1];
    let value = match[2] ?? "";
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
    parsed[key] = value;
  }
  return parsed;
}

function resolveMergedEnv(repoRoot) {
  return {
    ...parseDotEnvFile(path.join(repoRoot, ".env")),
    ...process.env,
  };
}

function normalizeOrigin(value, fallback) {
  return new URL((value ?? fallback) || fallback).origin;
}

function isTrustedLocalHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "[::1]") {
    return true;
  }
  if (lower.endsWith(".local")) {
    return true;
  }
  if (/^127(?:\.\d{1,3}){3}$/u.test(lower)) {
    return true;
  }
  if (/^10(?:\.\d{1,3}){3}$/u.test(lower)) {
    return true;
  }
  if (/^192\.168(?:\.\d{1,3}){2}$/u.test(lower)) {
    return true;
  }
  const match172 = lower.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/u);
  if (match172) {
    const secondOctet = Number.parseInt(match172[1], 10);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

function resolveLocalDevAuthEnv(env, options) {
  const appUrl = normalizeOrigin(options.appUrl ?? env.APP_URL, "http://localhost:3000");
  const apiUrl = normalizeOrigin(options.apiUrl ?? env.API_URL, "http://localhost:4000");
  const portalSessionSecret = env.PORTAL_SESSION_SECRET?.trim();
  const csrfSecret = env.CSRF_SECRET?.trim();
  const safeLocalContext = env.SPECLENS_ALLOW_UNSAFE_LOCAL_DEV_AUTH === "true"
    || (
      env.API_AUTH_MODE === "local-dev"
      && isTrustedLocalHostname(new URL(appUrl).hostname)
      && isTrustedLocalHostname(new URL(apiUrl).hostname)
    );
  if (!safeLocalContext) {
    throw new Error(
      "This helper expects a local hosted stack with API_AUTH_MODE=local-dev. Start the local stack in local-dev auth mode or handle auth manually.",
    );
  }
  if (portalSessionSecret && csrfSecret) {
    return { ...env, APP_URL: appUrl, API_URL: apiUrl };
  }
  const buildFallbackSecret = kind => {
    const seed = [kind, options.secretSeedRoot, appUrl, apiUrl].join("|");
    return crypto.createHash("sha256").update(`${LOCAL_DEV_PORTAL_SECRET_NAMESPACE}|${seed}`).digest("hex");
  };
  return {
    ...env,
    APP_URL: appUrl,
    API_URL: apiUrl,
    PORTAL_SESSION_SECRET: portalSessionSecret || csrfSecret || buildFallbackSecret("session"),
    CSRF_SECRET: csrfSecret || portalSessionSecret || buildFallbackSecret("csrf"),
  };
}

function encodePortalSessionToken(session, env) {
  const body = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", env.PORTAL_SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function buildPortalCsrfToken(sessionToken, env) {
  return crypto.createHmac("sha256", env.CSRF_SECRET).update(sessionToken).digest("hex");
}

function createLocalDevAuthHeaders(env) {
  const sessionToken = encodePortalSessionToken({
    provider: "local-dev",
    subject: "local-dev-user",
    email: "local-dev@speclens.test",
    displayName: "Local Dev User",
  }, env);
  const csrfToken = buildPortalCsrfToken(sessionToken, env);
  return {
    cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
    "x-csrf-token": csrfToken,
  };
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", chunk => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

async function runCommandAllowFailure(command, args, options = {}) {
  try {
    return {
      ok: true,
      ...(await runCommand(command, args, options)),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveRepoRoot(repoArg) {
  const candidate = path.resolve(repoArg ?? process.cwd());
  const { stdout } = await runCommand("git", ["-C", candidate, "rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

function resolveOutputRoot(repoRoot, outputDirArg) {
  const value = outputDirArg ?? ".speclens-workspace/self-improvement";
  return path.resolve(repoRoot, value);
}

function sanitizePathSegment(value, fallback = "artifact") {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function artifactRelativePath(artifactKey, index) {
  const parts = artifactKey.split("/").filter(Boolean).map((segment, segmentIndex) =>
    sanitizePathSegment(segment, segmentIndex === 0 ? `artifact-${index}` : "part"));
  return path.join(...(parts.length > 0 ? parts : [`artifact-${index}`]));
}

async function mkdirp(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, value) {
  await mkdirp(path.dirname(filePath));
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveComposeFile(repoRoot, args, env) {
  const composeFile = readStringArg(
    args,
    "compose-file",
    env.SPECLENS_SELF_IMPROVEMENT_COMPOSE_FILE ?? DEFAULT_COMPOSE_FILE,
  );
  return path.isAbsolute(composeFile) ? composeFile : path.resolve(repoRoot, composeFile);
}

function buildComposeCommand(composeFile, services = ["caddy", "web", "api", "runner", "ai-worker"]) {
  return `docker compose -f ${JSON.stringify(composeFile)} up -d --build ${services.join(" ")}`;
}

async function runCompose(repoRoot, composeFile, args) {
  return await runCommand("docker", ["compose", "-f", composeFile, ...args], { cwd: repoRoot });
}

function parseServiceList(stdout) {
  return stdout.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
}

async function ensureHostedSandboxPreflight(repoRoot, args, env) {
  const enabled = readBooleanArg(args, "sandbox-preflight", true);
  const composeFile = resolveComposeFile(repoRoot, args, env);
  const agentSandboxImage = readStringArg(
    args,
    "agent-sandbox-image",
    env.AI_WORKER_SANDBOX_IMAGE ?? DEFAULT_AGENT_SANDBOX_IMAGE,
  );
  const runnerSandboxImage = readStringArg(
    args,
    "runner-sandbox-image",
    env.SANDBOX_IMAGE ?? DEFAULT_RUNNER_SANDBOX_IMAGE,
  );
  if (!enabled) {
    return {
      status: "skipped",
      composeFile,
      agentSandboxImage,
      runnerSandboxImage,
      reason: "--no-sandbox-preflight",
    };
  }
  if (!fs.existsSync(composeFile)) {
    throw new Error(`Sandbox preflight compose file does not exist: ${composeFile}`);
  }

  const config = await runCompose(repoRoot, composeFile, ["config"]);
  const configText = config.stdout;
  const requiredConfigSnippets = [
    "\n  job-dind:",
    "DOCKER_HOST: tcp://job-dind:2375",
    `AI_WORKER_SANDBOX_IMAGE: ${agentSandboxImage}`,
  ];
  const missingConfigSnippets = requiredConfigSnippets.filter(snippet => !configText.includes(snippet));
  if (configText.includes("/var/run/docker.sock")) {
    throw new Error("Sandbox preflight failed: compose config still mounts /var/run/docker.sock.");
  }
  if (missingConfigSnippets.length > 0) {
    throw new Error(`Sandbox preflight failed: compose config is missing ${missingConfigSnippets.join(", ")}.`);
  }

  const ps = await runCompose(repoRoot, composeFile, ["ps", "--status", "running", "--services"]);
  const runningServices = parseServiceList(ps.stdout);
  const requiredRunningServices = ["job-dind", "api", "ai-worker"];
  const missingRunningServices = requiredRunningServices.filter(service => !runningServices.includes(service));
  if (missingRunningServices.length > 0) {
    throw new Error(
      `Sandbox preflight failed: missing running service(s): ${missingRunningServices.join(", ")}.\n`
        + `Start the hosted stack with: ${buildComposeCommand(composeFile)}`,
    );
  }

  const imageInspect = await runCommandAllowFailure("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "job-dind",
    "sh",
    "-lc",
    `DOCKER_HOST=tcp://127.0.0.1:2375 docker image inspect ${JSON.stringify(agentSandboxImage)} ${JSON.stringify(runnerSandboxImage)} >/dev/null`,
  ], { cwd: repoRoot });
  if (!imageInspect.ok) {
    throw new Error(
      `Sandbox preflight failed: nested Docker daemon is missing a sandbox image.\n`
        + `Expected images: ${agentSandboxImage}, ${runnerSandboxImage}\n`
        + `Rebuild/seed them with: ${buildComposeCommand(composeFile, ["runner-sandbox-image-init", "ai-agent-sandbox-image-init"])}\n`
        + imageInspect.stderr,
    );
  }

  return {
    status: "ready",
    composeFile,
    agentSandboxImage,
    runnerSandboxImage,
    runningServices,
    requiredRunningServices,
    hostDockerSocketMounted: false,
    nestedDockerImages: [agentSandboxImage, runnerSandboxImage],
  };
}

function summarizeReport(report) {
  if (!report) {
    return null;
  }
  return {
    id: report.id,
    status: report.status,
    title: report.title,
    runtimeMode: report.runtimeMode,
    findings: report.findings.length,
    sections: report.sections.length,
    blockers: report.summary?.blockers?.length ?? 0,
    recommendations: report.summary?.recommendations?.length ?? 0,
    latestRemediationJobId: report.summary?.latestRemediationJobId ?? null,
  };
}

class ApiClient {
  constructor(baseUrl, pathPrefix, authHeaders, options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.pathPrefix = pathPrefix;
    this.authHeaders = authHeaders;
    this.refreshAuthHeaders = options.refreshAuthHeaders ?? null;
    this.activeRefresh = null;
  }

  async getAuthHeaders(forceRefresh = false) {
    if (!forceRefresh || typeof this.refreshAuthHeaders !== "function") {
      return this.authHeaders;
    }
    if (!this.activeRefresh) {
      this.activeRefresh = Promise.resolve(this.refreshAuthHeaders())
        .then(headers => {
          this.authHeaders = headers;
          return headers;
        })
        .finally(() => {
          this.activeRefresh = null;
        });
    }
    return await this.activeRefresh;
  }

  async request(method, pathname, options = {}, attempt = 0) {
    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const url = new URL(`${this.pathPrefix}${normalizedPath}`, `${this.baseUrl}/`);
    if (options.query) {
      for (const [key, rawValue] of Object.entries(options.query)) {
        if (rawValue === null || rawValue === undefined || rawValue === "") {
          continue;
        }
        url.searchParams.set(key, String(rawValue));
      }
    }
    const headers = new Headers(await this.getAuthHeaders());
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        if (value !== undefined && value !== null) {
          headers.set(key, value);
        }
      }
    }
    let body;
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.json);
    } else if (options.formData) {
      body = options.formData;
    }
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "follow",
      });
    } catch (error) {
      if (method === "GET" && attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, Math.min(10_000, 500 * (attempt + 1))));
        return await this.request(method, pathname, options, attempt + 1);
      }
      throw new Error(`Failed to reach ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401 && attempt === 0 && typeof this.refreshAuthHeaders === "function") {
      await this.getAuthHeaders(true);
      return await this.request(method, pathname, options, attempt + 1);
    }
    if (options.raw === true) {
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`${method} ${url.pathname} failed: ${response.status} ${message || response.statusText}`);
      }
      return response;
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const message = typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(`${method} ${url.pathname} failed: ${response.status} ${message}`);
    }
    return payload;
  }

  async get(pathname, options) {
    return await this.request("GET", pathname, options);
  }

  async post(pathname, options) {
    return await this.request("POST", pathname, options);
  }
}

function isKeycloakLoginUrl(url) {
  return url.includes("/protocol/openid-connect/auth") || url.includes(":18081") || url.includes("keycloak");
}

async function createKeycloakProxySession(appUrl, args, env) {
  const username = readStringArg(
    args,
    "username",
    env.E2E_LOCAL_OWNER_USERNAME
      ?? env.E2E_OWNER_USERNAME
      ?? DEFAULT_LOCAL_OWNER_USERNAME,
  );
  const password = readStringArg(
    args,
    "password",
    env.E2E_LOCAL_OWNER_PASSWORD
      ?? env.E2E_OWNER_PASSWORD
      ?? DEFAULT_LOCAL_OWNER_PASSWORD,
  );
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL("/portal/workspaces", `${appUrl}/`).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle");
    if (isKeycloakLoginUrl(page.url())) {
      const usernameInput = page.locator("#username");
      const passwordInput = page.locator("#password");
      const submit = page.locator("#kc-login");
      await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
      await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
      await usernameInput.fill(username);
      await passwordInput.fill(password);
      await Promise.all([
        page.waitForURL(/\/portal\//, { timeout: 90_000 }),
        submit.click(),
      ]);
      await page.waitForLoadState("networkidle");
    }
    const cookies = await context.cookies(appUrl);
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
    const idToken = cookies.find(cookie => cookie.name === ID_TOKEN_COOKIE_NAME)?.value ?? null;
    if (!cookieHeader.includes(`${SESSION_COOKIE_NAME}=`) || !idToken) {
      throw new Error("Keycloak login completed without the expected portal session cookies.");
    }
    return {
      idToken,
      auth: {
        scope: "proxy-session",
        status: "ready",
        authMode: "keycloak",
        accountId: null,
        lastRefresh: null,
        username,
      },
    };
  } finally {
    await browser.close();
  }
}

function resolveApiOrigin(args, env, options = {}) {
  const explicitApiUrl = readStringArg(args, "api-url", null);
  if (explicitApiUrl) {
    return normalizeOrigin(explicitApiUrl, "http://localhost:4000");
  }
  if (options.preferHostPort === true) {
    const apiPort = env.API_PORT?.trim();
    if (apiPort) {
      return normalizeOrigin(`http://localhost:${apiPort}`, "http://localhost:4000");
    }
  }
  return normalizeOrigin(readStringArg(args, "api-url", env.API_URL), "http://localhost:4000");
}

async function createRuntimeClient(args, mergedEnv, repoRoot) {
  const authMode = mergedEnv.API_AUTH_MODE === "local-dev" ? "local-dev" : "keycloak";
  const apiUrl = resolveApiOrigin(args, mergedEnv, { preferHostPort: authMode === "keycloak" });
  const appUrl = normalizeOrigin(readStringArg(args, "app-url", mergedEnv.APP_URL ?? apiUrl), "http://localhost:3000");
  if (authMode === "local-dev") {
    const localDevAuthEnv = resolveLocalDevAuthEnv(mergedEnv, {
      apiUrl,
      appUrl,
      secretSeedRoot: repoRoot,
    });
    return {
      authMode,
      apiUrl,
      appUrl,
      client: new ApiClient(apiUrl, "", createLocalDevAuthHeaders(localDevAuthEnv)),
      auth: {
        scope: "local-dev",
        status: "ready",
        authMode: "local-dev",
        accountId: null,
        lastRefresh: null,
      },
    };
  }
  const keycloakSession = await createKeycloakProxySession(appUrl, args, mergedEnv);
  return {
    authMode,
    apiUrl,
    appUrl,
    client: new ApiClient(
      apiUrl,
      "",
      {
        authorization: `Bearer ${keycloakSession.idToken}`,
      },
      {
        refreshAuthHeaders: async () => {
          const refreshedSession = await createKeycloakProxySession(appUrl, args, mergedEnv);
          return {
            authorization: `Bearer ${refreshedSession.idToken}`,
          };
        },
      },
    ),
    auth: keycloakSession.auth,
  };
}

async function ensureWorkspace(client, workspaceName, workspaceDescription) {
  const payload = await client.get("/api/workspaces", {
    query: {
      q: workspaceName,
      pageSize: 100,
    },
  });
  const existing = (payload.items ?? [])
    .find(item => item?.workspace?.name === workspaceName);
  if (existing) {
    return existing.workspace;
  }
  const created = await client.post("/api/workspaces", {
    json: {
      name: workspaceName,
      description: workspaceDescription,
    },
  });
  return created.workspace;
}

async function completeCheckoutSession(apiUrl, checkoutSessionId, webhookSecret) {
  const { default: Stripe } = await import("stripe");
  const payload = JSON.stringify({
    id: `evt_${checkoutSessionId}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutSessionId,
        object: "checkout.session",
        metadata: {},
        subscription: `sub_${checkoutSessionId}`,
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const response = await fetch(new URL("/api/webhooks/stripe", `${apiUrl}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Stripe webhook completion failed: ${response.status} ${text}`);
  }
}

async function ensureProWorkspace(client, workspace, mergedEnv, apiUrl) {
  if (workspace.entitlement === "pro") {
    return workspace;
  }
  const webhookSecret = mergedEnv.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required to auto-upgrade the workspace for archive uploads.");
  }
  const checkout = await client.post("/api/billing/checkout", {
    json: {
      workspaceId: workspace.id,
      plan: "pro",
    },
  });
  if (!checkout?.checkoutSessionId) {
    throw new Error(`Checkout response did not include a checkoutSessionId: ${JSON.stringify(checkout)}`);
  }
  await completeCheckoutSession(apiUrl, checkout.checkoutSessionId, webhookSecret);
  const detail = await client.get(`/api/workspaces/${workspace.id}`);
  return detail.workspace ?? workspace;
}

async function ensureWorkspaceCodexAuth(client, workspaceId) {
  const statusPayload = await client.get(`/api/workspaces/${workspaceId}/ai/auth/status`);
  if (statusPayload.auth?.status === "ready" && statusPayload.auth?.disabled !== true) {
    return statusPayload.auth;
  }
  try {
    const importPayload = await client.post(`/api/workspaces/${workspaceId}/ai/auth/import-local`);
    if (importPayload.auth?.status === "ready" && importPayload.auth?.disabled !== true) {
      return importPayload.auth;
    }
  } catch (error) {
    throw new Error(
      `Workspace Codex auth import failed. Make sure local Codex auth exists, then rerun. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const refreshedPayload = await client.get(`/api/workspaces/${workspaceId}/ai/auth/status`);
  if (refreshedPayload.auth?.status === "ready" && refreshedPayload.auth?.disabled !== true) {
    return refreshedPayload.auth;
  }
  throw new Error(`Workspace Codex auth is not ready: ${JSON.stringify(refreshedPayload.auth)}`);
}

async function ensureUserCodexAuth(client) {
  const statusPayload = await client.get("/api/me/ai/auth/status");
  if (statusPayload.auth?.status === "ready" && statusPayload.auth?.disabled !== true) {
    return statusPayload.auth;
  }
  try {
    const importPayload = await client.post("/api/me/ai/auth/import-local");
    if (importPayload.auth?.status === "ready" && importPayload.auth?.disabled !== true) {
      return importPayload.auth;
    }
  } catch (error) {
    throw new Error(
      `User Codex auth import failed. Make sure local Codex auth exists, then rerun. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const refreshedPayload = await client.get("/api/me/ai/auth/status");
  if (refreshedPayload.auth?.status === "ready" && refreshedPayload.auth?.disabled !== true) {
    return refreshedPayload.auth;
  }
  throw new Error(`User Codex auth is not ready: ${JSON.stringify(refreshedPayload.auth)}`);
}

async function ensureScopedCodexAuth(client, scope, workspaceId) {
  if (scope === "workspace") {
    return await ensureWorkspaceCodexAuth(client, ensureArg(workspaceId, "workspaceId is required for workspace Codex auth."));
  }
  if (scope === "user") {
    return await ensureUserCodexAuth(client);
  }
  return {
    scope,
    status: "not-checked",
    authMode: null,
    accountId: null,
    lastRefresh: null,
  };
}

async function createGitArchive(repoRoot, gitRef) {
  const { stdout: resolvedRefStdout } = await runCommand("git", ["-C", repoRoot, "rev-parse", gitRef]);
  const resolvedRef = resolvedRefStdout.trim();
  const repoName = path.basename(repoRoot);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "speclens-self-improvement-"));
  const snapshotRoot = path.join(tempDir, `${sanitizePathSegment(repoName)}-${resolvedRef.slice(0, 12)}`);
  const archiveFilename = `${sanitizePathSegment(repoName)}-${resolvedRef.slice(0, 12)}.tar.gz`;
  const archivePath = path.join(tempDir, archiveFilename);
  await mkdirp(snapshotRoot);
  await runCommand("sh", [
    "-lc",
    `git -C ${JSON.stringify(repoRoot)} archive --format=tar ${JSON.stringify(gitRef)} | tar -xf - -C ${JSON.stringify(snapshotRoot)}`,
  ]);
  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "SpecLens Self Improvement",
    GIT_AUTHOR_EMAIL: "self-improvement@speclens.dev",
    GIT_COMMITTER_NAME: "SpecLens Self Improvement",
    GIT_COMMITTER_EMAIL: "self-improvement@speclens.dev",
  };
  await runCommand("git", ["init", "--quiet"], { cwd: snapshotRoot, env: commitEnv });
  await runCommand("git", ["add", "--all"], { cwd: snapshotRoot, env: commitEnv });
  await runCommand("git", ["commit", "--quiet", "-m", `snapshot ${resolvedRef}`], { cwd: snapshotRoot, env: commitEnv });
  await runCommand("tar", ["-czf", archivePath, "-C", tempDir, path.basename(snapshotRoot)]);
  return {
    tempDir,
    snapshotRoot,
    archivePath,
    archiveFilename,
    gitRef,
    resolvedRef,
  };
}

async function uploadArchiveSource(client, workspaceId, archivePath, archiveFilename) {
  const authHeaders = await client.getAuthHeaders();
  if (typeof authHeaders?.authorization === "string") {
    const uploadUrl = new URL(`/api/workspaces/${workspaceId}/uploads`, `${client.baseUrl}/`).toString();
    const { stdout } = await runCommand("sh", [
      "-lc",
      "curl -sS -w '\\n%{http_code}' -X POST "
        + "-H \"authorization: $SPECLENS_AUTHORIZATION\" "
        + "-F \"file=@$SPECLENS_ARCHIVE_PATH;filename=$SPECLENS_ARCHIVE_FILENAME;type=application/gzip\" "
        + "\"$SPECLENS_UPLOAD_URL\"",
    ], {
      env: {
        ...process.env,
        SPECLENS_AUTHORIZATION: authHeaders.authorization,
        SPECLENS_ARCHIVE_PATH: archivePath,
        SPECLENS_ARCHIVE_FILENAME: archiveFilename,
        SPECLENS_UPLOAD_URL: uploadUrl,
      },
    });
    const trimmed = stdout.trimEnd();
    const newlineIndex = trimmed.lastIndexOf("\n");
    const body = newlineIndex >= 0 ? trimmed.slice(0, newlineIndex) : trimmed;
    const status = Number.parseInt(newlineIndex >= 0 ? trimmed.slice(newlineIndex + 1) : "", 10);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      throw new Error(`Archive upload failed: ${status || "unknown"} ${body}`);
    }
    const payload = JSON.parse(body);
    if (!payload?.source?.id) {
      throw new Error(`Archive upload response was missing a source payload: ${body}`);
    }
    return payload.source;
  }
  const form = new FormData();
  const buffer = await fsp.readFile(archivePath);
  form.set("file", new Blob([buffer]), archiveFilename);
  const payload = await client.post(`/api/workspaces/${workspaceId}/uploads`, {
    formData: form,
  });
  return payload.source;
}

async function queueAnalysis(client, workspaceId, options) {
  const payload = await client.post(`/api/workspaces/${workspaceId}/analyze`, {
    json: {
      sourceId: options.sourceId,
      agentId: options.agentId,
      runtimeMode: options.runtimeMode,
      codexAuthScope: options.codexScope,
    },
  });
  return payload.job;
}

async function queueRemediation(client, reportId, options) {
  const payload = await client.post(`/api/reports/${reportId}/remediate`, {
    json: {
      sourceId: options.sourceId,
      baseRef: options.baseRef,
      selectionMode: options.selectionMode,
      maxIterations: options.maxIterations,
      outputMode: options.outputMode,
      publishRemote: options.publishRemote,
    },
  });
  return payload.job;
}

function isTerminalStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function formatLogLine(log) {
  return `[${log.level}] ${log.scope}: ${log.message}`;
}

async function waitForJob(client, jobId, options) {
  const startedAt = Date.now();
  const seenLogIds = new Set();
  let lastStatus = null;
  while (true) {
    const envelope = await client.get(`/api/jobs/${jobId}`, {
      query: { verbosity: "verbose" },
    });
    for (const log of envelope.job.logs ?? []) {
      if (seenLogIds.has(log.id)) {
        continue;
      }
      seenLogIds.add(log.id);
      console.log(formatLogLine(log));
    }
    const status = envelope.job.job?.status ?? "unknown";
    if (status !== lastStatus) {
      console.log(`job ${jobId} status=${status}`);
      lastStatus = status;
    }
    if (isTerminalStatus(status)) {
      return envelope.job;
    }
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error(`Timed out waiting for job ${jobId} after ${options.timeoutMs}ms.`);
    }
    await new Promise(resolve => setTimeout(resolve, options.pollMs));
  }
}

async function downloadArtifacts(client, jobId, artifacts, outputDir) {
  const artifactsDir = path.join(outputDir, "artifacts");
  await mkdirp(artifactsDir);
  const downloads = [];
  for (const [index, artifact] of artifacts.entries()) {
    const response = await client.get(`/api/jobs/${jobId}/artifacts/${index}`, { raw: true });
    const buffer = Buffer.from(await response.arrayBuffer());
    const relativePath = artifactRelativePath(artifact.key, index);
    const filePath = path.join(artifactsDir, relativePath);
    await mkdirp(path.dirname(filePath));
    await fsp.writeFile(filePath, buffer);
    downloads.push({
      index,
      artifactId: artifact.id,
      kind: artifact.kind,
      key: artifact.key,
      mimeType: response.headers.get("content-type") || artifact.mimeType,
      sizeBytes: buffer.byteLength,
      localPath: filePath,
    });
  }
  await writeJson(path.join(outputDir, "artifact-downloads.json"), downloads);
  return downloads;
}

function buildPatchApplyHints(downloads) {
  const patch = downloads.find(item => item.key.endsWith("patch-bundle.diff"));
  if (!patch) {
    return null;
  }
  return {
    patchPath: patch.localPath,
    checkCommand: `git apply --check ${JSON.stringify(patch.localPath)}`,
    applyCommand: `git apply ${JSON.stringify(patch.localPath)}`,
  };
}

function parseExecutionStepLog(log) {
  const message = String(log.message ?? "");
  if (!message.startsWith(EXECUTION_STEP_EVENT_PREFIX)) {
    return null;
  }
  try {
    return JSON.parse(message.slice(EXECUTION_STEP_EVENT_PREFIX.length));
  } catch {
    return null;
  }
}

function collectExecutionSteps(envelope, logs) {
  const direct = Array.isArray(envelope.executionSteps) ? envelope.executionSteps : [];
  const report = Array.isArray(envelope.report?.summary?.executionSteps)
    ? envelope.report.summary.executionSteps
    : [];
  const fromLogs = logs.map(parseExecutionStepLog).filter(Boolean);
  return [...direct, ...report, ...fromLogs];
}

function parseTimeMs(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function executionStepDurationMs(step) {
  if (typeof step.durationMs === "number" && Number.isFinite(step.durationMs)) {
    return Math.max(0, step.durationMs);
  }
  const startedAt = parseTimeMs(step.startedAt);
  const finishedAt = parseTimeMs(step.finishedAt);
  return startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) : null;
}

function isTerminalStepStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "skipped";
}

function dedupeExecutionSteps(steps) {
  const score = step => {
    const status = String(step.status ?? "");
    return (isTerminalStepStatus(status) ? 100 : 0)
      + (executionStepDurationMs(step) !== null ? 10 : 0)
      + (parseTimeMs(step.finishedAt) ?? 0) / 1_000_000_000_000;
  };
  const byId = new Map();
  for (const step of steps) {
    const id = String(step.id ?? "");
    if (!id) {
      continue;
    }
    const existing = byId.get(id);
    if (!existing || score(step) >= score(existing)) {
      byId.set(id, step);
    }
  }
  return [...byId.values()];
}

function summarizeRoleTimings(executionSteps) {
  const roleSteps = dedupeExecutionSteps(executionSteps)
    .filter(step => step.stepType === "role" || String(step.id ?? "").startsWith("role:"))
    .filter(step => isTerminalStepStatus(String(step.status ?? "")))
    .map(step => ({
      roleId: String(step.roleId ?? String(step.id ?? "").replace(/^role:/u, "")),
      roleName: String(step.roleName ?? step.title ?? step.roleId ?? step.id),
      executorKind: step.executorKind ?? null,
      nativeExecutorId: step.nativeExecutorId ?? null,
      status: String(step.status ?? "unknown"),
      startedAt: step.startedAt ?? null,
      finishedAt: step.finishedAt ?? null,
      durationMs: executionStepDurationMs(step),
      detail: step.detail ?? null,
    }))
    .filter(step => step.roleId && step.durationMs !== null);
  const started = roleSteps.map(step => parseTimeMs(step.startedAt)).filter(value => value !== null);
  const finished = roleSteps.map(step => parseTimeMs(step.finishedAt)).filter(value => value !== null);
  const rolePhaseDurationMs = started.length > 0 && finished.length > 0
    ? Math.max(...finished) - Math.min(...started)
    : null;
  const totalRoleDurationMs = roleSteps.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  const slowRoles = [...roleSteps]
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 8);
  return {
    roleCount: roleSteps.length,
    rolePhaseDurationMs,
    totalRoleDurationMs,
    observedParallelism: rolePhaseDurationMs && rolePhaseDurationMs > 0
      ? Number((totalRoleDurationMs / rolePhaseDurationMs).toFixed(2))
      : null,
    slowRoles,
    terminalStatusCounts: roleSteps.reduce((acc, step) => {
      acc[step.status] = (acc[step.status] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function summarizeLogsForSelfImprovement(logs) {
  const interesting = logs
    .filter(log => {
      const level = String(log.level ?? "");
      const message = String(log.message ?? "");
      return level === "warn"
        || level === "error"
        || /failed|missing|timed out|timeout|retry|invalid|could not|bubblewrap|bwrap|playwright|artifact/iu.test(message);
    })
    .filter(log => !String(log.message ?? "").startsWith(EXECUTION_STEP_EVENT_PREFIX))
    .map(log => ({
      level: log.level ?? null,
      scope: log.scope ?? null,
      message: String(log.message ?? "").slice(0, 700),
      createdAt: log.createdAt ?? null,
    }));
  return {
    warningCount: logs.filter(log => log.level === "warn").length,
    errorCount: logs.filter(log => log.level === "error").length,
    invalidRoleOutputRetries: logs.filter(log => /invalid role output/iu.test(String(log.message ?? ""))).length,
    samples: interesting.slice(-25),
  };
}

function summarizeArtifactsForSelfImprovement(report, artifacts, downloads) {
  const byKind = artifacts.reduce((acc, artifact) => {
    const kind = String(artifact.kind ?? "artifact");
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  const artifactAnalysis = report?.summary?.artifactAnalysis ?? null;
  return {
    artifactCount: artifacts.length,
    downloadedArtifactCount: downloads.length,
    byKind,
    expectedKinds: artifactAnalysis?.expectedKinds ?? [],
    presentKinds: artifactAnalysis?.presentKinds ?? Object.keys(byKind),
    missingKinds: artifactAnalysis?.missingKinds ?? [],
    invalidArtifacts: artifactAnalysis?.invalidArtifacts ?? [],
    summary: artifactAnalysis?.summary ?? null,
  };
}

function buildSelfImprovementAnalysis(evidence) {
  const executionSteps = collectExecutionSteps(evidence.envelope, evidence.logs);
  const roleTimings = summarizeRoleTimings(executionSteps);
  const logHealth = summarizeLogsForSelfImprovement(evidence.logs);
  const artifactHealth = summarizeArtifactsForSelfImprovement(evidence.report, evidence.artifacts, evidence.downloads);
  const qualityScorecard = evidence.report?.summary?.qualityScorecard ?? null;
  const startedAt = parseTimeMs(evidence.envelope.job?.startedAt);
  const finishedAt = parseTimeMs(evidence.envelope.job?.finishedAt);
  const runDurationMs = startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) : null;
  const recommendations = [];
  const slowestRole = roleTimings.slowRoles[0] ?? null;
  if (slowestRole && (slowestRole.durationMs ?? 0) > 180_000) {
    recommendations.push(`Target ${slowestRole.roleId} next; it is the slowest observed role at ${Math.round((slowestRole.durationMs ?? 0) / 1000)}s.`);
  }
  if (artifactHealth.missingKinds.length > 0) {
    recommendations.push(`Close missing artifact kinds before trusting the run: ${artifactHealth.missingKinds.join(", ")}.`);
  }
  if (logHealth.invalidRoleOutputRetries > 0) {
    recommendations.push("Investigate invalid role-output retries; they add latency and indicate prompt/schema drift.");
  }
  if (evidence.sandbox.status !== "ready") {
    recommendations.push(`Fix sandbox evidence before evaluating report quality: ${evidence.sandbox.warnings.join("; ")}.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("No hard tooling blocker was detected; use slow role timings for the next speed pass.");
  }
  return {
    status: evidence.envelope.job?.status ?? null,
    runDurationMs,
    qualityScore: qualityScorecard?.overallScore ?? null,
    releaseGate: evidence.report?.summary?.releaseGateDecision?.status ?? null,
    roleTimings,
    sandbox: evidence.sandbox,
    logs: logHealth,
    artifacts: artifactHealth,
    capabilityGaps: evidence.report?.summary?.capabilityGaps ?? [],
    recommendations,
  };
}

function summarizeSandboxEvidence(envelope, logs, artifacts) {
  const artifactKeys = artifacts.map(artifact => String(artifact.key ?? ""));
  const executionSteps = collectExecutionSteps(envelope, logs);
  const logMessages = logs.map(log => String(log.message ?? ""));
  const launchObserved = logs.some(log =>
    log.scope === "sandbox" && String(log.message ?? "").includes("Launching hosted agent sandbox"));
  const waitObserved = executionSteps.some(step =>
    String(step.id ?? "").startsWith("sandbox:") || String(step.title ?? "").toLowerCase().includes("sandbox"));
  const resultCollectionObserved = executionSteps.some(step =>
    String(step.id ?? "") === "sandbox:collect" || String(step.title ?? "").toLowerCase().includes("collect sandbox result"));
  const rawStdoutArtifact = artifactKeys.some(key => key.endsWith("sandbox-stdout.log"));
  const rawStderrArtifact = artifactKeys.some(key => key.endsWith("sandbox-stderr.log"));
  const stdoutStreamObserved = logs.some(log => log.scope === "sandbox-stdout");
  const stderrStreamObserved = logs.some(log => log.scope === "sandbox-stderr");
  const warnings = [];
  if (envelope.job?.executionPath !== "unified-agent") {
    warnings.push(`executionPath is ${envelope.job?.executionPath ?? "missing"}, expected unified-agent`);
  }
  if (!launchObserved) {
    warnings.push("missing sandbox launch log");
  }
  if (!waitObserved) {
    warnings.push("missing sandbox execution-step evidence");
  }
  if (envelope.job?.status === "succeeded" && !resultCollectionObserved) {
    warnings.push("missing sandbox result collection step");
  }
  if (!rawStdoutArtifact && !stdoutStreamObserved) {
    warnings.push("missing sandbox stdout artifact or streamed stdout logs");
  }
  return {
    status: warnings.length === 0 ? "ready" : "missing-evidence",
    executionPath: envelope.job?.executionPath ?? null,
    launchObserved,
    waitObserved,
    resultCollectionObserved,
    rawStdoutArtifact,
    rawStderrArtifact,
    stdoutStreamObserved,
    stderrStreamObserved,
    sandboxLogCount: logs.filter(log => String(log.scope ?? "").startsWith("sandbox")).length,
    sandboxStepCount: executionSteps.filter(step =>
      String(step.id ?? "").startsWith("sandbox:") || String(step.title ?? "").toLowerCase().includes("sandbox")).length,
    failureHints: logMessages
      .filter(message => /sandbox|docker|codex|playwright|bubblewrap|bwrap/iu.test(message))
      .slice(-20),
    warnings,
  };
}

function assertHostedSandboxEvidence(sandboxEvidence, jobId) {
  if (sandboxEvidence.status === "ready") {
    return;
  }
  throw new Error(
    `Job ${jobId} completed without complete hosted sandbox evidence: ${sandboxEvidence.warnings.join("; ")}`,
  );
}

async function collectJobEvidence(client, jobId, outputDir) {
  await mkdirp(outputDir);
  const envelopePayload = await client.get(`/api/jobs/${jobId}`, {
    query: { verbosity: "all" },
  });
  const logsPayload = await client.get(`/api/jobs/${jobId}/logs`, {
    query: { verbosity: "all" },
  });
  const artifactsPayload = await client.get(`/api/jobs/${jobId}/artifacts`);
  const envelope = envelopePayload.job;
  const logs = logsPayload.logs ?? envelope.logs ?? [];
  const artifacts = artifactsPayload.artifacts ?? envelope.artifacts ?? [];

  await writeJson(path.join(outputDir, "job-envelope.json"), envelope);
  await writeJson(path.join(outputDir, "job-logs.json"), logs);
  await writeJson(path.join(outputDir, "job-artifacts.json"), artifacts);
  const sandbox = summarizeSandboxEvidence(envelope, logs, artifacts);
  await writeJson(path.join(outputDir, "sandbox-evidence.json"), sandbox);

  let reportPayload = null;
  if (envelope.report?.id) {
    reportPayload = await client.get(`/api/reports/${envelope.report.id}`);
    await writeJson(path.join(outputDir, "report-api.json"), reportPayload.report);
  }

  const downloads = await downloadArtifacts(client, jobId, artifacts, outputDir);
  return {
    envelope,
    logs,
    artifacts,
    report: reportPayload?.report ?? envelope.report ?? null,
    downloads,
    sandbox,
    patchHints: buildPatchApplyHints(downloads),
  };
}

async function readSummary(summaryPath) {
  const raw = await fsp.readFile(summaryPath, "utf8");
  return JSON.parse(raw);
}

async function writeSummary(outputDir, summary) {
  const summaryPath = path.join(outputDir, "summary.json");
  await writeJson(summaryPath, summary);
  return summaryPath;
}

async function runAnalyze(args) {
  const repoRoot = await resolveRepoRoot(readStringArg(args, "repo", null));
  const outputRoot = resolveOutputRoot(repoRoot, readStringArg(args, "output-dir", null));
  const workspaceName = readStringArg(args, "workspace-name", DEFAULT_WORKSPACE_NAME);
  const workspaceDescription = readStringArg(args, "workspace-description", DEFAULT_WORKSPACE_DESCRIPTION);
  const gitRef = readStringArg(args, "ref", "HEAD");
  const codexScope = readCodexScopeArg(args, "codex-scope", DEFAULT_CODEX_SCOPE);
  const profile = readAnalyzeProfile(args);
  const agentId = readStringArg(args, "agent-id", profile.agentId);
  const wait = readBooleanArg(args, "wait", true);
  const timeoutMs = readIntegerArg(args, "timeout-ms", profile.timeoutMs);
  const pollMs = readIntegerArg(args, "poll-ms", DEFAULT_POLL_MS);
  const mergedEnv = resolveMergedEnv(repoRoot);
  const sandboxPreflight = await ensureHostedSandboxPreflight(repoRoot, args, mergedEnv);
  const runtime = await createRuntimeClient(args, mergedEnv, repoRoot);
  const client = runtime.client;

  console.log(`repo=${repoRoot}`);
  console.log(`api=${runtime.apiUrl}`);
  console.log(`auth_mode=${runtime.authMode}`);
  console.log(`profile=${profile.name}`);
  console.log(`agent=${agentId}`);
  console.log(`sandbox_preflight=${sandboxPreflight.status}`);

  const ensuredWorkspace = await ensureWorkspace(client, workspaceName, workspaceDescription);
  const workspace = await ensureProWorkspace(client, ensuredWorkspace, mergedEnv, runtime.apiUrl);
  const auth = await ensureScopedCodexAuth(client, codexScope, workspace.id);
  const archive = await createGitArchive(repoRoot, gitRef);
  const source = await uploadArchiveSource(client, workspace.id, archive.archivePath, archive.archiveFilename);
  const queuedEnvelope = await queueAnalysis(client, workspace.id, {
    sourceId: source.id,
    agentId,
    runtimeMode: readStringArg(args, "runtime-mode", DEFAULT_RUNTIME_MODE),
    codexScope,
  });
  const jobId = queuedEnvelope.job.id;
  const outputDir = path.join(outputRoot, `analysis-${jobId}`);
  await mkdirp(outputDir);

  const baseSummary = {
    schemaVersion: "speclens.self-improvement-loop.v1",
    mode: "analyze",
    createdAt: new Date().toISOString(),
    repoRoot,
    outputDir,
    workspace,
    auth: {
      scope: auth.scope,
      status: auth.status,
      authMode: auth.authMode ?? null,
      accountId: auth.accountId ?? null,
      lastRefresh: auth.lastRefresh ?? null,
    },
    archive: {
      gitRef: archive.gitRef,
      resolvedRef: archive.resolvedRef,
      archiveFilename: archive.archiveFilename,
    },
    source,
    job: queuedEnvelope.job,
    profile: {
      name: profile.name,
      agentId,
      timeoutMs,
    },
    sandboxPreflight,
  };

  try {
    if (!wait) {
      const summaryPath = await writeSummary(outputDir, {
        ...baseSummary,
        waitCompleted: false,
      });
      console.log(summaryPath);
      return;
    }

    const envelope = await waitForJob(client, jobId, { timeoutMs, pollMs });
    const evidence = await collectJobEvidence(client, jobId, outputDir);
    const selfImprovement = buildSelfImprovementAnalysis(evidence);
    await writeJson(path.join(outputDir, "self-improvement-analysis.json"), selfImprovement);
    const summary = {
      ...baseSummary,
      waitCompleted: true,
      job: evidence.envelope.job,
      report: summarizeReport(evidence.report),
      sandbox: evidence.sandbox,
      selfImprovement,
      files: {
        summary: path.join(outputDir, "summary.json"),
        jobEnvelope: path.join(outputDir, "job-envelope.json"),
        logs: path.join(outputDir, "job-logs.json"),
        artifacts: path.join(outputDir, "job-artifacts.json"),
        sandboxEvidence: path.join(outputDir, "sandbox-evidence.json"),
        selfImprovement: path.join(outputDir, "self-improvement-analysis.json"),
        report: evidence.report ? path.join(outputDir, "report-api.json") : null,
      },
      next: evidence.report?.id
        ? {
            remediate: `node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs remediate --analysis-summary ${JSON.stringify(path.join(outputDir, "summary.json"))}`,
          }
        : null,
    };
    const summaryPath = await writeSummary(outputDir, summary);
    console.log(summaryPath);
    if (readBooleanArg(args, "strict-sandbox-evidence", true)) {
      assertHostedSandboxEvidence(evidence.sandbox, jobId);
    }
    if (envelope.job.status !== "succeeded") {
      throw new Error(`Analysis job ${jobId} ended as ${envelope.job.status}.`);
    }
  } finally {
    await fsp.rm(archive.tempDir, { recursive: true, force: true });
  }
}

async function runCollect(args) {
  const repoRoot = await resolveRepoRoot(readStringArg(args, "repo", null));
  const outputRoot = resolveOutputRoot(repoRoot, readStringArg(args, "output-dir", null));
  const mergedEnv = resolveMergedEnv(repoRoot);
  const runtime = await createRuntimeClient(args, mergedEnv, repoRoot);
  const client = runtime.client;
  const jobId = ensureArg(readStringArg(args, "job-id", null), "jobId is required. Pass --job-id.");
  const wait = readBooleanArg(args, "wait", true);
  const timeoutMs = readIntegerArg(args, "timeout-ms", DEFAULT_TIMEOUT_MS);
  const pollMs = readIntegerArg(args, "poll-ms", DEFAULT_POLL_MS);
  const outputDir = path.join(outputRoot, `analysis-${jobId}`);

  console.log(`repo=${repoRoot}`);
  console.log(`api=${runtime.apiUrl}`);
  console.log(`auth_mode=${runtime.authMode}`);
  console.log(`job=${jobId}`);

  let envelope = null;
  if (wait) {
    envelope = await waitForJob(client, jobId, { timeoutMs, pollMs });
  }
  const evidence = await collectJobEvidence(client, jobId, outputDir);
  const selfImprovement = buildSelfImprovementAnalysis(evidence);
  await writeJson(path.join(outputDir, "self-improvement-analysis.json"), selfImprovement);
  const summary = {
    schemaVersion: "speclens.self-improvement-loop.v1",
    mode: "collect",
    createdAt: new Date().toISOString(),
    repoRoot,
    outputDir,
    waitCompleted: wait,
    job: evidence.envelope.job,
    report: summarizeReport(evidence.report),
    sandbox: evidence.sandbox,
    selfImprovement,
    files: {
      summary: path.join(outputDir, "summary.json"),
      jobEnvelope: path.join(outputDir, "job-envelope.json"),
      logs: path.join(outputDir, "job-logs.json"),
      artifacts: path.join(outputDir, "job-artifacts.json"),
      sandboxEvidence: path.join(outputDir, "sandbox-evidence.json"),
      selfImprovement: path.join(outputDir, "self-improvement-analysis.json"),
      report: evidence.report ? path.join(outputDir, "report-api.json") : null,
    },
    next: evidence.report?.id
      ? {
          remediate: `node .codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs remediate --analysis-summary ${JSON.stringify(path.join(outputDir, "summary.json"))}`,
        }
      : null,
  };
  const summaryPath = await writeSummary(outputDir, summary);
  console.log(summaryPath);
  if (readBooleanArg(args, "strict-sandbox-evidence", true)) {
    assertHostedSandboxEvidence(evidence.sandbox, jobId);
  }
  const finalStatus = evidence.envelope.job?.status ?? envelope?.job?.status;
  if (wait && finalStatus !== "succeeded") {
    throw new Error(`Job ${jobId} ended as ${finalStatus}.`);
  }
}

function parsePublishRemote(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true";
  }
  return false;
}

async function runRemediate(args) {
  const repoRoot = await resolveRepoRoot(readStringArg(args, "repo", null));
  const outputRoot = resolveOutputRoot(repoRoot, readStringArg(args, "output-dir", null));
  const mergedEnv = resolveMergedEnv(repoRoot);
  const sandboxPreflight = await ensureHostedSandboxPreflight(repoRoot, args, mergedEnv);
  const runtime = await createRuntimeClient(args, mergedEnv, repoRoot);
  const client = runtime.client;
  const analysisSummaryPath = readStringArg(args, "analysis-summary", null);
  const priorSummary = analysisSummaryPath ? await readSummary(path.resolve(repoRoot, analysisSummaryPath)) : null;
  const workspaceId = readStringArg(args, "workspace-id", priorSummary?.workspace?.id ?? null);
  const sourceId = readStringArg(args, "source-id", priorSummary?.source?.id ?? priorSummary?.job?.sourceId ?? null);
  const reportId = readStringArg(args, "report-id", priorSummary?.report?.id ?? priorSummary?.job?.reportId ?? null);
  const codexScope = readCodexScopeArg(args, "codex-scope", priorSummary?.job?.codexAuthScope ?? DEFAULT_CODEX_SCOPE);
  const wait = readBooleanArg(args, "wait", true);
  const timeoutMs = readIntegerArg(args, "timeout-ms", DEFAULT_TIMEOUT_MS);
  const pollMs = readIntegerArg(args, "poll-ms", DEFAULT_POLL_MS);

  ensureArg(sourceId, "sourceId is required. Pass --source-id or --analysis-summary.");
  ensureArg(reportId, "reportId is required. Pass --report-id or --analysis-summary.");
  console.log(`repo=${repoRoot}`);
  console.log(`api=${runtime.apiUrl}`);
  console.log(`auth_mode=${runtime.authMode}`);
  console.log(`sandbox_preflight=${sandboxPreflight.status}`);

  await ensureScopedCodexAuth(client, codexScope, workspaceId);

  const queuedEnvelope = await queueRemediation(client, reportId, {
    sourceId,
    baseRef: readStringArg(args, "base-ref", "HEAD"),
    selectionMode: readStringArg(args, "selection-mode", "auto-priority"),
    maxIterations: readIntegerArg(args, "max-iterations", 2),
    outputMode: readStringArg(args, "output-mode", "changeset"),
    publishRemote: parsePublishRemote(args["publish-remote"]),
  });
  const jobId = queuedEnvelope.job.id;
  const outputDir = path.join(outputRoot, `remediation-${jobId}`);
  await mkdirp(outputDir);

  const baseSummary = {
    schemaVersion: "speclens.self-improvement-loop.v1",
    mode: "remediate",
    createdAt: new Date().toISOString(),
    repoRoot,
    outputDir,
    workspaceId,
    sourceId,
    reportId,
    job: queuedEnvelope.job,
    basedOn: analysisSummaryPath ? path.resolve(repoRoot, analysisSummaryPath) : null,
    sandboxPreflight,
  };

  if (!wait) {
    const summaryPath = await writeSummary(outputDir, {
      ...baseSummary,
      waitCompleted: false,
    });
    console.log(summaryPath);
    return;
  }

  const envelope = await waitForJob(client, jobId, { timeoutMs, pollMs });
  const evidence = await collectJobEvidence(client, jobId, outputDir);
  const selfImprovement = buildSelfImprovementAnalysis(evidence);
  await writeJson(path.join(outputDir, "self-improvement-analysis.json"), selfImprovement);
  const summary = {
    ...baseSummary,
    waitCompleted: true,
    job: evidence.envelope.job,
    report: summarizeReport(evidence.report),
    changeset: evidence.envelope.job.changeset ?? null,
    sandbox: evidence.sandbox,
    selfImprovement,
    files: {
      summary: path.join(outputDir, "summary.json"),
      jobEnvelope: path.join(outputDir, "job-envelope.json"),
      logs: path.join(outputDir, "job-logs.json"),
      artifacts: path.join(outputDir, "job-artifacts.json"),
      sandboxEvidence: path.join(outputDir, "sandbox-evidence.json"),
      selfImprovement: path.join(outputDir, "self-improvement-analysis.json"),
      report: evidence.report ? path.join(outputDir, "report-api.json") : null,
    },
    next: evidence.patchHints,
  };
  const summaryPath = await writeSummary(outputDir, summary);
  console.log(summaryPath);
  if (readBooleanArg(args, "strict-sandbox-evidence", true)) {
    assertHostedSandboxEvidence(evidence.sandbox, jobId);
  }
  if (envelope.job.status !== "succeeded") {
    throw new Error(`Remediation job ${jobId} ended as ${envelope.job.status}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] ?? "analyze";
  if (mode === "help" || args.help === true) {
    printUsage();
    return;
  }
  if (mode === "analyze") {
    await runAnalyze(args);
    return;
  }
  if (mode === "collect") {
    await runCollect(args);
    return;
  }
  if (mode === "remediate") {
    await runRemediate(args);
    return;
  }
  throw new Error(`Unknown mode "${mode}". Use "analyze" or "remediate".`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
